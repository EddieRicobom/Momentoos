import { MIND_FORMAT_VERSION, readMindHeader } from '../tracking/mindFormat';
import { StorageError } from './errors';
import { newId, sha256Hex } from './hash';
import {
  ANCHOR_ENGINE,
  PROJECT_FORMAT_VERSION,
  defaultContent,
  normalizeName,
  type ProjectRecord,
} from './model';
import type { ListEntry, ProjectRepository } from './repository';

/** Operações de alto nível sobre projetos (criar, recompilar, renomear, abrir). */

export interface ReferenceImageInput {
  data: ArrayBuffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface CreateProjectInput {
  name: string;
  /** Conteúdo do .mind (de compileTarget() ou de um arquivo carregado). */
  anchor: Uint8Array;
  /** Pode faltar quando o projeto vem de um .mind solto; aí não dá para recompilar. */
  referenceImage?: ReferenceImageInput | null;
  now?: Date;
  id?: string;
}

export async function createProject(
  repo: ProjectRepository,
  input: CreateProjectInput,
): Promise<ProjectRecord> {
  const name = normalizeName(input.name);
  if (name === null) throw new StorageError('invalid-input', 'Dê um nome ao projeto.');

  const header = readMindHeader(input.anchor);
  if (!header.ok) throw new StorageError('incompatible', header.message);

  const nowIso = (input.now ?? new Date()).toISOString();
  const anchorBytes = toArrayBuffer(input.anchor);
  const anchorSha = await sha256Hex(anchorBytes);

  let referenceImage: ProjectRecord['referenceImage'] = null;
  let imageBytes: ArrayBuffer | null = null;
  if (input.referenceImage) {
    imageBytes = input.referenceImage.data;
    referenceImage = {
      mimeType: input.referenceImage.mimeType,
      size: imageBytes.byteLength,
      sha256: await sha256Hex(imageBytes),
      width: input.referenceImage.width,
      height: input.referenceImage.height,
    };
  }

  const record: ProjectRecord = {
    formatVersion: PROJECT_FORMAT_VERSION,
    id: input.id ?? newId(),
    name,
    createdAt: nowIso,
    updatedAt: nowIso,
    referenceImage,
    anchor: {
      mimeType: 'application/octet-stream',
      size: anchorBytes.byteLength,
      sha256: anchorSha,
      mindFormat: header.header.version,
      width: header.header.width,
      height: header.header.height,
      engine: ANCHOR_ENGINE,
      compiledAt: nowIso,
    },
    content: defaultContent(),
  };

  await repo.save(record, {
    anchor: { mimeType: 'application/octet-stream', data: anchorBytes },
    ...(imageBytes && input.referenceImage
      ? { referenceImage: { mimeType: input.referenceImage.mimeType, data: imageBytes } }
      : {}),
  });
  return record;
}

/** Troca o alvo de um projeto (ex.: depois de recompilar a imagem de referência). */
export async function replaceAnchor(
  repo: ProjectRepository,
  id: string,
  anchor: Uint8Array,
  now: Date = new Date(),
): Promise<ProjectRecord> {
  const entry = await requireReadable(repo, id);

  const header = readMindHeader(anchor);
  if (!header.ok) throw new StorageError('incompatible', header.message);

  const nowIso = now.toISOString();
  const bytes = toArrayBuffer(anchor);
  const record: ProjectRecord = {
    ...entry.record,
    updatedAt: nowIso,
    anchor: {
      mimeType: 'application/octet-stream',
      size: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      mindFormat: header.header.version,
      width: header.header.width,
      height: header.header.height,
      engine: ANCHOR_ENGINE,
      compiledAt: nowIso,
    },
  };
  await repo.save(record, { anchor: { mimeType: 'application/octet-stream', data: bytes } });
  return record;
}

export async function renameProject(
  repo: ProjectRepository,
  id: string,
  name: string,
  now: Date = new Date(),
): Promise<ProjectRecord> {
  const normalized = normalizeName(name);
  if (normalized === null) throw new StorageError('invalid-input', 'O nome não pode ficar vazio.');
  return repo.updateMeta(id, { name: normalized, updatedAt: now.toISOString() });
}

export interface OpenedAnchor {
  record: ProjectRecord;
  buffer: Uint8Array;
}

/**
 * Carrega o alvo salvo para uso, conferindo tamanho, hash SHA-256 e versão do
 * formato. É o que evita recompilar: se tudo confere, o buffer vai direto ao
 * rastreador. Se algo falha, o erro diz o quê (e a interface oferece recompilar
 * quando houver imagem de referência).
 */
export async function openProjectAnchor(repo: ProjectRepository, id: string): Promise<OpenedAnchor> {
  const entry = await requireReadable(repo, id);
  const { record } = entry;

  if (record.anchor === null) {
    throw new StorageError('not-found', 'O projeto não tem alvo compilado.');
  }
  if (record.anchor.mindFormat !== MIND_FORMAT_VERSION) {
    throw new StorageError(
      'incompatible',
      `O alvo está em formato incompatível (versão ${record.anchor.mindFormat}; este app usa a ${MIND_FORMAT_VERSION}). Recompile a imagem de referência.`,
    );
  }

  const file = await repo.getFile(id, 'anchor');
  if (!file) throw new StorageError('not-found', 'O arquivo do alvo está ausente.');
  if (file.data.byteLength !== record.anchor.size) {
    throw new StorageError(
      'integrity',
      'O arquivo do alvo está incompleto ou foi alterado (tamanho diferente do registrado).',
    );
  }
  if ((await sha256Hex(file.data)) !== record.anchor.sha256) {
    throw new StorageError('integrity', 'O arquivo do alvo está corrompido (hash diferente do registrado).');
  }

  const header = readMindHeader(file.data);
  if (!header.ok) throw new StorageError('incompatible', header.message);

  return { record, buffer: new Uint8Array(file.data) };
}

async function requireReadable(
  repo: ProjectRepository,
  id: string,
): Promise<Extract<ListEntry, { kind: 'project' }>> {
  const entry = await repo.getEntry(id);
  if (!entry) throw new StorageError('not-found', 'Projeto não encontrado.');
  if (entry.kind === 'unreadable') throw new StorageError(entry.code, entry.message);
  return entry;
}

/** Cópia exata dos bytes em um ArrayBuffer próprio (sem compartilhar o buffer original). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
