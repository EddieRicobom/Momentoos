import { StorageError } from './errors';
import { newId, sha256Hex } from './hash';
import { classifyFile, defaultItemName, matchesSignature } from './itemFiles';
import {
  ITEM_FILENAME_MAX_LENGTH,
  MAX_ITEMS_PER_PROJECT,
  MAX_ITEM_FILE_BYTES,
  defaultOptions,
  defaultTransform,
  itemFileKind,
  normalizeName,
  parseProjectRecord,
  type ItemOptions,
  type ItemTransform,
  type ProjectRecord,
  type SceneItem,
} from './model';
import type { FileWrites, ListEntry, ProjectRepository } from './repository';
import { toArrayBuffer } from './projects';

/**
 * Operações sobre os itens da cena de um projeto. Cada operação lê o projeto,
 * valida o resultado inteiro e grava registro + arquivos numa única transação.
 * A interface chama uma de cada vez; não há proteção contra duas abas editando
 * o mesmo projeto ao mesmo tempo (vale o último a gravar).
 */

export interface NewItemFile {
  data: ArrayBuffer;
  fileName: string;
  /** MIME informado pelo navegador (só reserva; a extensão manda). */
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface AddItemInput {
  file: NewItemFile;
  name?: string;
  transform?: Partial<ItemTransform>;
  options?: Partial<ItemOptions>;
  now?: Date;
  /** Para testes. */
  id?: string;
}

export interface ItemPatch {
  name?: string;
  visible?: boolean;
  transform?: Partial<ItemTransform>;
  options?: Partial<ItemOptions>;
}

type ProjectEntry = Extract<ListEntry, { kind: 'project' }>;

async function requireProject(repo: ProjectRepository, id: string): Promise<ProjectEntry> {
  const entry = await repo.getEntry(id);
  if (!entry) throw new StorageError('not-found', 'Projeto não encontrado.');
  if (entry.kind === 'unreadable') throw new StorageError(entry.code, entry.message);
  return entry;
}

/** Valida o registro inteiro com as mesmas regras de leitura do banco. */
function assertValid(record: ProjectRecord): ProjectRecord {
  const parsed = parseProjectRecord(record);
  if (!parsed.ok) throw new StorageError('invalid-input', parsed.message);
  return parsed.record;
}

async function commit(
  repo: ProjectRepository,
  base: ProjectRecord,
  items: SceneItem[],
  now: Date,
  files?: FileWrites,
): Promise<ProjectRecord> {
  const record = assertValid({ ...base, scene: { items }, updatedAt: now.toISOString() });
  await repo.save(record, files);
  return record;
}

export async function addItem(
  repo: ProjectRepository,
  projectId: string,
  input: AddItemInput,
): Promise<{ record: ProjectRecord; item: SceneItem }> {
  const { record } = await requireProject(repo, projectId);
  if (record.scene.items.length >= MAX_ITEMS_PER_PROJECT) {
    throw new StorageError('invalid-input', `Este projeto já tem o máximo de ${MAX_ITEMS_PER_PROJECT} itens.`);
  }

  const { file } = input;
  if (file.fileName.length === 0 || file.fileName.length > ITEM_FILENAME_MAX_LENGTH) {
    throw new StorageError('invalid-input', 'Nome de arquivo inválido.');
  }
  const kind = classifyFile(file.fileName, file.mimeType);
  if (!kind.ok) throw new StorageError('invalid-input', kind.reason);

  const size = file.data.byteLength;
  if (size === 0) throw new StorageError('invalid-input', 'O arquivo está vazio.');
  if (size > MAX_ITEM_FILE_BYTES) {
    throw new StorageError(
      'invalid-input',
      `O arquivo é grande demais (limite de ${Math.floor(MAX_ITEM_FILE_BYTES / (1024 * 1024))} MB por item).`,
    );
  }
  if (!matchesSignature(kind.mimeType, new Uint8Array(file.data))) {
    throw new StorageError(
      'invalid-input',
      'O conteúdo do arquivo não corresponde ao formato indicado pela extensão (arquivo corrompido ou com extensão trocada).',
    );
  }

  const item: SceneItem = {
    id: input.id ?? newId().slice(0, 16),
    type: kind.type,
    name: normalizeName(input.name ?? defaultItemName(file.fileName)) ?? 'Item',
    visible: true,
    file: {
      mimeType: kind.mimeType,
      size,
      sha256: await sha256Hex(file.data),
      fileName: file.fileName,
      ...(file.width !== undefined ? { width: file.width } : {}),
      ...(file.height !== undefined ? { height: file.height } : {}),
      ...(file.durationMs !== undefined ? { durationMs: file.durationMs } : {}),
    },
    transform: { ...defaultTransform(), ...input.transform },
    options: { ...defaultOptions(kind.type), ...input.options },
  };

  const saved = await commit(repo, record, [...record.scene.items, item], input.now ?? new Date(), {
    [itemFileKind(item.id)]: { mimeType: kind.mimeType, data: file.data },
  });
  return { record: saved, item };
}

function applyPatch(item: SceneItem, patch: ItemPatch): SceneItem {
  let name = item.name;
  if (patch.name !== undefined) {
    const normalized = normalizeName(patch.name);
    if (normalized === null) throw new StorageError('invalid-input', 'O nome do item não pode ficar vazio.');
    name = normalized;
  }
  return {
    ...item,
    name,
    visible: patch.visible ?? item.visible,
    transform: { ...item.transform, ...patch.transform },
    options: { ...item.options, ...patch.options },
  };
}

/** Atualiza vários itens de uma vez (ex.: o editor salvando todos os ajustes). */
export async function updateItems(
  repo: ProjectRepository,
  projectId: string,
  patches: ReadonlyMap<string, ItemPatch>,
  now: Date = new Date(),
): Promise<ProjectRecord> {
  const { record } = await requireProject(repo, projectId);
  const known = new Set(record.scene.items.map((i) => i.id));
  for (const id of patches.keys()) {
    if (!known.has(id)) throw new StorageError('not-found', 'Item não encontrado.');
  }
  const items = record.scene.items.map((item) => {
    const patch = patches.get(item.id);
    return patch ? applyPatch(item, patch) : item;
  });
  return commit(repo, record, items, now);
}

export async function updateItem(
  repo: ProjectRepository,
  projectId: string,
  itemId: string,
  patch: ItemPatch,
  now: Date = new Date(),
): Promise<ProjectRecord> {
  return updateItems(repo, projectId, new Map([[itemId, patch]]), now);
}

export async function removeItem(
  repo: ProjectRepository,
  projectId: string,
  itemId: string,
  now: Date = new Date(),
): Promise<ProjectRecord> {
  const { record } = await requireProject(repo, projectId);
  if (!record.scene.items.some((i) => i.id === itemId)) {
    throw new StorageError('not-found', 'Item não encontrado.');
  }
  return commit(
    repo,
    record,
    record.scene.items.filter((i) => i.id !== itemId),
    now,
    { [itemFileKind(itemId)]: null },
  );
}

/** Cria uma cópia do item (com cópia própria do arquivo), levemente deslocada. */
export async function duplicateItem(
  repo: ProjectRepository,
  projectId: string,
  itemId: string,
  now: Date = new Date(),
): Promise<{ record: ProjectRecord; item: SceneItem }> {
  const opened = await openItemFile(repo, projectId, itemId);
  const { record } = await requireProject(repo, projectId);
  if (record.scene.items.length >= MAX_ITEMS_PER_PROJECT) {
    throw new StorageError('invalid-input', `Este projeto já tem o máximo de ${MAX_ITEMS_PER_PROJECT} itens.`);
  }
  const copy: SceneItem = {
    ...opened.item,
    id: newId().slice(0, 16),
    name: normalizeName(`${opened.item.name} (cópia)`) ?? opened.item.name,
    transform: {
      ...opened.item.transform,
      position: [
        opened.item.transform.position[0] + 0.05,
        opened.item.transform.position[1] - 0.05,
        opened.item.transform.position[2],
      ],
    },
  };
  const saved = await commit(repo, record, [...record.scene.items, copy], now, {
    [itemFileKind(copy.id)]: { mimeType: opened.item.file.mimeType, data: toArrayBuffer(new Uint8Array(opened.data)) },
  });
  return { record: saved, item: copy };
}

export interface OpenedItem {
  record: ProjectRecord;
  item: SceneItem;
  data: ArrayBuffer;
}

/** Lê o arquivo de um item conferindo tamanho e SHA-256 (como o alvo do projeto). */
export async function openItemFile(repo: ProjectRepository, projectId: string, itemId: string): Promise<OpenedItem> {
  const { record } = await requireProject(repo, projectId);
  const item = record.scene.items.find((i) => i.id === itemId);
  if (!item) throw new StorageError('not-found', 'Item não encontrado.');

  const file = await repo.getFile(projectId, itemFileKind(itemId));
  if (!file) throw new StorageError('not-found', `O arquivo de "${item.name}" está ausente.`);
  if (file.data.byteLength !== item.file.size) {
    throw new StorageError('integrity', `O arquivo de "${item.name}" está incompleto ou foi alterado.`);
  }
  if ((await sha256Hex(file.data)) !== item.file.sha256) {
    throw new StorageError('integrity', `O arquivo de "${item.name}" está corrompido (hash diferente do registrado).`);
  }
  return { record, item, data: file.data };
}
