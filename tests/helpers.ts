import { encode } from '@msgpack/msgpack';
import { IDBFactory } from 'fake-indexeddb';
import { sha256Hex } from '../src/storage/hash';
import {
  PROJECT_FORMAT_VERSION,
  emptyScene,
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
    scene: emptyScene(),
    ...overrides,
  };
}

export function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const SIGNATURES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  'video/mp4': [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70],
  'video/webm': [0x1a, 0x45, 0xdf, 0xa3],
  'model/gltf-binary': [0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0],
  'audio/mpeg': [0x49, 0x44, 0x33, 4, 0],
  'audio/ogg': [0x4f, 0x67, 0x67, 0x53],
  'audio/wav': [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
};

/** Bytes que começam com a assinatura real do formato (o resto é enchimento determinístico). */
export function signedBytes(mimeType: string, size = 64, seed = 1): ArrayBuffer {
  const head = SIGNATURES[mimeType];
  if (!head) throw new Error(`sem assinatura para ${mimeType}`);
  const bytes = new Uint8Array(Math.max(size, head.length)).map((_, i) => (i * 17 + seed) % 256);
  bytes.set(head, 0);
  return bytes.buffer.slice(0) as ArrayBuffer;
}
