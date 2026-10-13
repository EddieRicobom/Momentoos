import { describe, expect, it } from 'vitest';
import {
  applyEnhancement,
  claheEqualize,
  enhanceGray,
  percentileStretch,
  rgbaToLuma,
  suggestCropBox,
} from '../src/tracking/targetPixels';

/** Gerador pseudoaleatório determinístico (os testes não podem variar entre execuções). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface Blob {
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
}

function scene(width: number, height: number, background: number, noise: number, blobs: Blob[] = [], seed = 1): Uint8Array {
  const random = rng(seed);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = background + (random() * 2 - 1) * noise;
      for (const b of blobs) {
        if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) v = b.value + (random() * 2 - 1) * noise;
      }
      gray[y * width + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return gray;
}

const stats = (gray: Uint8Array): { min: number; max: number; std: number } => {
  let min = 255;
  let max = 0;
  let sum = 0;
  for (const v of gray) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  const mean = sum / gray.length;
  let variance = 0;
  for (const v of gray) variance += (v - mean) ** 2;
  return { min, max, std: Math.sqrt(variance / gray.length) };
};

describe('rgbaToLuma', () => {
  it('usa os pesos da câmera do MindAR (0,299/0,587/0,114), não a média', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    expect(Array.from(rgbaToLuma(rgba, 5))).toEqual([76, 150, 29, 255, 0]);
    // A média usada pelo compilador daria 85 para o vermelho puro: é essa a diferença que corrigimos.
    expect(Math.floor((255 + 0 + 0) / 3)).toBe(85);
  });
});

describe('percentileStretch', () => {
  it('abre uma foto lavada (100–140) para a faixa inteira', () => {
    const gray = scene(64, 64, 120, 20);
    const before = stats(gray);
    expect(before.max - before.min).toBeLessThan(45);
    const out = stats(percentileStretch(gray));
    expect(out.min).toBe(0);
    expect(out.max).toBe(255);
    expect(out.std).toBeGreaterThan(before.std * 3);
  });

  it('é monotônica: nunca inverte a ordem das intensidades', () => {
    const gray = scene(64, 64, 120, 30);
    const out = percentileStretch(gray);
    const mapped = new Map<number, number>();
    for (let i = 0; i < gray.length; i++) mapped.set(gray[i]!, out[i]!);
    const keys = [...mapped.keys()].sort((a, b) => a - b);
    for (let i = 1; i < keys.length; i++) {
      expect(mapped.get(keys[i]!)!).toBeGreaterThanOrEqual(mapped.get(keys[i - 1]!)!);
    }
  });

  it('resiste a pixels extremos isolados (corta 1% de cada ponta)', () => {
    const gray = scene(100, 100, 120, 15);
    gray[5] = 0;
    gray[9000] = 255;
    const out = stats(percentileStretch(gray));
    // Sem o corte por percentil, esses dois pixels impediriam qualquer esticamento.
    expect(out.std).toBeGreaterThan(stats(gray).std * 2);
  });

  it('imagem lisa (quase sem variação) é devolvida sem mudança', () => {
    const flat = new Uint8Array(400).fill(100);
    expect(Array.from(percentileStretch(flat))).toEqual(Array.from(flat));
    const almostFlat = scene(20, 20, 100, 2);
    expect(Array.from(percentileStretch(almostFlat))).toEqual(Array.from(almostFlat));
  });

  it('entrada vazia não quebra', () => {
    expect(percentileStretch(new Uint8Array(0)).length).toBe(0);
  });
});

describe('claheEqualize', () => {
  it('aumenta o contraste local e mantém todos os valores em 0–255', () => {
    // Gradiente suave com textura fraca: o caso em que o contraste local ajuda.
    // 256×256 (blocos de 32 px): com blocos minúsculos o corte do histograma vira
    // quase identidade; as fotos reais têm até 1024 px.
    const w = 256;
    const h = 256;
    const random = rng(7);
    const gray = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) gray[y * w + x] = Math.round(90 + (x / w) * 40 + (random() - 0.5) * 8);
    }
    const out = claheEqualize(gray, w, h);
    expect(out.length).toBe(gray.length);

    // Contraste LOCAL = desvio médio dentro de blocos de 16×16. O CLAHE limita o
    // ganho local (~clipLimit×) e preserva a estrutura global de propósito, por
    // isso o desvio da imagem inteira quase não muda; o dos blocos sim.
    const localStd = (img: Uint8Array): number => {
      const block = 16;
      let total = 0;
      let blocks = 0;
      for (let by = 0; by + block <= h; by += block) {
        for (let bx = 0; bx + block <= w; bx += block) {
          const values: number[] = [];
          for (let y = by; y < by + block; y++) for (let x = bx; x < bx + block; x++) values.push(img[y * w + x]!);
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          total += Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
          blocks++;
        }
      }
      return total / blocks;
    };
    expect(localStd(out)).toBeGreaterThan(localStd(gray) * 2);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('imagem lisa continua lisa (não inventa textura)', () => {
    const flat = new Uint8Array(64 * 64).fill(100);
    const out = claheEqualize(flat, 64, 64);
    expect(new Set(out).size).toBe(1);
  });

  it('funciona com tamanhos que não são múltiplos da grade, sem NaN', () => {
    const w = 37;
    const h = 29;
    const gray = scene(w, h, 120, 40);
    const out = claheEqualize(gray, w, h);
    expect(out.length).toBe(w * h);
    expect(out.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  });

  it('imagem menor que a grade usa menos blocos em vez de falhar', () => {
    const gray = scene(5, 3, 120, 40);
    expect(claheEqualize(gray, 5, 3).length).toBe(15);
  });

  it('dimensões inconsistentes com o buffer: devolve cópia, sem lançar', () => {
    const gray = new Uint8Array(10).fill(7);
    expect(Array.from(claheEqualize(gray, 4, 4))).toEqual(Array.from(gray.subarray(0, 10)).concat(new Array(10 - 10).fill(0)));
  });

  it('não altera o buffer de entrada', () => {
    const gray = scene(32, 32, 120, 40);
    const copy = gray.slice();
    claheEqualize(gray, 32, 32);
    expect(Array.from(gray)).toEqual(Array.from(copy));
  });
});

describe('enhanceGray / applyEnhancement', () => {
  it('"none" devolve a mesma imagem; "strong" difere de "balanced"', () => {
    const gray = scene(64, 64, 120, 25, [{ x: 10, y: 10, w: 20, h: 20, value: 90 }]);
    expect(enhanceGray(gray, 64, 64, 'none')).toBe(gray);
    const balanced = enhanceGray(gray, 64, 64, 'balanced');
    const strong = enhanceGray(gray, 64, 64, 'strong');
    expect(Array.from(balanced)).not.toEqual(Array.from(gray));
    expect(Array.from(strong)).not.toEqual(Array.from(balanced));
  });

  it('"none" não mexe em nenhum byte do RGBA', () => {
    const rgba = new Uint8ClampedArray(4 * 16).map((_, i) => (i * 37) % 256);
    const copy = rgba.slice();
    applyEnhancement(rgba, 4, 4, 'none');
    expect(Array.from(rgba)).toEqual(Array.from(copy));
  });

  it('"balanced" grava cinza puro (R=G=B), alfa 255, e a média do compilador bate com o cinza', () => {
    const width = 32;
    const height = 32;
    const random = rng(3);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = 100 + Math.floor(random() * 40);
      rgba[i * 4 + 1] = 90 + Math.floor(random() * 40);
      rgba[i * 4 + 2] = 80 + Math.floor(random() * 40);
      rgba[i * 4 + 3] = 255;
    }
    const expected = enhanceGray(rgbaToLuma(rgba, width * height), width, height, 'balanced');
    applyEnhancement(rgba, width, height, 'balanced');
    for (let i = 0; i < width * height; i++) {
      expect(rgba[i * 4]).toBe(expected[i]);
      expect(rgba[i * 4 + 1]).toBe(expected[i]);
      expect(rgba[i * 4 + 2]).toBe(expected[i]);
      expect(rgba[i * 4 + 3]).toBe(255);
      // Fórmula do compilador do MindAR: floor((R+G+B)/3) deve devolver o mesmo cinza.
      expect(Math.floor((rgba[i * 4]! + rgba[i * 4 + 1]! + rgba[i * 4 + 2]!) / 3)).toBe(expected[i]);
    }
  });
});

describe('suggestCropBox', () => {
  const W = 200;
  const H = 150;

  it('envolve uma mancha escura sobre fundo claro, com folga, sem pegar a foto toda', () => {
    const gray = scene(W, H, 190, 5, [{ x: 60, y: 40, w: 60, h: 60, value: 50 }]);
    const box = suggestCropBox(gray, W, H)!;
    expect(box).not.toBeNull();
    // Contém a mancha (x 0,30–0,60; y 0,267–0,667).
    expect(box.x).toBeLessThanOrEqual(0.3);
    expect(box.y).toBeLessThanOrEqual(40 / H);
    expect(box.x + box.w).toBeGreaterThanOrEqual(0.6);
    expect(box.y + box.h).toBeGreaterThanOrEqual(100 / H);
    // Mas é bem menor que a foto.
    expect(box.w * box.h).toBeLessThan(0.5);
  });

  it('ignora uma mancha pequena e isolada longe da tatuagem', () => {
    const gray = scene(W, H, 190, 5, [
      { x: 60, y: 40, w: 60, h: 60, value: 50 },
      { x: 8, y: 8, w: 3, h: 3, value: 40 },
    ]);
    const box = suggestCropBox(gray, W, H)!;
    expect(box.x).toBeGreaterThan(0.1);
    expect(box.y).toBeGreaterThan(0.1);
  });

  it('foto lisa, sem nada escuro: sem sugestão', () => {
    expect(suggestCropBox(scene(W, H, 190, 5), W, H)).toBeNull();
  });

  it('mancha minúscula (ruído): sem sugestão', () => {
    const gray = scene(W, H, 190, 5, [{ x: 90, y: 70, w: 8, h: 8, value: 40 }]);
    expect(suggestCropBox(gray, W, H)).toBeNull();
  });

  it('tatuagem que ocupa quase tudo: sem sugestão (recorte não ajudaria)', () => {
    const gray = scene(W, H, 190, 5, [{ x: 4, y: 4, w: 192, h: 142, value: 50 }]);
    expect(suggestCropBox(gray, W, H)).toBeNull();
  });

  it('entradas inválidas ou minúsculas: sem sugestão e sem lançar', () => {
    expect(suggestCropBox(new Uint8Array(4), 2, 2)).toBeNull();
    expect(suggestCropBox(new Uint8Array(10), W, H)).toBeNull();
  });

  it('o resultado fica sempre dentro da foto', () => {
    const gray = scene(W, H, 190, 5, [{ x: 0, y: 0, w: 70, h: 60, value: 50 }]);
    const box = suggestCropBox(gray, W, H)!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(box.y + box.h).toBeLessThanOrEqual(1 + 1e-9);
  });
});
