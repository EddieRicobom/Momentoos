import { describe, expect, it } from 'vitest';
import { snapAngle, snapBox, snapPosition, spotPosition, TARGET_SPOTS } from '../src/scene/snapping';

describe('snapPosition', () => {
  it('gruda no centro quando está perto', () => {
    expect(snapPosition(0.012, -0.015, 0.75)).toEqual({ x: 0, y: 0, snappedX: true, snappedY: true });
  });

  it('não mexe quando está longe das linhas', () => {
    expect(snapPosition(0.2, 0.1, 0.75)).toEqual({ x: 0.2, y: 0.1, snappedX: false, snappedY: false });
  });

  it('gruda nas bordas do alvo (largura 1, altura = proporção)', () => {
    const r = snapPosition(0.495, 0.37, 0.75);
    expect(r.x).toBe(0.5);
    expect(r.y).toBe(0.375);
    expect(r.snappedX && r.snappedY).toBe(true);
  });

  it('cada eixo gruda sozinho', () => {
    const r = snapPosition(0.005, 0.2, 0.75);
    expect(r).toEqual({ x: 0, y: 0.2, snappedX: true, snappedY: false });
  });

  it('proporção inválida usa o padrão sem estourar', () => {
    expect(snapPosition(0, 0.37, Number.NaN).snappedY).toBe(true);
  });

  it('encaixa em incrementos de 5% somente quando a grade está ligada', () => {
    expect(snapPosition(0.18, 0.13, 0.75, undefined, true)).toEqual({ x: 0.2, y: 0.15, snappedX: true, snappedY: true });
    expect(snapPosition(0.18, 0.13, 0.75)).toEqual({ x: 0.18, y: 0.13, snappedX: false, snappedY: false });
  });
});

describe('snapBox', () => {
  it('encosta a borda do item na borda do alvo, não o centro', () => {
    const r = snapBox(0.39, 0, 0.1, 0.1, 0.75);
    expect(r.x).toBeCloseTo(0.4, 9);
    expect(r.guideX).toBe(0.5);
    expect(r.y).toBe(0);
    expect(r.guideY).toBe(0);
  });

  it('alinha com o centro e com as bordas de outro item', () => {
    const other = { minX: 0.1, maxX: 0.3, minY: -0.1, maxY: 0.1 };
    expect(snapBox(0.205, -0.25, 0.05, 0.05, 0.75, [other])).toMatchObject({ x: 0.2, guideX: 0.2, snappedX: true });
    const touching = snapBox(0.055, -0.25, 0.05, 0.05, 0.75, [other]);
    expect(touching.x).toBeCloseTo(0.05, 9);
    expect(touching.guideX).toBe(0.1);
  });

  it('sem linha por perto, só usa a grade se ela estiver ligada', () => {
    expect(snapBox(0.18, 0.13, 0.01, 0.01, 0.75)).toMatchObject({ x: 0.18, y: 0.13, snappedX: false, guideX: null });
    expect(snapBox(0.18, 0.13, 0.01, 0.01, 0.75, [], undefined, true)).toMatchObject({ x: 0.2, y: 0.15, snappedX: true, guideX: null });
  });
});

describe('spotPosition', () => {
  const box = { minX: -0.1, maxX: 0.1, minY: -0.05, maxY: 0.05 };

  it('encosta a caixa nos cantos e lados, com margem', () => {
    expect(spotPosition('top-left', box, 0.75)).toEqual([-0.38, 0.305]);
    expect(spotPosition('bottom-right', box, 0.75)).toEqual([0.38, -0.305]);
    expect(spotPosition('center', box, 0.75)).toEqual([0, 0]);
    expect(TARGET_SPOTS).toHaveLength(9);
  });

  it('centraliza a caixa deslocada da origem e itens maiores que o alvo', () => {
    expect(spotPosition('center', { minX: 0, maxX: 0.2, minY: 0, maxY: 0.4 }, 0.75)).toEqual([-0.1, -0.2]);
    expect(spotPosition('right', { minX: -0.6, maxX: 0.6, minY: -0.1, maxY: 0.1 }, 0.75)[0]).toBe(0);
  });
});

describe('snapAngle', () => {
  it('gruda em 0, 45 e 90 graus', () => {
    expect(snapAngle(2)).toEqual({ degrees: 0, snapped: true });
    expect(snapAngle(-44)).toEqual({ degrees: -45, snapped: true });
    expect(snapAngle(92)).toEqual({ degrees: 90, snapped: true });
  });

  it('não gruda longe dos pontos', () => {
    expect(snapAngle(20)).toEqual({ degrees: 20, snapped: false });
  });

  it('-180 e 180 são o mesmo ponto (devolve 180)', () => {
    expect(snapAngle(-179).degrees).toBe(180);
    expect(snapAngle(178).degrees).toBe(180);
  });
});
