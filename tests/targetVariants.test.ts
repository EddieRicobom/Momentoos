import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VARIANT_CONFIG,
  applyAffine,
  compressionMatrix,
  keyframeToTarget,
  pickScaleIndexes,
  variantSpecs,
  warpCompressed,
  type GrayImage,
} from '../src/tracking/targetVariants';

function blank(width: number, height: number, value = 128): GrayImage {
  return { data: new Uint8Array(width * height).fill(value), width, height };
}

function paintSquare(img: GrayImage, cx: number, cy: number, half: number, value: number): void {
  for (let y = cy - half; y <= cy + half; y++)
    for (let x = cx - half; x <= cx + half; x++) img.data[y * img.width + x] = value;
}

/** Centro de massa (em px, centro de pixel = +0,5) ponderado pelo brilho acima do fundo. */
function brightCentroid(img: GrayImage, background: number): [number, number] {
  let sx = 0;
  let sy = 0;
  let sum = 0;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const v = img.data[y * img.width + x]! - background;
      if (v > 0) {
        sx += (x + 0.5) * v;
        sy += (y + 0.5) * v;
        sum += v;
      }
    }
  return [sx / sum, sy / sum];
}

describe('compressionMatrix', () => {
  it('comprime só ao longo da direção pedida', () => {
    const [a, b, c, d] = compressionMatrix(2, 0); // direção x
    expect([a, b, c, d]).toEqual([0.5, 0, 0, 1].map((v) => expect.closeTo(v, 10)));
    const m = compressionMatrix(4, Math.PI / 2); // direção y
    expect(m[0]).toBeCloseTo(1, 10);
    expect(m[3]).toBeCloseTo(0.25, 10);
  });

  it('em 45° encurta o vetor diagonal e preserva o perpendicular', () => {
    const [a, b, c, d] = compressionMatrix(3, Math.PI / 4);
    const along = [Math.SQRT1_2, Math.SQRT1_2];
    const across = [-Math.SQRT1_2, Math.SQRT1_2];
    const len = (v: number[]) => Math.hypot(a * v[0]! + b * v[1]!, c * v[0]! + d * v[1]!);
    expect(len(along)).toBeCloseTo(1 / 3, 10);
    expect(len(across)).toBeCloseTo(1, 10);
  });
});

describe('warpCompressed', () => {
  it('encolhe a dimensão comprimida e mantém a outra', () => {
    const w = warpCompressed(blank(120, 80), 2, 0);
    expect(w.width).toBe(60);
    expect(w.height).toBe(80);
  });

  it('o mapa toSource leva cada pixel da variante de volta ao pixel certo do original', () => {
    for (const direction of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
      const src = blank(160, 120, 30);
      paintSquare(src, 100, 40, 6, 250);
      const w = warpCompressed(src, 2.5, direction);
      const [cx, cy] = brightCentroid(w, 30);
      const [sx, sy] = applyAffine(w.toSource, cx, cy);
      expect(sx).toBeCloseTo(100.5, 1);
      expect(sy).toBeCloseTo(40.5, 1);
    }
  });

  it('o conteúdo realmente fica comprimido (quadrado vira retângulo estreito)', () => {
    const src = blank(200, 200, 30);
    paintSquare(src, 100, 100, 20, 250);
    const w = warpCompressed(src, 2, 0);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < w.height; y++)
      for (let x = 0; x < w.width; x++)
        if (w.data[y * w.width + x]! > 140) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
    const widthPx = maxX - minX + 1;
    const heightPx = maxY - minY + 1;
    expect(heightPx).toBeGreaterThan(38);
    expect(widthPx).toBeGreaterThan(heightPx / 2 - 3);
    expect(widthPx).toBeLessThan(heightPx / 2 + 3);
  });

  it('não cria quinas pretas: o fundo fora do original replica a borda', () => {
    const src = blank(100, 100, 200);
    const w = warpCompressed(src, 3, Math.PI / 4);
    const min = Math.min(...w.data);
    expect(min).toBeGreaterThanOrEqual(199);
  });

  it('não serrilha: lista de tiras finas vira cinza intermediário (filtro de média)', () => {
    const src = blank(200, 40, 0);
    for (let x = 0; x < 200; x += 2) for (let y = 0; y < 40; y++) src.data[y * 200 + x] = 255;
    const w = warpCompressed(src, 2, 0);
    const mid = w.data[20 * w.width + 50]!;
    expect(mid).toBeGreaterThan(90);
    expect(mid).toBeLessThan(165);
  });
});

describe('keyframeToTarget', () => {
  it('divide a escala do keyframe antes do mapa da variante', () => {
    const toSource: [number, number, number, number, number, number] = [2, 0, 10, 0, 1, 5];
    const m = keyframeToTarget(toSource, 0.5);
    // pixel (30, 20) do keyframe em escala 0,5 = (60, 40) na variante cheia -> (130, 45)
    const [x, y] = applyAffine(m, 30, 20);
    expect(x).toBeCloseTo(130, 10);
    expect(y).toBeCloseTo(45, 10);
  });
});

describe('variantSpecs / pickScaleIndexes', () => {
  it('gera tilts x direções, cada deformação com um grupo próprio', () => {
    const specs = variantSpecs();
    expect(specs).toHaveLength(DEFAULT_VARIANT_CONFIG.tilts.length * DEFAULT_VARIANT_CONFIG.directions);
    expect(new Set(specs.map((s) => s.group)).size).toBe(specs.length);
    expect(specs.map((s) => s.direction).every((d) => d >= 0 && d < Math.PI)).toBe(true);
  });

  it('escolhe 1 escala a cada `stride`, sempre a primeira', () => {
    expect(pickScaleIndexes(8, 3)).toEqual([0, 3, 6]);
    expect(pickScaleIndexes(2, 3)).toEqual([0]);
    expect(pickScaleIndexes(3, 0)).toEqual([0, 1, 2]);
  });
});
