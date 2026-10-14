import { describe, expect, it } from 'vitest';
import { GestureTracker, type GestureHost } from '../src/scene/gestures';
import type { Point } from '../src/scene/picking';

/** Dois itens: "a" perto de (0,0) e "b" perto de (100,0); o resto da tela é vazio. */
function setup(options: { selected?: string | null; rotations?: Record<string, number | null> } = {}) {
  const log: string[] = [];
  const scales: string[] = [];
  let selected: string | null = options.selected === undefined ? null : options.selected;
  const rotations: Record<string, number | null> = { a: 0, b: 40, audio: null, ...options.rotations };
  const host: GestureHost = {
    pick: (p) => (Math.hypot(p.x, p.y) < 20 ? 'a' : Math.hypot(p.x - 100, p.y) < 20 ? 'b' : null),
    select: (id) => {
      selected = id;
      log.push(`select:${id}`);
    },
    startDrag: (id, start) => (p: Point) => log.push(`drag:${id}:${p.x - start.x},${p.y - start.y}`),
    selectedId: () => selected,
    rotationZ: (id) => rotations[id] ?? null,
    rotate: (id, deg) => log.push(`rotate:${id}:${Math.round(deg)}`),
    scaleOf: (id) => (id === 'a' ? 1 : id === 'b' ? 2 : null),
    rescale: (id, value) => scales.push(`${id}:${value.toFixed(2)}`),
  };
  return { tracker: new GestureTracker(host), log, scales, selected: () => selected };
}

describe('um dedo', () => {
  it('em cima de um item: seleciona e arrasta', () => {
    const { tracker, log } = setup();
    tracker.down(1, { x: 0, y: 0 });
    tracker.move(1, { x: 5, y: 3 });
    tracker.up(1);
    expect(log).toEqual(['select:a', 'drag:a:5,3']);
  });

  it('em área vazia: só desmarca ao soltar sem ter andado', () => {
    const { tracker, log } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    expect(log).toEqual([]); // ainda não desmarcou
    tracker.up(1);
    expect(log).toEqual(['select:null']);
  });

  it('em área vazia, arrastar (rolar/mover) não desmarca', () => {
    const { tracker, log } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.move(1, { x: 340, y: 300 });
    tracker.up(1);
    expect(log).toEqual([]);
  });

  it('pequeno tremor do dedo ainda conta como toque', () => {
    const { tracker, log } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.move(1, { x: 303, y: 302 });
    tracker.up(1);
    expect(log).toEqual(['select:null']);
  });

  it('gesto cancelado pelo sistema nunca desmarca', () => {
    const { tracker, log } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.up(1, true);
    expect(log).toEqual([]);
  });

  it('mover um dedo desconhecido é ignorado', () => {
    const { tracker, log } = setup();
    tracker.move(9, { x: 1, y: 1 });
    expect(log).toEqual([]);
  });
});

describe('dois dedos', () => {
  it('com um item selecionado, girar os dedos gira o item (mesmo com os dedos no vazio)', () => {
    const { tracker, log, selected } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 }); // linha horizontal: 0°
    expect(selected()).toBe('a'); // o primeiro dedo no vazio NÃO desmarcou
    tracker.move(2, { x: 300, y: 400 }); // para baixo: +90° na tela (horário) → item -90°
    tracker.up(2);
    tracker.up(1);
    expect(log).toEqual(['rotate:a:-90']);
    expect(selected()).toBe('a');
  });

  it('anti-horário aumenta o giro, somando ao que o item já tinha', () => {
    const { tracker, log } = setup({ selected: 'b' }); // b começa com 40°
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.move(2, { x: 400 - 0, y: 200 }); // apontando para cima: -45° na tela (x=100,y=-100)
    expect(log).toEqual(['rotate:b:85']);
  });

  it('primeiro dedo no item e o segundo no vazio: seleciona e gira', () => {
    const { tracker, log } = setup();
    tracker.down(1, { x: 0, y: 0 }); // seleciona a
    tracker.down(2, { x: 100, y: 0 }); // fica em cima do item b, mas é o 2º dedo: não seleciona
    tracker.move(2, { x: 100, y: 100 });
    expect(log[0]).toBe('select:a');
    expect(log).not.toContain('select:b');
    expect(log.at(-1)).toMatch(/^rotate:a:/);
  });

  it('o segundo dedo cancela o arrasto do primeiro', () => {
    const { tracker, log } = setup();
    tracker.down(1, { x: 0, y: 0 });
    tracker.down(2, { x: 100, y: 0 });
    tracker.move(1, { x: 10, y: 10 });
    expect(log.some((l) => l.startsWith('drag'))).toBe(false);
  });

  it('sem item selecionado nada gira (e o 2º dedo não seleciona)', () => {
    const { tracker, log } = setup();
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.move(2, { x: 300, y: 400 });
    tracker.up(2);
    tracker.up(1);
    expect(log).toEqual([]);
  });

  it('item que não gira (áudio) ignora o gesto', () => {
    const { tracker, log } = setup({ selected: 'audio' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.move(2, { x: 300, y: 400 });
    expect(log).toEqual([]);
  });

  it('dedos quase juntos não giram (ângulo instável)', () => {
    const { tracker, log } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 303, y: 300 });
    tracker.move(2, { x: 300, y: 303 });
    expect(log).toEqual([]);
  });

  it('dedos que começam colados não iniciam giro, mesmo que se afastem depois (ângulo inicial seria ruído)', () => {
    const { tracker, log } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 300, y: 303 }); // 90° só por ruído
    tracker.move(2, { x: 400, y: 300 });
    expect(log).toEqual([]);
  });

  it('segundo dedo colado durante um arrasto também interrompe o arrasto', () => {
    const { tracker, log } = setup();
    tracker.down(1, { x: 0, y: 0 });
    tracker.down(2, { x: 3, y: 0 });
    tracker.move(1, { x: 10, y: 10 });
    expect(log).toEqual(['select:a']);
  });

  it('soltar um dedo encerra o giro e o dedo que sobra não arrasta nem desmarca', () => {
    const { tracker, log, selected } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.up(2);
    tracker.move(1, { x: 500, y: 500 });
    tracker.up(1);
    expect(log).toEqual([]);
    expect(selected()).toBe('a');
  });

  it('depois de um gesto de dois dedos, um novo toque no item volta a arrastar', () => {
    const { tracker, log } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.up(2);
    tracker.up(1);
    tracker.down(3, { x: 0, y: 0 });
    tracker.move(3, { x: 4, y: 4 });
    expect(log).toEqual(['select:a', 'drag:a:4,4']);
  });

  it('três dedos: o terceiro não inicia nada novo', () => {
    const { tracker, log } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.down(3, { x: 0, y: 0 });
    expect(log).not.toContain('select:a');
    expect(log).toEqual([]);
  });
});

describe('pinça (tamanho)', () => {
  it('afastar os dedos aumenta o tamanho na mesma proporção; aproximar diminui', () => {
    const { tracker, scales } = setup({ selected: 'a' }); // a tem tamanho 1
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 }); // distância 100
    tracker.move(2, { x: 500, y: 300 }); // 200 → dobra
    tracker.move(2, { x: 350, y: 300 }); // 50 → metade
    expect(scales).toEqual(['a:2.00', 'a:0.50']);
  });

  it('parte do tamanho que o item já tinha', () => {
    const { tracker, scales } = setup({ selected: 'b' }); // b tem tamanho 2
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.move(2, { x: 450, y: 300 }); // 1,5×
    expect(scales).toEqual(['b:3.00']);
  });

  it('girar e afastar ao mesmo tempo atualiza giro e tamanho', () => {
    const { tracker, log, scales } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.move(2, { x: 300, y: 500 }); // 90° na tela e distância 200
    expect(log).toEqual(['rotate:a:-90']);
    expect(scales).toEqual(['a:2.00']);
  });

  it('só girar (mesma distância) não muda o tamanho além do mesmo valor', () => {
    const { tracker, scales } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.move(2, { x: 300, y: 400 });
    expect(scales).toEqual(['a:1.00']);
  });

  it('soltar um dedo encerra a pinça; o dedo que sobra não muda o tamanho', () => {
    const { tracker, scales } = setup({ selected: 'a' });
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.up(2);
    tracker.move(1, { x: 900, y: 900 });
    expect(scales).toEqual([]);
  });

  it('um novo gesto parte do tamanho do momento, não do início do anterior', () => {
    let current = 1;
    const log: string[] = [];
    const tracker = new GestureTracker({
      pick: () => null,
      select: () => {},
      startDrag: () => null,
      selectedId: () => 'a',
      rotationZ: () => 0,
      rotate: () => {},
      scaleOf: () => current,
      rescale: (_id, value) => {
        current = value;
        log.push(value.toFixed(2));
      },
    });
    tracker.down(1, { x: 0, y: 0 });
    tracker.down(2, { x: 100, y: 0 });
    tracker.move(2, { x: 200, y: 0 }); // 2×
    tracker.up(2);
    tracker.up(1);
    tracker.down(3, { x: 0, y: 0 });
    tracker.down(4, { x: 100, y: 0 });
    tracker.move(4, { x: 150, y: 0 }); // 1,5× de 2
    expect(log).toEqual(['2.00', '3.00']);
  });

  it('item sem giro mas com tamanho (hipotético) ainda faz pinça; sem os dois, nada', () => {
    const { tracker, scales } = setup({ selected: 'audio' }); // audio: rotationZ e scaleOf null
    tracker.down(1, { x: 300, y: 300 });
    tracker.down(2, { x: 400, y: 300 });
    tracker.move(2, { x: 500, y: 300 });
    expect(scales).toEqual([]);
  });
});

describe('itens que só aceitam um dos dois ajustes', () => {
  function custom(rotation: number | null, scale: number | null) {
    const calls: string[] = [];
    const tracker = new GestureTracker({
      pick: () => null,
      select: () => {},
      startDrag: () => null,
      selectedId: () => 'x',
      rotationZ: () => rotation,
      rotate: () => calls.push('rotate'),
      scaleOf: () => scale,
      rescale: () => calls.push('rescale'),
    });
    tracker.down(1, { x: 0, y: 0 });
    tracker.down(2, { x: 100, y: 0 });
    tracker.move(2, { x: 0, y: 200 });
    return calls;
  }

  it('só giro: não chama o tamanho', () => {
    expect(custom(0, null)).toEqual(['rotate']);
  });

  it('só tamanho: não chama o giro', () => {
    expect(custom(null, 1)).toEqual(['rescale']);
  });
});
