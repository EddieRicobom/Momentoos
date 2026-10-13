import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BASE_ITEM_WIDTH, degToRad, fitPlane, gifFrameIndex, modelFit, placementOf } from '../src/scene/placement';
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
