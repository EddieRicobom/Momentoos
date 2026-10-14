import * as tf from '@tensorflow/tfjs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NORMALIZE, FrameAlternator, normalizeLocalContrast } from '../src/tracking/frameNormalize';

function rows(t: tf.Tensor2D): number[][] {
  return t.arraySync() as number[][];
}

/** Desvio-padrão dos valores num retângulo [x0,x1) x [y0,y1). */
function stdIn(grid: number[][], x0: number, x1: number, y0: number, y1: number): number {
  const vals: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(grid[y]![x]!);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
}

function checker(width: number, height: number, fn: (x: number, y: number) => number): tf.Tensor2D {
  const data: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) row.push(fn(x, y));
    data.push(row);
  }
  return tf.tensor2d(data);
}

describe('normalizeLocalContrast', () => {
  it('imagem lisa vira cinza médio, sem estourar nem dar NaN', () => {
    const input = tf.fill([40, 60], 77) as tf.Tensor2D;
    const out = normalizeLocalContrast(input);
    const values = rows(out).flat();
    expect(values.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.max(...values)).toBeCloseTo(128, 1);
    expect(Math.min(...values)).toBeCloseTo(128, 1);
    input.dispose();
    out.dispose();
  });

  it('iguala o contraste de uma metade sombreada com o da metade iluminada', () => {
    // mesmo padrão em xadrez; a metade esquerda está na sombra (contraste 8 vezes menor)
    const input = checker(120, 60, (x, y) => {
      const bit = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
      return x < 60 ? 100 + bit * 10 : 100 + bit * 80;
    });
    const out = normalizeLocalContrast(input, { window: 17, targetStd: 35, maxGain: 20 });
    const before = rows(input);
    const after = rows(out);
    const ratioBefore = stdIn(before, 70, 110, 10, 50) / stdIn(before, 10, 50, 10, 50);
    const ratioAfter = stdIn(after, 70, 110, 10, 50) / stdIn(after, 10, 50, 10, 50);
    expect(ratioBefore).toBeGreaterThan(7);
    expect(ratioAfter).toBeLessThan(1.6);
    input.dispose();
    out.dispose();
  });

  it('limita o ganho: ruído fraco em área lisa não vira textura forte', () => {
    const noise = checker(80, 80, (x, y) => 120 + (((x * 7 + y * 13) % 5) - 2)); // ±2 níveis
    const out = normalizeLocalContrast(noise, { window: 17, targetStd: 35, maxGain: 3 });
    const sd = stdIn(rows(out), 20, 60, 20, 60);
    const sdIn = stdIn(rows(noise), 20, 60, 20, 60);
    expect(sd).toBeLessThanOrEqual(sdIn * 3 + 0.5);
    noise.dispose();
    out.dispose();
  });

  it('mantém a forma, valores entre 0 e 255 e não mexe na entrada', () => {
    const input = checker(50, 30, (x) => (x % 2 === 0 ? 0 : 255));
    const copy = rows(input).map((r) => [...r]);
    const out = normalizeLocalContrast(input);
    expect(out.shape).toEqual([30, 50]);
    const values = rows(out).flat();
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(255);
    expect(rows(input)).toEqual(copy);
    input.dispose();
    out.dispose();
  });

  it('não vaza tensores', () => {
    const input = checker(40, 40, (x, y) => (x * y) % 255);
    const before = tf.memory().numTensors;
    normalizeLocalContrast(input).dispose();
    expect(tf.memory().numTensors).toBe(before);
    input.dispose();
  });

  it('o ganho padrão é limitado (ruído de pele não vira textura)', () => {
    expect(DEFAULT_NORMALIZE.maxGain).toBeLessThanOrEqual(3);
  });
});

describe('FrameAlternator', () => {
  it('alterna normalizado / cru começando por normalizado', () => {
    const a = new FrameAlternator();
    expect([a.next(), a.next(), a.next(), a.next()]).toEqual([true, false, true, false]);
  });
});
