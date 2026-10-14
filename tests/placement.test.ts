import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BASE_ITEM_WIDTH, carouselFrame, degToRad, fitPlane, gifFrameIndex, modelFit, placementOf } from '../src/scene/placement';
import { applyItemTransform, createItemNodes } from '../src/scene/runtime';
import { defaultTransform } from '../src/storage/model';

describe('fitPlane', () => {
  it('mantém a proporção com a largura base', () => {
    expect(fitPlane(400, 200)).toEqual({ width: BASE_ITEM_WIDTH, height: BASE_ITEM_WIDTH / 2 });
    expect(fitPlane(100, 300).height).toBeCloseTo(BASE_ITEM_WIDTH * 3);
  });

  it.each([[0, 10], [10, 0], [-1, 5], [Number.NaN, 5]])('tamanho natural inválido (%s×%s) vira quadrado', (w, h) => {
    expect(fitPlane(w, h)).toEqual({ width: BASE_ITEM_WIDTH, height: BASE_ITEM_WIDTH });
  });
});

describe('modelFit', () => {
  it('o maior lado vira a largura base; centraliza em X/Z e apoia a base na origem', () => {
    const fit = modelFit([-1, 2, -3], [3, 4, 1]); // tamanho 4 × 2 × 4, centro x=1, z=-1
    expect(fit.scale).toBeCloseTo(BASE_ITEM_WIDTH / 4);
    expect(fit.translation).toEqual([-1, -2, 1]);
  });

  it('modelo vazio ou degenerado não gera escala infinita nem NaN', () => {
    expect(modelFit([0, 0, 0], [0, 0, 0])).toEqual({ scale: 1, translation: [0, 0, 0] });
    expect(modelFit([Number.NaN, 0, 0], [1, 1, 1])).toEqual({ scale: 1, translation: [0, 0, 0] });
    expect(modelFit([Infinity, 0, 0], [-Infinity, 1, 1]).scale).toBe(1);
  });
});

describe('gifFrameIndex', () => {
  const durations = [100, 200, 300]; // total 600

  it('acha o quadro pelo instante e repete em laço', () => {
    expect(gifFrameIndex(0, durations)).toBe(0);
    expect(gifFrameIndex(99, durations)).toBe(0);
    expect(gifFrameIndex(100, durations)).toBe(1);
    expect(gifFrameIndex(299, durations)).toBe(1);
    expect(gifFrameIndex(300, durations)).toBe(2);
    expect(gifFrameIndex(599, durations)).toBe(2);
    expect(gifFrameIndex(600, durations)).toBe(0);
    expect(gifFrameIndex(1550, durations)).toBe(2);
  });

  it('duração zero, negativa ou inválida vale 100 ms', () => {
    expect(gifFrameIndex(150, [0, 0, 0])).toBe(1);
    expect(gifFrameIndex(249, [-5, Number.NaN, 50])).toBe(2);
  });

  it('sem quadros ou com tempo negativo não quebra', () => {
    expect(gifFrameIndex(500, [])).toBe(0);
    expect(gifFrameIndex(-50, durations)).toBe(2);
  });
});

describe('placementOf / applyItemTransform', () => {
  it('converte graus em radianos e preserva o resto', () => {
    const p = placementOf({ scale: 2, rotation: [90, 180, -45], position: [0.1, 0.2, 0.3], offset: [1, 2, 3] });
    expect(p.rotation[0]).toBeCloseTo(Math.PI / 2);
    expect(p.rotation[1]).toBeCloseTo(Math.PI);
    expect(p.rotation[2]).toBeCloseTo(-Math.PI / 4);
    expect(p).toMatchObject({ scale: 2, position: [0.1, 0.2, 0.3], offset: [1, 2, 3] });
    expect(degToRad(180)).toBeCloseTo(Math.PI);
  });

  const worldOrigin = (transform: ReturnType<typeof defaultTransform>): THREE.Vector3 => {
    const nodes = createItemNodes();
    applyItemTransform(nodes, transform);
    const content = new THREE.Object3D();
    nodes.scale.add(content);
    nodes.root.updateMatrixWorld(true);
    return content.getWorldPosition(new THREE.Vector3());
  };

  it('posição leva o item ao ponto indicado, sem mexer no resto', () => {
    const t = { ...defaultTransform(), position: [0.2, -0.1, 0.05] as [number, number, number] };
    const v = worldOrigin(t);
    expect([v.x, v.y, v.z].map((n) => +n.toFixed(6))).toEqual([0.2, -0.1, 0.05]);
  });

  it('deslocamento acompanha o giro do item (eixo do próprio item) e não a escala', () => {
    const t = { ...defaultTransform(), rotation: [0, 0, 90] as [number, number, number], offset: [0.1, 0, 0] as [number, number, number], scale: 5 };
    const v = worldOrigin(t);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0.1); // +x do item, girado 90° em z, aponta para +y da âncora
    expect(v.z).toBeCloseTo(0);
  });

  it('posição e deslocamento somam; escala é uniforme', () => {
    const nodes = createItemNodes();
    applyItemTransform(nodes, { scale: 2, rotation: [0, 0, 0], position: [0.1, 0, 0], offset: [0, 0, 0.2] });
    nodes.root.updateMatrixWorld(true);
    const probe = new THREE.Object3D();
    probe.position.set(1, 1, 1);
    nodes.scale.add(probe);
    nodes.root.updateMatrixWorld(true);
    const v = probe.getWorldPosition(new THREE.Vector3());
    expect([v.x, v.y, v.z].map((n) => +n.toFixed(6))).toEqual([2.1, 2, 2.2]);
  });

  it('reaplicar não acumula (idempotente)', () => {
    const nodes = createItemNodes();
    const t = { scale: 3, rotation: [10, 20, 30] as [number, number, number], position: [0.1, 0.2, 0.3] as [number, number, number], offset: [0, 0.1, 0] as [number, number, number] };
    applyItemTransform(nodes, t);
    nodes.root.updateMatrixWorld(true);
    const once = nodes.scale.matrixWorld.clone();
    applyItemTransform(nodes, t);
    nodes.root.updateMatrixWorld(true);
    expect(nodes.scale.matrixWorld.equals(once)).toBe(true);
  });
});

describe('carouselFrame', () => {
  const frame = (t: number, count = 3, interval = 3000, fade = true) => carouselFrame(t, count, interval, fade);

  it('sem transição, troca seca no fim de cada intervalo e dá a volta', () => {
    expect(frame(0, 3, 1000, false)).toEqual({ index: 0, next: null, mix: 0 });
    expect(frame(999, 3, 1000, false).index).toBe(0);
    expect(frame(1000, 3, 1000, false).index).toBe(1);
    expect(frame(2999, 3, 1000, false).index).toBe(2);
    expect(frame(3000, 3, 1000, false).index).toBe(0);
    expect(frame(7500, 3, 1000, false).index).toBe(1);
  });

  it('com transição, o começo do intervalo é o slide inteiro e o fim mistura com o próximo', () => {
    expect(frame(0)).toEqual({ index: 0, next: null, mix: 0 });
    expect(frame(2400)).toEqual({ index: 0, next: null, mix: 0 }); // 3000 - 600 = início da transição
    const middle = frame(2700);
    expect(middle.index).toBe(0);
    expect(middle.next).toBe(1);
    expect(middle.mix).toBeCloseTo(0.5);
    expect(frame(2999).mix).toBeGreaterThan(0.99);
    expect(frame(3000)).toEqual({ index: 1, next: null, mix: 0 });
  });

  it('o último slide faz a transição de volta para o primeiro', () => {
    const f = carouselFrame(3 * 3000 - 300, 3, 3000, true);
    expect(f.index).toBe(2);
    expect(f.next).toBe(0);
  });

  it('a transição nunca passa de metade do intervalo', () => {
    // intervalo de 500 ms: transição de 250 ms
    expect(carouselFrame(249, 2, 500, true)).toEqual({ index: 0, next: null, mix: 0 });
    const f = carouselFrame(375, 2, 500, true);
    expect(f.next).toBe(1);
    expect(f.mix).toBeCloseTo(0.5);
  });

  it('um slide só nunca faz transição', () => {
    expect(carouselFrame(2900, 1, 3000, true)).toEqual({ index: 0, next: null, mix: 0 });
    expect(carouselFrame(123456, 1, 3000, false).index).toBe(0);
  });

  it('entradas inválidas caem no primeiro slide', () => {
    expect(carouselFrame(100, 0, 3000, true)).toEqual({ index: 0, next: null, mix: 0 });
    expect(carouselFrame(100, 3, 0, true)).toEqual({ index: 0, next: null, mix: 0 });
    expect(carouselFrame(Number.NaN, 3, 1000, false).index).toBe(0);
    expect(carouselFrame(-1, 3, 1000, false).index).toBe(2); // tempo negativo dá a volta
  });
});
