import { describe, expect, it } from 'vitest';
import {
  FULL_RECT,
  MIN_CROP_FRACTION,
  clampRect,
  dragRect,
  isFullRect,
  padRect,
  rectToPixels,
  type NormalizedRect,
} from '../src/tracking/cropGeometry';

const inside = (r: NormalizedRect): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9 && r.w > 0 && r.h > 0;

describe('clampRect', () => {
  it('mantém um retângulo válido como está', () => {
    expect(clampRect({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 })).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.5 });
  });

  it('traz para dentro da foto e impõe o tamanho mínimo', () => {
    expect(clampRect({ x: 0.95, y: -2, w: 0.5, h: 0.01 })).toEqual({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: MIN_CROP_FRACTION,
    });
  });

  it('valores inválidos (NaN) viram a foto inteira, sem propagar NaN', () => {
    const r = clampRect({ x: Number.NaN, y: Number.NaN, w: Number.NaN, h: Number.NaN });
    expect(r).toEqual(FULL_RECT);
  });
});

describe('dragRect', () => {
  const start: NormalizedRect = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

  it('mover desloca sem mudar o tamanho e para na borda', () => {
    expect(dragRect(start, 'move', 0.1, -0.1)).toEqual({ x: 0.4, y: expect.closeTo(0.2, 10), w: 0.4, h: 0.4 });
    const pushed = dragRect(start, 'move', 5, 5);
    expect(pushed).toEqual({ x: 0.6, y: 0.6, w: 0.4, h: 0.4 });
    const pulled = dragRect(start, 'move', -5, -5);
    expect(pulled).toEqual({ x: 0, y: 0, w: 0.4, h: 0.4 });
  });

  it('cada borda mexe só no seu lado', () => {
    const close = (r: NormalizedRect, e: NormalizedRect): void => {
      expect(r.x).toBeCloseTo(e.x, 10);
      expect(r.y).toBeCloseTo(e.y, 10);
      expect(r.w).toBeCloseTo(e.w, 10);
      expect(r.h).toBeCloseTo(e.h, 10);
    };
    close(dragRect(start, 'e', 0.1, 9), { x: 0.3, y: 0.3, w: 0.5, h: 0.4 });
    close(dragRect(start, 'w', 0.1, 9), { x: 0.4, y: 0.3, w: 0.3, h: 0.4 });
    close(dragRect(start, 'n', 9, -0.1), { x: 0.3, y: 0.2, w: 0.4, h: 0.5 });
    close(dragRect(start, 's', 9, 0.1), { x: 0.3, y: 0.3, w: 0.4, h: 0.5 });
  });

  it('cantos mexem em dois lados', () => {
    const r = dragRect(start, 'se', 0.1, 0.2);
    expect(r.x).toBe(0.3);
    expect(r.y).toBe(0.3);
    expect(r.w).toBeCloseTo(0.5, 10);
    expect(r.h).toBeCloseTo(0.6, 10);
    const nw = dragRect(start, 'nw', -0.1, -0.1);
    expect(nw.x).toBeCloseTo(0.2, 10);
    expect(nw.y).toBeCloseTo(0.2, 10);
    expect(nw.w).toBeCloseTo(0.5, 10);
  });

  it('não deixa passar do mínimo nem inverter ao arrastar uma borda além da oposta', () => {
    const squeezed = dragRect(start, 'e', -9, 0);
    expect(squeezed.w).toBeCloseTo(MIN_CROP_FRACTION, 10);
    expect(squeezed.x).toBe(0.3);
    const squeezedNw = dragRect(start, 'nw', 9, 9);
    expect(squeezedNw.w).toBeCloseTo(MIN_CROP_FRACTION, 10);
    expect(squeezedNw.h).toBeCloseTo(MIN_CROP_FRACTION, 10);
    expect(squeezedNw.x + squeezedNw.w).toBeCloseTo(0.7, 10);
  });

  it('nunca sai da foto, qualquer que seja o arrasto (varredura)', () => {
    const handles = ['move', 'n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const;
    for (const handle of handles) {
      for (const dx of [-3, -0.5, -0.05, 0, 0.05, 0.5, 3]) {
        for (const dy of [-3, -0.5, -0.05, 0, 0.05, 0.5, 3]) {
          const r = dragRect(start, handle, dx, dy);
          expect(inside(r), `${handle} ${dx},${dy} -> ${JSON.stringify(r)}`).toBe(true);
          expect(r.w).toBeGreaterThanOrEqual(MIN_CROP_FRACTION - 1e-9);
          expect(r.h).toBeGreaterThanOrEqual(MIN_CROP_FRACTION - 1e-9);
        }
      }
    }
  });
});

describe('isFullRect / padRect / rectToPixels', () => {
  it('reconhece a foto inteira (e null) com tolerância pequena', () => {
    expect(isFullRect(null)).toBe(true);
    expect(isFullRect(FULL_RECT)).toBe(true);
    expect(isFullRect({ x: 0.002, y: 0, w: 0.997, h: 1 })).toBe(true);
    expect(isFullRect({ x: 0.05, y: 0, w: 0.9, h: 1 })).toBe(false);
  });

  it('padRect aumenta em cada lado e não sai da foto', () => {
    const padded = padRect({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 0.1);
    expect(padded.x).toBeCloseTo(0.38, 10);
    expect(padded.w).toBeCloseTo(0.24, 10);
    expect(padRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, 0.5)).toEqual({ x: 0, y: 0, w: 0.75, h: 0.75 });
  });

  it('rectToPixels devolve inteiros dentro da imagem, com mínimo de 1 px', () => {
    expect(rectToPixels(null, 400, 300)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(rectToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 400, 300)).toEqual({ x: 100, y: 150, w: 200, h: 75 });
    const edge = rectToPixels({ x: 1, y: 1, w: 0.0001, h: 0.0001 }, 400, 300);
    expect(edge.x + edge.w).toBeLessThanOrEqual(400);
    expect(edge.y + edge.h).toBeLessThanOrEqual(300);
    expect(edge.w).toBeGreaterThanOrEqual(1);
  });
});
