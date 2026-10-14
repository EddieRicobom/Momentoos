/**
 * Variantes "esticadas/inclinadas" do alvo (parte pura, testável em Node).
 *
 * Por que isto existe: os descritores do MindAR (FREAK) são invariantes a
 * escala e rotação no plano, mas não a esticar/achatar nem a inclinações
 * fortes. Numa tatuagem a pele se deforma e o celular fica em ângulos
 * estranhos, e a imagem do alvo (de frente, plana) deixa de parecer com o que
 * a câmera vê. A saída clássica (ASIFT) é "pré-deformar" o alvo: compilar
 * também versões comprimidas em algumas direções, e reconhecer contra todas.
 *
 * Esticar a imagem 1,6× num eixo equivale, a menos de escala uniforme (que o
 * MindAR já cobre), a comprimir o outro eixo 1,6×. Por isso as variantes são
 * só compressões ("tilts") em várias direções.
 */

/** Imagem em tons de cinza, 1 byte por pixel. */
export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** x' = a·x + b·y + tx ; y' = c·x + d·y + ty (linha a linha: [a, b, tx, c, d, ty]). */
export type Affine = [number, number, number, number, number, number];

export interface VariantSpec {
  /** Identifica a deformação (todas as escalas dela compartilham o grupo). */
  group: number;
  /** Fator de compressão (>1). 1,8 ≈ inclinação de 56°; 3 ≈ 70°. */
  tilt: number;
  /** Direção em que a imagem é comprimida, em radianos (no plano do alvo). */
  direction: number;
}

export interface VariantConfig {
  tilts: readonly number[];
  /** Quantas direções igualmente espaçadas em [0, π). */
  directions: number;
  /** Mantém 1 escala a cada `scaleStride` da pirâmide de cada variante (a 1ª sempre). */
  scaleStride: number;
}

export const DEFAULT_VARIANT_CONFIG: VariantConfig = {
  tilts: [1.8, 3],
  directions: 4,
  scaleStride: 3,
};

export function variantSpecs(config: VariantConfig = DEFAULT_VARIANT_CONFIG): VariantSpec[] {
  const specs: VariantSpec[] = [];
  let group = 0;
  for (const tilt of config.tilts) {
    for (let k = 0; k < config.directions; k++) {
      specs.push({ group: group++, tilt, direction: (k * Math.PI) / config.directions });
    }
  }
  return specs;
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
}

/** Matriz 2x2 [a,b,c,d] que comprime `tilt`× ao longo de `direction` (e deixa o perpendicular). */
export function compressionMatrix(tilt: number, direction: number): [number, number, number, number] {
  const c = Math.cos(direction);
  const s = Math.sin(direction);
  const k = 1 / tilt;
  // R · diag(k, 1) · Rᵀ
  return [c * c * k + s * s, c * s * k - c * s, c * s * k - c * s, s * s * k + c * c];
}

export interface WarpedImage extends GrayImage {
  /** Pixel da variante (em unidades de pixel, centro de pixel = +0,5) -> pixel do alvo original. */
  toSource: Affine;
}

function bilinear(src: GrayImage, x: number, y: number): number {
  // coordenadas de amostra: centro do pixel i em i+0,5
  const fx = Math.min(Math.max(x - 0.5, 0), src.width - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), src.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const d = src.data;
  const w = src.width;
  const top = d[y0 * w + x0]! * (1 - ax) + d[y0 * w + x1]! * ax;
  const bottom = d[y1 * w + x0]! * (1 - ax) + d[y1 * w + x1]! * ax;
  return top * (1 - ay) + bottom * ay;
}

/**
 * Comprime a imagem `tilt`× ao longo de `direction`. A imagem de saída é a
 * caixa que envolve o resultado; fora dela, bordas são replicadas (sem
 * quinas pretas que virariam falsos pontos de interesse). O filtro é uma média
 * de `ceil(tilt)` amostras ao longo da direção comprimida (evita serrilhado).
 */
export function warpCompressed(src: GrayImage, tilt: number, direction: number): WarpedImage {
  const [a, b, c, d] = compressionMatrix(tilt, direction);
  const cx = src.width / 2;
  const cy = src.height / 2;
  const corners: Array<[number, number]> = [
    [0, 0],
    [src.width, 0],
    [src.width, src.height],
    [0, src.height],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [px, py] of corners) {
    const vx = a * (px - cx) + b * (py - cy);
    const vy = c * (px - cx) + d * (py - cy);
    minX = Math.min(minX, vx);
    maxX = Math.max(maxX, vx);
    minY = Math.min(minY, vy);
    maxY = Math.max(maxY, vy);
  }
  const width = Math.max(1, Math.ceil(maxX - minX));
  const height = Math.max(1, Math.ceil(maxY - minY));
  const ocx = width / 2;
  const ocy = height / 2;

  // inversa: P = Minv · (V − c') + c, com Minv = R · diag(tilt, 1) · Rᵀ
  const cs = Math.cos(direction);
  const sn = Math.sin(direction);
  const ia = cs * cs * tilt + sn * sn;
  const ib = cs * sn * tilt - cs * sn;
  const ic = ib;
  const id = sn * sn * tilt + cs * cs;

  const taps = Math.max(1, Math.ceil(tilt));
  const data = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const vx = i + 0.5 - ocx;
      const vy = j + 0.5 - ocy;
      const px = ia * vx + ib * vy + cx;
      const py = ic * vx + id * vy + cy;
      let sum = 0;
      for (let n = 0; n < taps; n++) {
        const off = ((n + 0.5) / taps - 0.5) * tilt;
        sum += bilinear(src, px + cs * off, py + sn * off);
      }
      data[j * width + i] = Math.round(sum / taps);
    }
  }
  return {
    data,
    width,
    height,
    toSource: [ia, ib, cx - ia * ocx - ib * ocy, ic, id, cy - ic * ocx - id * ocy],
  };
}

/**
 * Mapa de um keyframe de variante em escala `scale` (pixel do keyframe, +0,5
 * incluso) para pixel do alvo original: variante-cheia = keyframe / scale.
 */
export function keyframeToTarget(toSource: Affine, scale: number): Affine {
  return [
    toSource[0] / scale,
    toSource[1] / scale,
    toSource[2],
    toSource[3] / scale,
    toSource[4] / scale,
    toSource[5],
  ];
}

/** Escolhe quais escalas da pirâmide de uma variante guardar (a maior sempre). */
export function pickScaleIndexes(count: number, stride: number): number[] {
  const out: number[] = [];
  const step = Math.max(1, Math.floor(stride));
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}
