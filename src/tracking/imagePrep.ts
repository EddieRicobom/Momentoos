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
  /** Imagem já reduzida, decodificada e pronta para o compilador. */
  image: HTMLImageElement;
  /** Mesmo conteúdo da imagem, em PNG (para guardar como referência depois). */
  blob: Blob;
  /** Libere com `dispose()` quando não precisar mais da imagem. */
  objectUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  scale: number;
  dispose(): void;
}

/**
 * Lê o arquivo escolhido (galeria ou câmera), aplica a orientação EXIF
 * (navegadores modernos fazem isso ao decodificar <img>), reduz se necessário
 * e devolve uma imagem decodificada como HTMLImageElement real: é o tipo que a
 * API documentada do Compiler espera.
 */
export async function prepareTargetImage(file: Blob): Promise<PreparedTarget> {
  const sourceUrl = URL.createObjectURL(file);
  let original: HTMLImageElement;
  try {
    original = await decodeImage(sourceUrl);
  } catch {
    URL.revokeObjectURL(sourceUrl);
    throw new Error('Não foi possível ler essa imagem. Tente outro arquivo (JPG, PNG ou WebP).');
  }

  const originalWidth = original.naturalWidth;
  const originalHeight = original.naturalHeight;
  const size = computeTargetSize(originalWidth, originalHeight);
  const check = checkTargetSize(size.width, size.height);
  if (!check.ok) {
    URL.revokeObjectURL(sourceUrl);
    throw new Error(check.reason);
  }

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) {
    URL.revokeObjectURL(sourceUrl);
    throw new Error('O navegador não conseguiu criar o canvas de preparo da imagem.');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(original, 0, 0, size.width, size.height);
  URL.revokeObjectURL(sourceUrl);

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
    originalWidth,
    originalHeight,
    scale: size.scale,
    dispose: () => URL.revokeObjectURL(objectUrl),
  };
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
