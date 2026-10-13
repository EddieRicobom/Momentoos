import { describe, expect, it } from 'vitest';
import {
  MAX_TARGET_SIDE,
  MIN_TARGET_SIDE,
  checkTargetSize,
  computeTargetSize,
} from '../src/tracking/imagePrep';

describe('computeTargetSize', () => {
  it('não mexe em imagens que já cabem no limite', () => {
    expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600, scale: 1 });
    expect(computeTargetSize(MAX_TARGET_SIDE, 300).scale).toBe(1);
  });

  it('reduz pelo maior lado mantendo a proporção (paisagem)', () => {
    const size = computeTargetSize(4000, 3000);
    expect(size.width).toBe(MAX_TARGET_SIDE);
    expect(size.height).toBe(768);
    expect(size.scale).toBeCloseTo(0.256, 5);
  });

  it('reduz pelo maior lado mantendo a proporção (retrato)', () => {
    const size = computeTargetSize(3000, 4000);
    expect(size.height).toBe(MAX_TARGET_SIDE);
    expect(size.width).toBe(768);
  });

  it('a proporção final fica próxima da original', () => {
    const size = computeTargetSize(4032, 3024);
    expect(size.width / size.height).toBeCloseTo(4032 / 3024, 2);
  });

  it('respeita um limite personalizado', () => {
    expect(computeTargetSize(2000, 1000, 500)).toEqual({ width: 500, height: 250, scale: 0.25 });
  });

  it('nunca produz dimensão zero em imagens extremamente alongadas', () => {
    const size = computeTargetSize(100000, 10);
    expect(size.width).toBe(MAX_TARGET_SIDE);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });

  it.each([
    [0, 100],
    [100, 0],
    [-1, 50],
    [Number.NaN, 50],
    [50, Number.POSITIVE_INFINITY],
  ])('rejeita dimensões inválidas (%s × %s)', (width, height) => {
    expect(() => computeTargetSize(width, height)).toThrow(RangeError);
  });
});

describe('checkTargetSize', () => {
  it('aceita imagens com o menor lado no mínimo ou acima', () => {
    expect(checkTargetSize(MIN_TARGET_SIDE, 500)).toEqual({ ok: true });
    expect(checkTargetSize(1024, 768)).toEqual({ ok: true });
  });

  it('recusa imagens pequenas demais e explica o motivo', () => {
    const result = checkTargetSize(MIN_TARGET_SIDE - 1, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(String(MIN_TARGET_SIDE));
  });
});
