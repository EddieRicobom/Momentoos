import { Compiler } from 'mind-ar/src/image-target/compiler.js';

/**
 * Versão do formato .mind produzida/aceita pelo mind-ar@1.2.5
 * (constante CURRENT_VERSION em src/image-target/compiler-base.js).
 */
export const MIND_FORMAT_VERSION = 2;

export interface CompiledTarget {
  /** Conteúdo do .mind (MessagePack). Pode ser salvo e recarregado sem recompilar. */
  buffer: Uint8Array;
  width: number;
  height: number;
  compileMs: number;
}

export interface LoadedTargetInfo {
  width: number;
  height: number;
  /** Quantos alvos o arquivo contém (este app usa sempre 1). */
  targetCount: number;
}

/**
 * Compila a imagem em um alvo de rastreamento, no próprio navegador, sem
 * backend. `onProgress` recebe 0..100.
 */
export async function compileTarget(
  image: HTMLImageElement,
  onProgress: (percent: number) => void,
): Promise<CompiledTarget> {
  const started = performance.now();
  const compiler = new Compiler();
  await compiler.compileImageTargets([image], onProgress);
  const buffer = compiler.exportData();
  return {
    buffer,
    width: image.width,
    height: image.height,
    compileMs: performance.now() - started,
  };
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
  };
}
