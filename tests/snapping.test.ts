import { describe, expect, it } from 'vitest';
import { snapAngle, snapPosition } from '../src/scene/snapping';

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
