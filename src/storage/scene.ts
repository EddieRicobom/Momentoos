import { StorageError } from './errors';
import { newId, sha256Hex } from './hash';
import { classifyFile, defaultItemName, matchesSignature } from './itemFiles';
import {
  ITEM_FILENAME_MAX_LENGTH,
  MAX_CAROUSEL_BYTES,
  MAX_CAROUSEL_SLIDES,
  MAX_ITEMS_PER_PROJECT,
  MAX_ITEM_FILE_BYTES,
  defaultOptions,
  defaultTransform,
  itemFileKind,
  itemFileUnits,
  normalizeName,
  parseProjectRecord,
  slideFileKind,
  type CarouselSlide,
  type ItemFileInfo,
  type ItemFileUnit,
  type ItemOptions,
  type ItemTransform,
  type ItemType,
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

  const prepared = await prepareFile(input.file);

  const item: SceneItem = {
    id: input.id ?? newId().slice(0, 16),
    type: prepared.type,
    name: normalizeName(input.name ?? defaultItemName(input.file.fileName)) ?? 'Item',
    visible: true,
    file: prepared.info,
    transform: { ...defaultTransform(), ...input.transform },
    options: { ...defaultOptions(prepared.type), ...input.options },
  };

  const saved = await commit(repo, record, [...record.scene.items, item], input.now ?? new Date(), {
    [itemFileKind(item.id)]: { mimeType: prepared.info.mimeType, data: input.file.data },
  });
  return { record: saved, item };
}

interface PreparedFile {
  type: ItemType;
  info: ItemFileInfo;
}

/** Valida um arquivo recebido (nome, tipo, tamanho, assinatura) e monta o descritor. */
async function prepareFile(file: NewItemFile): Promise<PreparedFile> {
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
  return {
    type: kind.type,
    info: {
      mimeType: kind.mimeType,
      size,
      sha256: await sha256Hex(file.data),
      fileName: file.fileName,
      ...(file.width !== undefined ? { width: file.width } : {}),
      ...(file.height !== undefined ? { height: file.height } : {}),
      ...(file.durationMs !== undefined ? { durationMs: file.durationMs } : {}),
    },
  };
}

// ---------------------------------------------------------------- carrossel

export interface AddCarouselInput {
  /** Imagens estáticas (PNG, JPG ou WebP), na ordem de exibição. */
  files: NewItemFile[];
  name?: string;
  transform?: Partial<ItemTransform>;
  options?: Partial<ItemOptions>;
  now?: Date;
  /** Para testes. */
  id?: string;
}

interface PreparedSlides {
  slides: Array<{ info: ItemFileInfo; data: ArrayBuffer }>;
}

async function prepareSlides(files: readonly NewItemFile[]): Promise<PreparedSlides> {
  const slides: PreparedSlides['slides'] = [];
  for (const file of files) {
    const prepared = await prepareFile(file);
    if (prepared.type !== 'image') {
      throw new StorageError(
        'invalid-input',
        `"${file.fileName}" não pode entrar no carrossel: só imagens PNG, JPG ou WebP (GIF animado e vídeo não).`,
      );
    }
    slides.push({ info: prepared.info, data: file.data });
  }
  return { slides };
}

const totalBytes = (slides: ReadonlyArray<{ size: number }>): number =>
  slides.reduce((sum, slide) => sum + slide.size, 0);

function assertCarouselLimits(slides: ReadonlyArray<{ size: number }>): void {
  if (slides.length > MAX_CAROUSEL_SLIDES) {
    throw new StorageError('invalid-input', `Um carrossel aceita no máximo ${MAX_CAROUSEL_SLIDES} imagens.`);
  }
  if (totalBytes(slides) > MAX_CAROUSEL_BYTES) {
    throw new StorageError(
      'invalid-input',
      `As imagens do carrossel somam mais que ${Math.floor(MAX_CAROUSEL_BYTES / (1024 * 1024))} MB.`,
    );
  }
}

/** Menor número de arquivo (slot) ainda livre no item. */
function freeSlots(used: ReadonlySet<number>, count: number): number[] {
  const slots: number[] = [];
  for (let slot = 0; slots.length < count; slot += 1) {
    if (!used.has(slot)) slots.push(slot);
  }
  return slots;
}

/** Cria um item de carrossel com as imagens recebidas (pelo menos uma). */
export async function addCarousel(
  repo: ProjectRepository,
  projectId: string,
  input: AddCarouselInput,
): Promise<{ record: ProjectRecord; item: SceneItem }> {
  const { record } = await requireProject(repo, projectId);
  if (record.scene.items.length >= MAX_ITEMS_PER_PROJECT) {
    throw new StorageError('invalid-input', `Este projeto já tem o máximo de ${MAX_ITEMS_PER_PROJECT} itens.`);
  }
  if (input.files.length === 0) throw new StorageError('invalid-input', 'Escolha pelo menos uma imagem.');

  const { slides } = await prepareSlides(input.files);
  assertCarouselLimits(slides.map((slide) => slide.info));

  const id = input.id ?? newId().slice(0, 16);
  const stored: CarouselSlide[] = slides.map((slide, index) => ({ ...slide.info, slot: index }));
  const first = slides[0]!.info;
  const item: SceneItem = {
    id,
    type: 'carousel',
    name: normalizeName(input.name ?? 'Carrossel') ?? 'Carrossel',
    visible: true,
    file: { ...first },
    slides: stored,
    transform: { ...defaultTransform(), ...input.transform },
    options: { ...defaultOptions('carousel'), ...input.options },
  };

  const writes: FileWrites = {};
  slides.forEach((slide, index) => {
    writes[slideFileKind(id, index)] = { mimeType: slide.info.mimeType, data: slide.data };
  });
  const saved = await commit(repo, record, [...record.scene.items, item], input.now ?? new Date(), writes);
  return { record: saved, item };
}

function requireCarousel(record: ProjectRecord, itemId: string): SceneItem & { slides: CarouselSlide[] } {
  const item = record.scene.items.find((i) => i.id === itemId);
  if (!item) throw new StorageError('not-found', 'Item não encontrado.');
  if (item.type !== 'carousel' || !item.slides) {
    throw new StorageError('invalid-input', 'Este item não é um carrossel.');
  }
  return item as SceneItem & { slides: CarouselSlide[] };
}

/** Troca os slides de um carrossel e mantém `file` igual ao primeiro. */
function withSlides(item: SceneItem, slides: CarouselSlide[]): SceneItem {
  const { slot: _slot, ...first } = slides[0]!;
  return { ...item, slides, file: first };
}

/** Acrescenta imagens ao fim de um carrossel. */
export async function addSlides(
  repo: ProjectRepository,
  projectId: string,
  itemId: string,
  files: NewItemFile[],
  now: Date = new Date(),
): Promise<{ record: ProjectRecord; item: SceneItem }> {
  const { record } = await requireProject(repo, projectId);
  const item = requireCarousel(record, itemId);
  if (files.length === 0) throw new StorageError('invalid-input', 'Escolha pelo menos uma imagem.');

  const { slides: added } = await prepareSlides(files);
  const all = [...item.slides, ...added.map((slide) => slide.info)];
  assertCarouselLimits(all);

  const slots = freeSlots(new Set(item.slides.map((s) => s.slot)), added.length);
  const writes: FileWrites = {};
  const newSlides: CarouselSlide[] = added.map((slide, index) => {
    writes[slideFileKind(itemId, slots[index]!)] = { mimeType: slide.info.mimeType, data: slide.data };
    return { ...slide.info, slot: slots[index]! };
  });

  const updated = withSlides(item, [...item.slides, ...newSlides]);
  const saved = await commit(
    repo,
    record,
    record.scene.items.map((i) => (i.id === itemId ? updated : i)),
    now,
    writes,
  );
  return { record: saved, item: updated };
}

/** Tira uma imagem do carrossel (e o arquivo dela). O carrossel precisa manter ao menos uma. */
export async function removeSlide(
  repo: ProjectRepository,
  projectId: string,
  itemId: string,
  slot: number,
  now: Date = new Date(),
): Promise<{ record: ProjectRecord; item: SceneItem }> {
  const { record } = await requireProject(repo, projectId);
  const item = requireCarousel(record, itemId);
  if (!item.slides.some((s) => s.slot === slot)) throw new StorageError('not-found', 'Imagem não encontrada.');
  if (item.slides.length === 1) {
    throw new StorageError(
      'invalid-input',
      'Um carrossel precisa de pelo menos uma imagem. Para apagar tudo, remova o item.',
    );
  }

  const updated = withSlides(
    item,
    item.slides.filter((s) => s.slot !== slot),
  );
  const saved = await commit(
    repo,
    record,
    record.scene.items.map((i) => (i.id === itemId ? updated : i)),
    now,
    { [slideFileKind(itemId, slot)]: null },
  );
  return { record: saved, item: updated };
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
  const target = record.scene.items.find((i) => i.id === itemId);
  if (!target) throw new StorageError('not-found', 'Item não encontrado.');
  const deletions: FileWrites = {};
  for (const unit of itemFileUnits(target)) deletions[unit.kind] = null;
  return commit(
    repo,
    record,
    record.scene.items.filter((i) => i.id !== itemId),
    now,
    deletions,
  );
}

/** Cria uma cópia do item (com cópia própria dos arquivos), levemente deslocada. */
export async function duplicateItem(
  repo: ProjectRepository,
  projectId: string,
  itemId: string,
  now: Date = new Date(),
): Promise<{ record: ProjectRecord; item: SceneItem }> {
  const { record } = await requireProject(repo, projectId);
  const original = record.scene.items.find((i) => i.id === itemId);
  if (!original) throw new StorageError('not-found', 'Item não encontrado.');
  if (record.scene.items.length >= MAX_ITEMS_PER_PROJECT) {
    throw new StorageError('invalid-input', `Este projeto já tem o máximo de ${MAX_ITEMS_PER_PROJECT} itens.`);
  }

  const copyId = newId().slice(0, 16);
  const writes: FileWrites = {};
  for (const unit of itemFileUnits(original)) {
    const opened = await openUnit(repo, projectId, original, unit);
    const kind = unit.slot === null ? itemFileKind(copyId) : slideFileKind(copyId, unit.slot);
    writes[kind] = { mimeType: unit.info.mimeType, data: toArrayBuffer(new Uint8Array(opened)) };
  }

  const copy: SceneItem = {
    ...original,
    id: copyId,
    name: normalizeName(`${original.name} (cópia)`) ?? original.name,
    transform: {
      ...original.transform,
      position: [
        original.transform.position[0] + 0.05,
        original.transform.position[1] - 0.05,
        original.transform.position[2],
      ],
    },
  };
  const saved = await commit(repo, record, [...record.scene.items, copy], now, writes);
  return { record: saved, item: copy };
}

export interface OpenedItem {
  record: ProjectRecord;
  item: SceneItem;
  data: ArrayBuffer;
}

/** Lê um arquivo do item conferindo tamanho e SHA-256 (como o alvo do projeto). */
async function openUnit(
  repo: ProjectRepository,
  projectId: string,
  item: SceneItem,
  unit: ItemFileUnit,
): Promise<ArrayBuffer> {
  const label = unit.slot === null ? `"${item.name}"` : `da imagem ${slideNumber(item, unit.slot)} de "${item.name}"`;
  const file = await repo.getFile(projectId, unit.kind);
  if (!file) throw new StorageError('not-found', `O arquivo de ${label} está ausente.`);
  if (file.data.byteLength !== unit.info.size) {
    throw new StorageError('integrity', `O arquivo de ${label} está incompleto ou foi alterado.`);
  }
  if ((await sha256Hex(file.data)) !== unit.info.sha256) {
    throw new StorageError('integrity', `O arquivo de ${label} está corrompido (hash diferente do registrado).`);
  }
  return file.data;
}

const slideNumber = (item: SceneItem, slot: number): number =>
  (item.slides ?? []).findIndex((s) => s.slot === slot) + 1;

/**
 * Lê o arquivo de um item. Num carrossel devolve a primeira imagem; para as
 * demais use openSlideFile.
 */
export async function openItemFile(repo: ProjectRepository, projectId: string, itemId: string): Promise<OpenedItem> {
  const { record } = await requireProject(repo, projectId);
  const item = record.scene.items.find((i) => i.id === itemId);
  if (!item) throw new StorageError('not-found', 'Item não encontrado.');
  const unit = itemFileUnits(item)[0];
  if (!unit) throw new StorageError('not-found', `O arquivo de "${item.name}" está ausente.`);
  return { record, item, data: await openUnit(repo, projectId, item, unit) };
}

/** Lê uma imagem de um carrossel pelo `slot`, conferindo tamanho e SHA-256. */
export async function openSlideFile(
  repo: ProjectRepository,
  projectId: string,
  itemId: string,
  slot: number,
): Promise<OpenedItem> {
  const { record } = await requireProject(repo, projectId);
  const item = requireCarousel(record, itemId);
  const unit = itemFileUnits(item).find((u) => u.slot === slot);
  if (!unit) throw new StorageError('not-found', 'Imagem não encontrada.');
  return { record, item, data: await openUnit(repo, projectId, item, unit) };
}
