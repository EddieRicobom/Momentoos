import { rectToPixels, type NormalizedRect } from './cropGeometry';
import { applyEnhancement, rgbaToLuma, suggestCropBox, type EnhanceMode } from './targetPixels';

/**
 * Preparo da foto da tatuagem antes da compilação.
 *
 * Fotos de celular têm 8–50 MP. O compilador do MindAR processa a imagem em
 * várias escalas e guarda os pontos de cada uma no arquivo .mind; mandar a foto
 * inteira deixa a compilação lenta, consome muita memória no celular e gera um
 * alvo grande. Por isso reduzimos o maior lado para MAX_TARGET_SIDE.
 *
 * ATENÇÃO: 1024 px é um valor inicial razoável, NÃO foi calibrado com
 * tatuagens reais. Se o reconhecimento for ruim, esta é uma das primeiras
 * variáveis a testar (ver docs/TESTES-MANUAIS.md).
 */
export const MAX_TARGET_SIDE = 1024;

/** Abaixo disso a imagem tem pouca informação para extrair pontos de interesse. */
export const MIN_TARGET_SIDE = 128;

export interface TargetSize {
  width: number;
  height: number;
  /** Fator aplicado (1 = não foi reduzida). */
  scale: number;
}

export function computeTargetSize(
  width: number,
  height: number,
  maxSide: number = MAX_TARGET_SIDE,
): TargetSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Dimensões inválidas: ${width}x${height}`);
  }
  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return { width: Math.round(width), height: Math.round(height), scale: 1 };
  }
  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export type SizeCheck = { ok: true } | { ok: false; reason: string };

export function checkTargetSize(width: number, height: number): SizeCheck {
  if (Math.min(width, height) < MIN_TARGET_SIDE) {
    return {
      ok: false,
      reason: `A imagem é pequena demais (${width}×${height}). Use uma foto com pelo menos ${MIN_TARGET_SIDE} px no menor lado.`,
    };
  }
  return { ok: true };
}

export interface PreparedTarget {
  /** Imagem já recortada, reduzida, realçada e decodificada, pronta para o compilador. */
  image: HTMLImageElement;
  /** Mesmo conteúdo da imagem, em PNG (é o que se guarda como referência: recompilar reproduz o alvo). */
  blob: Blob;
  /** Libere com `dispose()` quando não precisar mais da imagem. */
  objectUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  scale: number;
  enhance: EnhanceMode;
  crop: NormalizedRect | null;
  dispose(): void;
}

/** Foto original decodificada, mantida para ajustar recorte e contraste antes de compilar. */
export interface SourceImage {
  image: HTMLImageElement;
  /** URL para mostrar a foto na tela; liberada em dispose(). */
  objectUrl: string;
  width: number;
  height: number;
  dispose(): void;
}

export interface PrepareOptions {
  /** Área da tatuagem (normalizada); null/ausente = foto inteira. */
  crop?: NormalizedRect | null;
  enhance?: EnhanceMode;
}

/**
 * Lê o arquivo escolhido (galeria ou câmera) e decodifica como HTMLImageElement
 * (navegadores modernos aplicam a orientação EXIF ao decodificar).
 */
export async function loadSourceImage(file: Blob): Promise<SourceImage> {
  const objectUrl = URL.createObjectURL(file);
  let image: HTMLImageElement;
  try {
    image = await decodeImage(objectUrl);
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Não foi possível ler essa imagem. Tente outro arquivo (JPG, PNG ou WebP).');
  }
  return {
    image,
    objectUrl,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => URL.revokeObjectURL(objectUrl),
  };
}

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // willReadFrequently: vamos ler os pixels de volta (getImageData) para realçar.
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('O navegador não conseguiu criar o canvas de preparo da imagem.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

/** Recorta, reduz (se preciso) e realça a foto; devolve a imagem que será compilada. */
export async function prepareTargetFromSource(
  source: SourceImage,
  options: PrepareOptions = {},
): Promise<PreparedTarget> {
  const crop = options.crop ?? null;
  const enhance = options.enhance ?? 'none';
  const box = rectToPixels(crop, source.width, source.height);
  const size = computeTargetSize(box.w, box.h);
  const check = checkTargetSize(size.width, size.height);
  if (!check.ok) throw new Error(check.reason);

  const { canvas, context } = createCanvas(size.width, size.height);
  context.drawImage(source.image, box.x, box.y, box.w, box.h, 0, 0, size.width, size.height);
  if (enhance !== 'none') {
    const pixels = context.getImageData(0, 0, size.width, size.height);
    applyEnhancement(pixels.data, size.width, size.height, enhance);
    context.putImageData(pixels, 0, 0);
  }

  const blob = await canvasToBlob(canvas);
  const objectUrl = URL.createObjectURL(blob);
  let image: HTMLImageElement;
  try {
    image = await decodeImage(objectUrl);
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Falha ao preparar a imagem reduzida.');
  }

  return {
    image,
    blob,
    objectUrl,
    width: size.width,
    height: size.height,
    originalWidth: source.width,
    originalHeight: source.height,
    scale: size.scale,
    enhance,
    crop,
    dispose: () => URL.revokeObjectURL(objectUrl),
  };
}

/**
 * Atalho para um arquivo só (usado na recompilação a partir da foto guardada,
 * que já é a imagem recortada e realçada: por padrão não mexe em nada).
 */
export async function prepareTargetImage(file: Blob, options: PrepareOptions = {}): Promise<PreparedTarget> {
  const source = await loadSourceImage(file);
  try {
    return await prepareTargetFromSource(source, options);
  } finally {
    source.dispose();
  }
}

/** Prévia pequena do que o compilador vai receber (mesmo recorte e realce). */
export function renderPreview(source: SourceImage, options: PrepareOptions, maxSide = 320): HTMLCanvasElement {
  const box = rectToPixels(options.crop ?? null, source.width, source.height);
  const size = computeTargetSize(box.w, box.h, maxSide);
  const { canvas, context } = createCanvas(size.width, size.height);
  context.drawImage(source.image, box.x, box.y, box.w, box.h, 0, 0, size.width, size.height);
  if ((options.enhance ?? 'none') !== 'none') {
    const pixels = context.getImageData(0, 0, size.width, size.height);
    applyEnhancement(pixels.data, size.width, size.height, options.enhance ?? 'none');
    context.putImageData(pixels, 0, 0);
  }
  return canvas;
}

/** Sugere a área da tatuagem (heurística simples; a pessoa confere e ajusta). */
export function suggestCrop(source: SourceImage): NormalizedRect | null {
  const size = computeTargetSize(source.width, source.height, 256);
  const { context } = createCanvas(size.width, size.height);
  context.drawImage(source.image, 0, 0, size.width, size.height);
  const pixels = context.getImageData(0, 0, size.width, size.height);
  return suggestCropBox(rgbaToLuma(pixels.data, size.width * size.height), size.width, size.height);
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('decode failed'));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar a imagem reduzida.'));
    }, 'image/png');
  });
}
