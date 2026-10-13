import { encode } from '@msgpack/msgpack';
import { IDBFactory } from 'fake-indexeddb';
import { sha256Hex } from '../src/storage/hash';
import {
  PROJECT_FORMAT_VERSION,
  defaultContent,
  type ProjectRecord,
} from '../src/storage/model';
import { openRepository, type ProjectRepository } from '../src/storage/repository';

/**
 * Gera um buffer no mesmo formato do .mind do mind-ar 1.2.5 (MessagePack com
 * `{ v, dataList: [{ targetImage, trackingData, matchingData }] }`), mas sem
 * dados reais de rastreamento. Serve para testar leitura, validação e
 * armazenamento; NÃO serve para rastrear.
 *
 * `filler` aumenta o tamanho para exercitar limites e integridade.
 */
export function makeMind(
  options: { version?: number; width?: number; height?: number; filler?: number; seed?: number } = {},
): Uint8Array {
  const { version = 2, width = 640, height = 480, filler = 0, seed = 1 } = options;
  const padding = new Uint8Array(filler).map((_, i) => (i * 31 + seed) % 256);
  return encode({
    v: version,
    dataList: [
      {
        targetImage: { width, height },
        trackingData: [{ seed, padding }],
        matchingData: [],
      },
    ],
  });
}

/** Bytes de uma "imagem" qualquer (o app guarda PNG; os testes só precisam de bytes). */
export function fakeImage(seed = 7, size = 64): ArrayBuffer {
  const bytes = new Uint8Array(size).map((_, i) => (i * 13 + seed) % 256);
  return bytes.buffer.slice(0) as ArrayBuffer;
}

export async function freshRepository(name = 'teste'): Promise<ProjectRepository> {
  return openRepository({ factory: new IDBFactory(), name });
}

/** Registro válido completo, com hashes calculados dos bytes informados. */
export async function makeRecord(
  overrides: Partial<ProjectRecord> & { id: string },
  files: { anchor?: Uint8Array; image?: ArrayBuffer } = {},
): Promise<ProjectRecord> {
  const anchor = files.anchor ?? makeMind();
  const image = files.image ?? fakeImage();
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: 'Projeto de teste',
    createdAt: '2026-10-13T12:00:00.000Z',
    updatedAt: '2026-10-13T12:00:00.000Z',
    referenceImage: {
      mimeType: 'image/png',
      size: image.byteLength,
      sha256: await sha256Hex(image),
      width: 640,
      height: 480,
    },
    anchor: {
      mimeType: 'application/octet-stream',
      size: anchor.byteLength,
      sha256: await sha256Hex(anchor),
      mindFormat: 2,
      width: 640,
      height: 480,
      engine: 'mind-ar@1.2.5',
      compiledAt: '2026-10-13T12:00:00.000Z',
    },
    content: defaultContent(),
    ...overrides,
  };
}

export function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
