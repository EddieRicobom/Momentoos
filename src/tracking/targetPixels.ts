/**
 * Preparo dos pixels da foto antes de compilar o alvo. Funções puras sobre
 * arrays (sem DOM), para poderem ser testadas em Node.
 *
 * Por que isto existe (conferido no código do mind-ar 1.2.5):
 *  - O compilador converte a foto em cinza pela MÉDIA (R+G+B)/3
 *    (compiler-base.js), enquanto a câmera ao vivo é convertida com pesos de
 *    luminância 0,299/0,587/0,114 (input-loader.js). Convertendo nós mesmos com
 *    os pesos da câmera, o alvo e o quadro ao vivo passam a ter o mesmo cinza.
 *  - Os limiares de detecção de pontos são valores ABSOLUTOS de intensidade;
 *    foto lavada ou de baixo contraste rende menos pontos. Esticar o contraste
 *    por percentil é uma transformação global e quase monotônica, que não
 *    muda a ordem das intensidades (e é nela que os descritores FREAK se baseiam).
 *  - O detector reparte os pontos em uma grade 10×10 sobre a imagem inteira.
 *    Pele e fundo gastam células; recortar na tatuagem devolve as células a ela.
 *
 * O QUE NÃO FOI MEDIDO: o efeito disso no reconhecimento de tatuagens reais.
 * Os modos abaixo são hipóteses fundamentadas, a validar no celular.
 *
 * Preto e branco puro (binarização) NÃO é oferecido de propósito: ele apaga os
 * gradientes dos quais o detector e o rastreador dependem e se afasta do que a
 * câmera vê.
 */
import { padRect, type NormalizedRect } from './cropGeometry';

export type EnhanceMode = 'none' | 'balanced' | 'strong';

export const ENHANCE_MODES: readonly EnhanceMode[] = ['none', 'balanced', 'strong'];

/** Mesmos pesos que o MindAR usa no quadro da câmera (input-loader.js). */
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

/** Converte RGBA em cinza com os pesos de luminância da câmera do MindAR. */
export function rgbaToLuma(rgba: ArrayLike<number>, pixelCount: number): Uint8Array {
  const gray = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    gray[i] = Math.round(LUMA_R * rgba[o]! + LUMA_G * rgba[o + 1]! + LUMA_B * rgba[o + 2]!);
  }
  return gray;
}

function histogram(gray: Uint8Array): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]!]!++;
  return hist;
}

/**
 * Estica linearmente o contraste: o percentil `lowPct` vira 0 e o `highPct` vira
 * 255. Imagem quase lisa (faixa útil < 8 níveis) é devolvida sem mudança, para
 * não amplificar só ruído.
 */
export function percentileStretch(gray: Uint8Array, lowPct = 1, highPct = 99): Uint8Array {
  const out = new Uint8Array(gray.length);
  if (gray.length === 0) return out;
  const hist = histogram(gray);
  const total = gray.length;

  const level = (pct: number): number => {
    const target = (total * pct) / 100;
    let cumulative = 0;
    for (let v = 0; v < 256; v++) {
      cumulative += hist[v]!;
      if (cumulative >= target) return v;
    }
    return 255;
  };
  const lo = level(lowPct);
  const hi = level(highPct);
  if (hi - lo < 8) {
    out.set(gray);
    return out;
  }
  const scale = 255 / (hi - lo);
  for (let i = 0; i < gray.length; i++) {
    const v = (gray[i]! - lo) * scale;
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  return out;
}

export interface ClaheOptions {
  tilesX?: number;
  tilesY?: number;
  /** Múltiplo da altura média do histograma em que ele é cortado (quanto maior, mais contraste local). */
  clipLimit?: number;
}

/**
 * Equalização adaptativa de histograma com limite de contraste (CLAHE):
 * realça contraste LOCAL (traços finos em áreas escuras ou claras) sem estourar
 * o ruído, e interpola entre blocos vizinhos para não deixar emendas.
 */
export function claheEqualize(
  gray: Uint8Array,
  width: number,
  height: number,
  options: ClaheOptions = {},
): Uint8Array {
  const out = new Uint8Array(gray.length);
  if (width <= 0 || height <= 0 || gray.length !== width * height) {
    out.set(gray.subarray(0, out.length));
    return out;
  }
  const tilesX = Math.max(1, Math.min(options.tilesX ?? 8, width));
  const tilesY = Math.max(1, Math.min(options.tilesY ?? 8, height));
  const clipLimit = options.clipLimit ?? 3;

  const tileOfX = (x: number): number => Math.min(tilesX - 1, Math.floor((x * tilesX) / width));
  const tileOfY = (y: number): number => Math.min(tilesY - 1, Math.floor((y * tilesY) / height));

  const hists: Uint32Array[] = [];
  const counts: number[] = [];
  for (let t = 0; t < tilesX * tilesY; t++) {
    hists.push(new Uint32Array(256));
    counts.push(0);
  }
  for (let y = 0; y < height; y++) {
    const ty = tileOfY(y);
    for (let x = 0; x < width; x++) {
      const t = ty * tilesX + tileOfX(x);
      hists[t]![gray[y * width + x]!]!++;
      counts[t]!++;
    }
  }

  // Uma tabela de mapeamento (256 níveis) por bloco, a partir do histograma cortado.
  const luts: Uint8Array[] = hists.map((hist, t) => {
    const count = counts[t]!;
    const lut = new Uint8Array(256);
    if (count === 0) {
      for (let v = 0; v < 256; v++) lut[v] = v;
      return lut;
    }
    const clip = Math.max(1, Math.floor((clipLimit * count) / 256));
    let excess = 0;
    const clipped = new Float64Array(256);
    for (let v = 0; v < 256; v++) {
      const c = hist[v]!;
      if (c > clip) {
        excess += c - clip;
        clipped[v] = clip;
      } else {
        clipped[v] = c;
      }
    }
    const share = excess / 256;
    let cumulative = 0;
    for (let v = 0; v < 256; v++) {
      cumulative += clipped[v]! + share;
      lut[v] = Math.min(255, Math.round((cumulative * 255) / count));
    }
    return lut;
  });

  const tileW = width / tilesX;
  const tileH = height / tilesY;
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) / tileH - 0.5;
    const y0 = Math.max(0, Math.min(tilesY - 1, Math.floor(fy)));
    const y1 = Math.min(tilesY - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / tileW - 0.5;
      const x0 = Math.max(0, Math.min(tilesX - 1, Math.floor(fx)));
      const x1 = Math.min(tilesX - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, fx - x0));
      const v = gray[y * width + x]!;
      const a = luts[y0 * tilesX + x0]![v]!;
      const b = luts[y0 * tilesX + x1]![v]!;
      const c = luts[y1 * tilesX + x0]![v]!;
      const d = luts[y1 * tilesX + x1]![v]!;
      const top = a + (b - a) * wx;
      const bottom = c + (d - c) * wx;
      out[y * width + x] = Math.round(top + (bottom - top) * wy);
    }
  }
  return out;
}

/** Aplica o modo escolhido sobre uma imagem já em cinza. */
export function enhanceGray(gray: Uint8Array, width: number, height: number, mode: EnhanceMode): Uint8Array {
  if (mode === 'none') return gray;
  const stretched = percentileStretch(gray);
  if (mode === 'balanced') return stretched;
  return claheEqualize(stretched, width, height);
}

/**
 * Processa um buffer RGBA no lugar. Em 'none' não mexe em nada (a foto vai
 * como está). Nos outros modos o resultado é cinza (R=G=B) e alfa 255, de modo
 * que a média (R+G+B)/3 do compilador devolva exatamente o cinza calculado aqui.
 */
export function applyEnhancement(rgba: Uint8ClampedArray, width: number, height: number, mode: EnhanceMode): void {
  if (mode === 'none') return;
  const pixels = width * height;
  const gray = enhanceGray(rgbaToLuma(rgba, pixels), width, height, mode);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const v = gray[i]!;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
}

// ------------------------------------------------------------ sugestão de área

const SUGGEST_MAX_SIDE = 128;
const CELL = 4;

/**
 * Sugere o retângulo (normalizado) que contém a tatuagem, assumindo tinta MAIS
 * ESCURA que a pele ao redor. Devolve null quando não há uma área clara (foto
 * lisa, tatuagem clara/colorida demais, tatuagem que ocupa quase tudo).
 *
 * É uma heurística simples, sem validação com tatuagens reais: a interface
 * sempre mostra o retângulo para a pessoa conferir e ajustar.
 */
export function suggestCropBox(gray: Uint8Array, width: number, height: number): NormalizedRect | null {
  if (width < 16 || height < 16 || gray.length !== width * height) return null;

  // Reduz por média de blocos para trabalhar com no máximo ~128 px no maior lado.
  const factor = Math.max(1, Math.floor(Math.max(width, height) / SUGGEST_MAX_SIDE));
  const sw = Math.floor(width / factor);
  const sh = Math.floor(height / factor);
  const small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let sum = 0;
      for (let j = 0; j < factor; j++) {
        for (let i = 0; i < factor; i++) sum += gray[(y * factor + j) * width + (x * factor + i)]!;
      }
      small[y * sw + x] = sum / (factor * factor);
    }
  }

  const sorted = Float32Array.from(small).sort();
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const deviations = Float32Array.from(small, (v) => Math.abs(v - median)).sort();
  const mad = deviations[Math.floor(deviations.length / 2)]!;
  const sigma = Math.max(mad * 1.4826, 6);
  const threshold = median - 2.5 * sigma;

  const cellsX = Math.floor(sw / CELL);
  const cellsY = Math.floor(sh / CELL);
  if (cellsX < 3 || cellsY < 3) return null;

  const on = new Uint8Array(cellsX * cellsY);
  let maskTotal = 0;
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      let dark = 0;
      for (let j = 0; j < CELL; j++) {
        for (let i = 0; i < CELL; i++) {
          if (small[(cy * CELL + j) * sw + (cx * CELL + i)]! < threshold) dark++;
        }
      }
      if (dark >= (CELL * CELL) / 4) {
        on[cy * cellsX + cx] = 1;
        maskTotal++;
      }
    }
  }
  if (maskTotal === 0) return null;

  // Descarta células isoladas (pelo, sujeira, sombra pequena): exige um vizinho ligado.
  let minX = cellsX;
  let minY = cellsY;
  let maxX = -1;
  let maxY = -1;
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      if (!on[cy * cellsX + cx]) continue;
      let neighbours = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          if (i === 0 && j === 0) continue;
          const nx = cx + i;
          const ny = cy + j;
          if (nx >= 0 && ny >= 0 && nx < cellsX && ny < cellsY && on[ny * cellsX + nx]) neighbours++;
        }
      }
      if (neighbours === 0) continue;
      minX = Math.min(minX, cx);
      minY = Math.min(minY, cy);
      maxX = Math.max(maxX, cx);
      maxY = Math.max(maxY, cy);
    }
  }
  if (maxX < 0) return null;

  const box: NormalizedRect = {
    x: minX / cellsX,
    y: minY / cellsY,
    w: (maxX - minX + 1) / cellsX,
    h: (maxY - minY + 1) / cellsY,
  };
  const area = box.w * box.h;
  // Pequena demais (provável ruído) ou quase a foto toda (recorte não ajuda).
  if (area < 0.03 || area > 0.9) return null;

  return padRect(box, 0.1);
}
