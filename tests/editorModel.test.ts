import { describe, expect, it } from 'vitest';
import {
  CONTROLS,
  applyControl,
  cloneItems,
  controlsFor,
  diffItems,
  formatValue,
  isDirty,
  moveItem,
  resetTransform,
  TYPE_LABEL,
} from '../src/scene/editorModel';
import { TILT_DEGREES, cameraPose, pointerAngleDeg, pinchedScale, pointerDistance, rayHitsPlane, twistedRotation, wrapDegrees } from '../src/scene/picking';
import { defaultOptions, defaultTransform, parseProjectRecord, type ItemType, type SceneItem } from '../src/storage/model';
import { makeRecord } from './helpers';

const MIME: Record<ItemType, string> = {
  image: 'image/png',
  gif: 'image/gif',
  video: 'video/mp4',
  model: 'model/gltf-binary',
  audio: 'audio/mpeg',
  carousel: 'image/png',
};

function item(id: string, type: ItemType = 'image'): SceneItem {
  return {
    id,
    type,
    name: id,
    visible: true,
    file: { mimeType: MIME[type], size: 8, sha256: 'a'.repeat(64), fileName: `${id}.bin` },
    transform: defaultTransform(),
    options: defaultOptions(type),
  };
}

const control = (id: string) => CONTROLS.find((c) => c.id === id)!;

describe('controles por tipo', () => {
  it('itens visuais têm posição, giro, tamanho, deslocamento e opacidade', () => {
    for (const type of ['image', 'gif', 'video', 'model'] as const) {
      const ids = controlsFor(type).map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining(['pos-x', 'pos-y', 'pos-z', 'rot-x', 'rot-y', 'rot-z', 'scale', 'off-x', 'opacity']));
    }
  });

  it('volume só em vídeo e áudio; áudio não tem controles de posição', () => {
    expect(controlsFor('video').some((c) => c.id === 'volume')).toBe(true);
    expect(controlsFor('image').some((c) => c.id === 'volume')).toBe(false);
    expect(controlsFor('audio').map((c) => c.id)).toEqual(['volume']);
  });

  it('ids dos controles são únicos', () => {
    const ids = CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('applyControl', () => {
  it('lê e grava no campo certo sem mexer no resto', () => {
    const base = item('a');
    const moved = applyControl(base, control('pos-y'), 0.25);
    expect(control('pos-y').read(moved)).toBe(0.25);
    expect(moved.transform.position).toEqual([0, 0.25, 0]);
    expect(moved.transform.rotation).toEqual([0, 0, 0]);
    expect(base.transform.position).toEqual([0, 0, 0]); // imutável

    expect(applyControl(base, control('rot-z'), 90).transform.rotation).toEqual([0, 0, 90]);
    expect(applyControl(base, control('off-z'), 0.1).transform.offset).toEqual([0, 0, 0.1]);
    expect(applyControl(base, control('scale'), 2).transform.scale).toBe(2);
    expect(applyControl(base, control('opacity'), 0.5).options.opacity).toBe(0.5);
    expect(applyControl(item('v', 'video'), control('volume'), 0.3).options.volume).toBe(0.3);
  });

  it('prende nos limites e arredonda ao passo', () => {
    const base = item('a');
    expect(control('scale').read(applyControl(base, control('scale'), 0))).toBe(0.05);
    expect(control('scale').read(applyControl(base, control('scale'), 99))).toBe(5);
    expect(control('opacity').read(applyControl(base, control('opacity'), 7))).toBe(1);
    expect(control('opacity').read(applyControl(base, control('opacity'), -1))).toBe(0);
    expect(control('pos-x').read(applyControl(base, control('pos-x'), 0.12345678))).toBe(0.123);
    expect(control('rot-z').read(applyControl(base, control('rot-z'), 400))).toBe(180);
  });

  it('NaN e infinito não entram no item', () => {
    const base = item('a');
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const result = applyControl(base, control('scale'), bad);
      expect(Number.isFinite(result.transform.scale)).toBe(true);
      expect(result.transform.scale).toBeGreaterThan(0);
    }
  });

  it('todo valor gerável pelos controles produz um registro que o armazenamento aceita', async () => {
    let current = item('a');
    for (const c of controlsFor('image')) {
      current = applyControl(current, c, c.min);
      current = applyControl(current, c, c.max);
      current = applyControl(current, c, 0.37);
    }
    const record = await makeRecord({ id: 'p1', scene: { items: [current] } });
    expect(parseProjectRecord(record).ok).toBe(true);
  });
});

describe('moveItem / resetTransform / formatValue', () => {
  it('move x e y juntos, com limites', () => {
    const moved = moveItem(item('a'), 0.3, -2);
    expect(moved.transform.position).toEqual([0.3, -1, 0]);
  });

  it('restaurar zera a transformação e preserva as opções', () => {
    const dirty = applyControl(applyControl(item('a'), control('scale'), 3), control('opacity'), 0.2);
    const reset = resetTransform(dirty);
    expect(reset.transform).toEqual(defaultTransform());
    expect(reset.options.opacity).toBe(0.2);
  });

  it('formata com vírgula e unidade', () => {
    expect(formatValue(control('scale'), 1.5)).toBe('1,50 ×');
    expect(formatValue(control('rot-z'), 45)).toBe('45 °');
    expect(formatValue(control('opacity'), 0.5)).toBe('0,50');
    expect(formatValue(control('pos-x'), 0.125)).toBe('0,13 larg.');
  });
});

describe('diffItems / isDirty', () => {
  it('sem mudança não há diferença', () => {
    const saved = [item('a'), item('b')];
    expect(isDirty(saved, cloneItems(saved))).toBe(false);
    expect(diffItems(saved, cloneItems(saved)).size).toBe(0);
  });

  it('detecta só o que mudou, item a item', () => {
    const saved = [item('a'), item('b'), item('c')];
    const draft = cloneItems(saved);
    draft[0] = applyControl(draft[0]!, control('pos-x'), 0.2);
    draft[1] = { ...draft[1]!, name: 'Novo', visible: false };
    draft[2] = { ...draft[2]!, options: { ...draft[2]!.options, loop: false } };
    const patches = diffItems(saved, draft);
    expect([...patches.keys()]).toEqual(['a', 'b', 'c']);
    expect(Object.keys(patches.get('a')!)).toEqual(['transform']);
    expect(patches.get('b')).toEqual({ name: 'Novo', visible: false });
    expect(Object.keys(patches.get('c')!)).toEqual(['options']);
  });

  it.each([
    ['rotação', (i: SceneItem) => applyControl(i, control('rot-x'), 1)],
    ['deslocamento', (i: SceneItem) => applyControl(i, control('off-y'), 0.01)],
    ['escala', (i: SceneItem) => applyControl(i, control('scale'), 1.01)],
    ['animar', (i: SceneItem) => ({ ...i, options: { ...i.options, animate: !i.options.animate } })],
    ['animação escolhida', (i: SceneItem) => ({ ...i, options: { ...i.options, clip: 'Andar' } })],
  ])('mudança de %s conta como alteração', (_label, change) => {
    const saved = [item('a', 'model')];
    expect(isDirty(saved, [change(saved[0]!)])).toBe(true);
  });

  it('voltar ao valor salvo deixa de ser alteração', () => {
    const saved = [item('a')];
    const moved = applyControl(saved[0]!, control('pos-x'), 0.4);
    expect(isDirty(saved, [moved])).toBe(true);
    expect(isDirty(saved, [applyControl(moved, control('pos-x'), 0)])).toBe(false);
  });

  it('itens que só existem no rascunho não geram patch (são criados pelo armazenamento)', () => {
    expect(diffItems([item('a')], [item('a'), item('novo')]).size).toBe(0);
  });

  it('cloneItems copia em profundidade', () => {
    const original = [item('a')];
    const copy = cloneItems(original);
    copy[0]!.transform.position[0] = 9;
    copy[0]!.options.opacity = 0;
    expect(original[0]!.transform.position[0]).toBe(0);
    expect(original[0]!.options.opacity).toBe(1);
  });
});

describe('rayHitsPlane', () => {
  it('raio de frente acerta o ponto debaixo dele', () => {
    expect(rayHitsPlane([0.2, -0.1, 2], [0, 0, -1], 0)).toEqual([0.2, -0.1]);
  });

  it('raio inclinado cruza o plano mais adiante', () => {
    const [x, y] = rayHitsPlane([0, 0, 2], [0.5, 0.25, -1], 0)!;
    expect(x).toBeCloseTo(1);
    expect(y).toBeCloseTo(0.5);
  });

  it('plano elevado (z do item) muda o ponto de acerto', () => {
    const [x] = rayHitsPlane([0, 0, 2], [0.5, 0, -1], 1)!;
    expect(x).toBeCloseTo(0.5);
  });

  it('paralelo ao plano ou apontando para longe: sem acerto', () => {
    expect(rayHitsPlane([0, 0, 2], [1, 0, 0], 0)).toBeNull();
    expect(rayHitsPlane([0, 0, 2], [0, 0, 1], 0)).toBeNull();
  });
});

describe('cameraPose', () => {
  it('de frente, a câmera fica no eixo z; inclinada, recua em y com o mesmo alcance', () => {
    const front = cameraPose('front', 0.75, 1);
    const tilted = cameraPose('tilted', 0.75, 1);
    expect(front.position[0]).toBe(0);
    expect(front.position[1]).toBeCloseTo(0);
    expect(front.position[2]).toBeGreaterThan(0);
    const distance = Math.hypot(...tilted.position);
    expect(distance).toBeCloseTo(front.position[2]);
    expect(tilted.position[1]).toBeLessThan(0);
    expect(Math.atan2(-tilted.position[1], tilted.position[2]) * (180 / Math.PI)).toBeCloseTo(TILT_DEGREES);
  });

  it('alvo mais alto ou tela mais estreita afastam a câmera', () => {
    const base = cameraPose('front', 0.75, 1).position[2];
    expect(cameraPose('front', 2, 1).position[2]).toBeGreaterThan(base);
    expect(cameraPose('front', 0.75, 0.4).position[2]).toBeGreaterThan(base);
  });

  it('proporções inválidas caem em 1', () => {
    expect(cameraPose('front', 0, Number.NaN).position[2]).toBeCloseTo(cameraPose('front', 1, 1).position[2]);
  });
});

describe('gesto de dois dedos', () => {
  it('ângulo entre os dedos em coordenadas de tela', () => {
    expect(pointerAngleDeg({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(pointerAngleDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90); // y para baixo
    expect(pointerAngleDeg({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(180);
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('wrapDegrees leva para (-180, 180]', () => {
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(720)).toBe(0);
    expect(wrapDegrees(Number.NaN)).toBe(0);
  });

  it('girar os dedos no sentido horário diminui o giro do item; anti-horário aumenta', () => {
    // dedos na horizontal (0°) viram para baixo (90°): horário na tela
    expect(twistedRotation(0, 0, 90)).toBe(-90);
    expect(twistedRotation(0, 90, 0)).toBe(90);
    expect(twistedRotation(30, 10, 25)).toBe(15);
  });

  it('parte do giro que o item já tinha e dá a volta sem saltos', () => {
    expect(twistedRotation(170, 0, -20)).toBe(-170); // 170 + 20 = 190 → -170
    // cruzar -180/180 no ângulo dos dedos não faz o item pular
    expect(twistedRotation(0, 170, -170)).toBe(-20);
    expect(twistedRotation(0, -170, 170)).toBe(20);
  });

  it('sem movimento, o giro não muda', () => {
    expect(twistedRotation(45, 33, 33)).toBe(45);
  });
});

describe('pinchedScale', () => {
  it('proporcional à distância entre os dedos', () => {
    expect(pinchedScale(1, 100, 200)).toBe(2);
    expect(pinchedScale(2, 100, 50)).toBe(1);
    expect(pinchedScale(1.5, 80, 80)).toBe(1.5);
  });

  it('entradas inválidas mantêm o tamanho', () => {
    expect(pinchedScale(1, 0, 50)).toBe(1);
    expect(pinchedScale(1, Number.NaN, 50)).toBe(1);
    expect(pinchedScale(1, 100, Number.NaN)).toBe(1);
    expect(pinchedScale(1, 100, -5)).toBe(1);
  });

  it('o resultado passa pelo limite do controle de tamanho', () => {
    const scale = CONTROLS.find((c) => c.id === 'scale')!;
    const huge = applyControl(item('a'), scale, pinchedScale(1, 10, 1000));
    expect(huge.transform.scale).toBe(5);
    const tiny = applyControl(item('a'), scale, pinchedScale(1, 1000, 1));
    expect(tiny.transform.scale).toBe(0.05);
  });
});

describe('carrossel no modelo do editor', () => {
  const carousel = (): SceneItem => ({
    ...item('c1', 'carousel'),
    slides: [
      { slot: 0, mimeType: 'image/png', size: 8, sha256: 'a'.repeat(64), fileName: 'a.png' },
      { slot: 3, mimeType: 'image/png', size: 9, sha256: 'b'.repeat(64), fileName: 'b.png' },
    ],
  });

  it('é visual (tem posição e opacidade) e só ele tem o tempo de cada imagem', () => {
    const ids = controlsFor('carousel').map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['pos-x', 'rot-z', 'scale', 'opacity', 'interval']));
    expect(ids).not.toContain('volume');
    for (const type of ['image', 'gif', 'video', 'model', 'audio'] as const) {
      expect(controlsFor(type).some((c) => c.id === 'interval')).toBe(false);
    }
  });

  it('o controle de tempo mostra segundos e grava milissegundos inteiros, preso a 0,5–60 s', () => {
    const c = control('interval');
    expect(c.read({ ...carousel(), options: { ...carousel().options, intervalMs: 4500 } })).toBe(4.5);
    expect(applyControl(carousel(), c, 7.5).options.intervalMs).toBe(7500);
    expect(applyControl(carousel(), c, 0).options.intervalMs).toBe(500);
    expect(applyControl(carousel(), c, 999).options.intervalMs).toBe(60000);
    expect(formatValue(c, 2.5)).toBe('2,5 s');
  });

  it('intervalo e transição entram no diff como mudança de opções', () => {
    const saved = [carousel()];
    const a = [{ ...carousel(), options: { ...carousel().options, intervalMs: 5000 } }];
    const b = [{ ...carousel(), options: { ...carousel().options, fade: false } }];
    expect(diffItems(saved, a).get('c1')?.options?.intervalMs).toBe(5000);
    expect(diffItems(saved, b).get('c1')?.options?.fade).toBe(false);
    expect(isDirty(saved, [carousel()])).toBe(false);
  });

  it('cloneItems copia também os slides (sem compartilhar objetos)', () => {
    const original = carousel();
    const [copy] = cloneItems([original]);
    expect(copy?.slides).toEqual(original.slides);
    expect(copy?.slides).not.toBe(original.slides);
    expect(copy?.slides?.[0]).not.toBe(original.slides?.[0]);
    expect(cloneItems([item('i1')])[0]).not.toHaveProperty('slides');
  });

  it('o nome do tipo é "Carrossel"', () => {
    expect(TYPE_LABEL.carousel).toBe('Carrossel');
  });
});

import { CONTROLS as ALL_CONTROLS, nudgeStep } from '../src/scene/editorModel';

describe('nudgeStep', () => {
  const control = (id: string) => ALL_CONTROLS.find((c) => c.id === id)!;

  it('posição: 0,01 de largura por toque; fino 0,002', () => {
    expect(nudgeStep(control('pos-x'))).toBeCloseTo(0.01, 6);
    expect(nudgeStep(control('pos-x'), true)).toBeCloseTo(0.002, 6);
  });

  it('giro: 2 graus por toque', () => {
    expect(nudgeStep(control('rot-z'))).toBe(2);
  });

  it('tamanho: 0,02 por toque', () => {
    expect(nudgeStep(control('scale'))).toBeCloseTo(0.02, 6);
  });

  it('nunca é menor que meio passo do controle', () => {
    for (const c of ALL_CONTROLS) {
      expect(nudgeStep(c, true)).toBeGreaterThanOrEqual(c.step);
      expect(nudgeStep(c)).toBeGreaterThanOrEqual(c.step);
    }
  });
});
