import { Compiler } from 'mind-ar/src/image-target/compiler.js';
import { MIND_FORMAT_VERSION } from './mindFormat';
import { DEFAULT_VARIANT_CONFIG, type VariantConfig } from './targetVariants';
import { buildVariantKeyframes } from './variantKeyframes';

export { MIND_FORMAT_VERSION };

export interface CompiledTarget {
  /** Conteúdo do .mind (MessagePack). Pode ser salvo e recarregado sem recompilar. */
  buffer: Uint8Array;
  width: number;
  height: number;
  compileMs: number;
  /** Quantos keyframes de variantes (esticadas/inclinadas) foram gerados. */
  variantKeyframes: number;
  /** Pontos de apoio do rastreamento contínuo (ver trackingScales.ts). */
  trackingPoints: number;
}

export interface CompileOptions {
  /**
   * Variantes deformadas do alvo (ver targetVariants.ts). `false` compila só o
   * alvo de frente, como o mind-ar puro. Padrão: ligado.
   */
  variants?: VariantConfig | false;
}

/** Parte do progresso (0..100) dedicada ao alvo base; o resto vai para as variantes. */
const BASE_PROGRESS_SHARE = 55;

export interface LoadedTargetInfo {
  width: number;
  height: number;
  /** Quantos alvos o arquivo contém (este app usa sempre 1). */
  targetCount: number;
  trackingPoints: number;
  variantKeyframes: number;
}

/**
 * Compila a imagem em um alvo de rastreamento, no próprio navegador, sem
 * backend. `onProgress` recebe 0..100.
 */
export async function compileTarget(
  image: HTMLImageElement,
  onProgress: (percent: number) => void,
  options: CompileOptions = {},
): Promise<CompiledTarget> {
  const started = performance.now();
  const variants = options.variants === undefined ? DEFAULT_VARIANT_CONFIG : options.variants;
  const compiler = new Compiler();
  await compiler.compileImageTargets([image], (percent) =>
    onProgress(variants ? (percent * BASE_PROGRESS_SHARE) / 100 : percent),
  );
  let variantKeyframes = 0;
  const first = compiler.data?.[0];
  if (variants && first) {
    const extra = await buildVariantKeyframes(first.targetImage, variants, (fraction) =>
      onProgress(BASE_PROGRESS_SHARE + fraction * (100 - BASE_PROGRESS_SHARE)),
    );
    first.matchingData.push(...extra);
    variantKeyframes = extra.length;
  }
  const buffer = compiler.exportData();
  return {
    buffer,
    width: image.width,
    height: image.height,
    compileMs: performance.now() - started,
    variantKeyframes,
    trackingPoints: countTrackingPoints(first?.trackingData),
  };
}

/** O Tracker do MindAR usa o elemento [1] de trackingData. */
function countTrackingPoints(trackingData: unknown): number {
  const set = Array.isArray(trackingData) ? (trackingData[1] as { points?: unknown[] } | undefined) : undefined;
  return Array.isArray(set?.points) ? set.points.length : 0;
}

/**
 * Valida um buffer .mind SEM abrir a câmera. Necessário porque o MindAR, ao
 * receber um arquivo de versão antiga, só escreve no console e segue com zero
 * alvos: o rastreador "funcionaria" sem nunca reconhecer nada.
 */
export function inspectTargetBuffer(buffer: ArrayBuffer | Uint8Array): LoadedTargetInfo {
  let list: ReturnType<Compiler['importData']>;
  try {
    list = new Compiler().importData(buffer);
  } catch {
    throw new Error('Arquivo inválido: não é um alvo .mind legível.');
  }
  const first = list[0];
  if (!first) {
    throw new Error(
      `Alvo incompatível ou desatualizado (este app usa o formato .mind versão ${MIND_FORMAT_VERSION}). Compile a imagem de novo.`,
    );
  }
  return {
    width: first.targetImage.width,
    height: first.targetImage.height,
    targetCount: list.length,
    trackingPoints: countTrackingPoints(first.trackingData),
    variantKeyframes: Array.isArray(first.matchingData)
      ? first.matchingData.filter((k) => (k as { variant?: unknown }).variant !== undefined).length
      : 0,
  };
}
