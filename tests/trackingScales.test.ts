import { describe, expect, it } from 'vitest';
import {
  TRACKING_POINTS_GOOD,
  TRACKING_SIDES,
  pickTrackingSet,
  trackingQuality,
  trackingRatios,
} from '../src/tracking/trackingScales';

const set = (n: number) => ({ points: new Array(n).fill(0) });

describe('trackingRatios', () => {
  it('do mais barato ao mais detalhado, sem ampliar o alvo', () => {
    expect(trackingRatios(600, 720)).toEqual(TRACKING_SIDES.map((s) => s / 600));
    expect(trackingRatios(300, 500)).toEqual([128 / 300, 192 / 300, 256 / 300]);
    expect(trackingRatios(130, 500)).toEqual([128 / 130]);
  });

  it('alvo menor que o menor candidato ainda tem uma escala', () => {
    expect(trackingRatios(100, 100)).toEqual([1]);
  });
});

describe('pickTrackingSet', () => {
  it('fica com o primeiro que tem pontos suficientes (barato)', () => {
    const a = set(TRACKING_POINTS_GOOD);
    const b = set(40);
    expect(pickTrackingSet([a, b])).toBe(a);
  });

  it('se ninguém basta, escolhe o com mais pontos; empate fica com o mais barato', () => {
    const a = set(3);
    const b = set(9);
    const c = set(9);
    expect(pickTrackingSet([a, b, c])).toBe(b);
  });

  it('um candidato só', () => {
    const a = set(0);
    expect(pickTrackingSet([a])).toBe(a);
  });
});

describe('trackingQuality', () => {
  it('classifica pelo número de pontos', () => {
    expect(trackingQuality(0)).toBe('none');
    expect(trackingQuality(3)).toBe('none');
    expect(trackingQuality(4)).toBe('low');
    expect(trackingQuality(7)).toBe('low');
    expect(trackingQuality(8)).toBe('good');
    expect(trackingQuality(30)).toBe('good');
  });
});

import { smoothGray } from '../src/tracking/trackingScales';

describe('smoothGray', () => {
  it('imagem lisa continua igual e passes=0 devolve cópia', () => {
    const flat = new Uint8Array(20 * 10).fill(90);
    expect(Array.from(smoothGray(flat, 20, 10, 2))).toEqual(Array.from(flat));
    const src = Uint8Array.from({ length: 12 }, (_, i) => i * 20);
    const copy = smoothGray(src, 4, 3, 0);
    expect(Array.from(copy)).toEqual(Array.from(src));
    expect(copy).not.toBe(src);
  });

  it('um ponto brilhante espalha-se de forma simétrica e perde pico', () => {
    const w = 9;
    const img = new Uint8Array(w * w);
    img[4 * w + 4] = 240;
    const out = smoothGray(img, w, w, 1);
    expect(out[4 * w + 4]).toBeLessThan(240);
    expect(out[4 * w + 3]).toBe(out[4 * w + 5]);
    expect(out[3 * w + 4]).toBe(out[5 * w + 4]);
    expect(out[4 * w + 3]).toBeGreaterThan(0);
    expect(out[4 * w + 1]).toBe(0);
  });

  it('mais passadas suavizam mais', () => {
    const w = 15;
    const img = new Uint8Array(w * w);
    img[7 * w + 7] = 255;
    expect(smoothGray(img, w, w, 3)[7 * w + 7]!).toBeLessThan(smoothGray(img, w, w, 1)[7 * w + 7]!);
  });
});
