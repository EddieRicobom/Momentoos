import { decode } from '@msgpack/msgpack';

/**
 * Versão do formato .mind produzida/aceita pelo mind-ar@1.2.5
 * (constante CURRENT_VERSION em src/image-target/compiler-base.js).
 */
export const MIND_FORMAT_VERSION = 2;

export interface MindHeader {
  version: number;
  targetCount: number;
  /** Dimensões do primeiro alvo, em pixels da imagem compilada. */
  width: number;
  height: number;
}

export type MindHeaderResult =
  | { ok: true; header: MindHeader }
  | { ok: false; code: 'unreadable' | 'wrong-version' | 'empty'; message: string; version?: number };

/**
 * Lê o cabeçalho de um .mind sem carregar o MindAR (nem TensorFlow.js): o
 * arquivo é MessagePack com `{ v, dataList: [{ targetImage: {width,height}, ... }] }`
 * (estrutura conferida em compiler-base.js, exportData/importData).
 *
 * Serve para validar projetos ao salvar, importar e abrir, e é testável em
 * Node. A validação autoritativa continua sendo a do próprio MindAR em
 * `inspectTargetBuffer`, feita antes de abrir a câmera.
 *
 * Custo: decodifica o arquivo inteiro (o MindAR faz o mesmo ao carregá-lo).
 */
export function readMindHeader(buffer: ArrayBuffer | Uint8Array): MindHeaderResult {
  let content: unknown;
  try {
    content = decode(buffer);
  } catch {
    return { ok: false, code: 'unreadable', message: 'O arquivo do alvo não é um .mind legível.' };
  }
  if (typeof content !== 'object' || content === null) {
    return { ok: false, code: 'unreadable', message: 'O arquivo do alvo não é um .mind legível.' };
  }

  const { v, dataList } = content as { v?: unknown; dataList?: unknown };
  if (typeof v !== 'number') {
    return { ok: false, code: 'unreadable', message: 'O arquivo do alvo não tem versão de formato.' };
  }
  if (v !== MIND_FORMAT_VERSION) {
    return {
      ok: false,
      code: 'wrong-version',
      version: v,
      message: `Alvo em formato incompatível (versão ${v}; este app usa a ${MIND_FORMAT_VERSION}). Compile a imagem de novo.`,
    };
  }
  if (!Array.isArray(dataList) || dataList.length === 0) {
    return { ok: false, code: 'empty', message: 'O arquivo do alvo não contém nenhum alvo.' };
  }

  const first = (dataList[0] as { targetImage?: { width?: unknown; height?: unknown } } | null)
    ?.targetImage;
  const width = first?.width;
  const height = first?.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { ok: false, code: 'unreadable', message: 'O alvo não informa dimensões válidas.' };
  }

  return { ok: true, header: { version: v, targetCount: dataList.length, width, height } };
}
