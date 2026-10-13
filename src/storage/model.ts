import { MIND_FORMAT_VERSION } from '../tracking/mindFormat';
import { isSha256Hex } from './hash';

/**
 * Versão do formato do registro de projeto (campo `formatVersion`).
 * Aumente quando a estrutura mudar e adicione o passo em MIGRATIONS.
 */
export const PROJECT_FORMAT_VERSION = 2;

export const NAME_MAX_LENGTH = 80;

/** Engine que gerou o alvo; guardado para diagnosticar incompatibilidades. */
export const ANCHOR_ENGINE = 'mind-ar@1.2.5';

// ---------------------------------------------------------------- cena

export type Vec3 = [number, number, number];

/**
 * Ajustes de posicionamento de um item. Convenção (a mesma do MindARThree, ver
 * docs/RASTREAMENTO.md): origem no centro do alvo, 1 unidade = largura do
 * alvo, +x para a direita, +y para cima, +z saindo da pele.
 */
export interface ItemTransform {
  /** Escala uniforme; 1 = largura do alvo para mídia plana. */
  scale: number;
  /** Rotação em graus (x, y, z). */
  rotation: Vec3;
  /** Posição sobre o alvo. */
  position: Vec3;
  /** Deslocamento fino aplicado depois da rotação, no eixo local do item. */
  offset: Vec3;
}

export function defaultTransform(): ItemTransform {
  return { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] };
}

/**
 * Tipos de item. 'youtube' NÃO existe de propósito: um iframe não entra numa
 * cena WebGL e a reprodução depende de internet e das regras do próprio serviço.
 */
export const ITEM_TYPES = ['image', 'gif', 'video', 'model', 'audio'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** Itens que aparecem na cena 3D (áudio só toca). */
export const VISUAL_ITEM_TYPES: readonly ItemType[] = ['image', 'gif', 'video', 'model'];

/**
 * Tipos MIME aceitos por tipo de item. Modelos aceitam só GLB (um arquivo
 * único); glTF com arquivos externos não é suportado.
 */
export const ITEM_MIME: Record<ItemType, readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  gif: ['image/gif'],
  video: ['video/mp4', 'video/webm'],
  model: ['model/gltf-binary'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/webm'],
};

/** Máximo de itens por projeto: um teto técnico para proteger a memória do celular, não um número de produto. */
export const MAX_ITEMS_PER_PROJECT = 100;

/** Tamanho máximo de cada arquivo de item (abaixo do limite de arquivo do backup, 64 MiB). */
export const MAX_ITEM_FILE_BYTES = 48 * 1024 * 1024;

export const ITEM_FILENAME_MAX_LENGTH = 200;

export interface ItemOptions {
  /** 0 a 1; vale para itens visuais. */
  opacity: number;
  /** Repetir (vídeo, áudio e animações do modelo). */
  loop: boolean;
  /** Vídeo: começa sem som (navegadores só liberam autoplay com som mudo). */
  muted: boolean;
  /** 0 a 1; vale para vídeo e áudio. */
  volume: number;
  /** Modelo: tocar as animações. */
  animate: boolean;
  /** Modelo: nome da animação a tocar; null = todas. */
  clip: string | null;
}

export function defaultOptions(type: ItemType): ItemOptions {
  return {
    opacity: 1,
    loop: true,
    muted: type === 'video',
    volume: 1,
    animate: type === 'model',
    clip: null,
  };
}

export interface ItemFileInfo extends StoredFileInfo {
  /** Nome original do arquivo, só para exibir. */
  fileName: string;
  /** Dimensões em pixels (imagem, GIF e vídeo), quando conhecidas. */
  width?: number;
  height?: number;
  /** Duração (vídeo e áudio), quando conhecida. */
  durationMs?: number;
}

export interface SceneItem {
  id: string;
  type: ItemType;
  name: string;
  visible: boolean;
  file: ItemFileInfo;
  transform: ItemTransform;
  options: ItemOptions;
}

/** O ambiente 3D ancorado: qualquer quantidade de itens (até MAX_ITEMS_PER_PROJECT). */
export interface Scene {
  items: SceneItem[];
}

export function emptyScene(): Scene {
  return { items: [] };
}

// ---------------------------------------------------------------- registro

export interface StoredFileInfo {
  mimeType: string;
  size: number;
  sha256: string;
}

export interface ReferenceImageInfo extends StoredFileInfo {
  width: number;
  height: number;
}

export interface AnchorInfo extends StoredFileInfo {
  /** Versão do formato .mind (ver MIND_FORMAT_VERSION). */
  mindFormat: number;
  width: number;
  height: number;
  engine: string;
  compiledAt: string;
}

/** Metadados do projeto. Os bytes (imagem e alvo) ficam em outro store. */
export interface ProjectRecord {
  formatVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  referenceImage: ReferenceImageInfo | null;
  anchor: AnchorInfo | null;
  scene: Scene;
}

/**
 * Chave de um arquivo guardado junto do projeto: 'anchor', 'referenceImage' ou
 * 'item:<id do item>'.
 */
export type FileKind = 'anchor' | 'referenceImage' | `item:${string}`;

export const itemFileKind = (itemId: string): FileKind => `item:${itemId}`;

export function isFileKind(value: unknown): value is FileKind {
  if (value === 'anchor' || value === 'referenceImage') return true;
  return typeof value === 'string' && value.startsWith('item:') && isValidId(value.slice(5));
}

// ---------------------------------------------------------------- nomes e ids

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Ids viram nomes de pasta no backup ZIP; por isso o conjunto de caracteres é restrito. */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Remove espaços sobrando e limita o tamanho. Devolve null se ficar vazio. */
export function normalizeName(input: string): string | null {
  const name = input.replace(/\s+/g, ' ').trim();
  if (name.length === 0) return null;
  return name.length > NAME_MAX_LENGTH ? name.slice(0, NAME_MAX_LENGTH).trimEnd() : name;
}

// ---------------------------------------------------------------- leitura e migração

export type ParseResult =
  | { ok: true; record: ProjectRecord; migrated: boolean }
  | {
      ok: false;
      code: 'unreadable' | 'newer-version';
      message: string;
      formatVersion?: number;
    };

/**
 * Migrações por versão de origem: MIGRATIONS[n] converte um registro da
 * versão n para a n+1.
 *
 * 1 → 2: o campo único `content` (que na prática era sempre "none": o app nunca
 * gravou conteúdo real) dá lugar a `scene`, uma lista de itens. Registros v1
 * começam com a cena vazia.
 */
const MIGRATIONS: Record<number, (record: Record<string, unknown>) => Record<string, unknown>> = {
  1: (record) => {
    const { content: _content, ...rest } = record;
    return { ...rest, scene: emptyScene() };
  },
};

/**
 * Valida (e migra, se preciso) um registro lido do banco ou de um backup.
 * Nunca lança: registros ruins viram `ok: false` para a interface decidir.
 */
export function parseProjectRecord(raw: unknown): ParseResult {
  if (!isPlainObject(raw)) {
    return { ok: false, code: 'unreadable', message: 'O registro do projeto está corrompido.' };
  }

  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      code: 'unreadable',
      message: 'O registro do projeto não informa a versão do formato.',
    };
  }
  if (version > PROJECT_FORMAT_VERSION) {
    return {
      ok: false,
      code: 'newer-version',
      formatVersion: version,
      message: `Este projeto foi criado por uma versão mais nova do app (formato ${version}; esta versão entende até o ${PROJECT_FORMAT_VERSION}). Atualize o app para abri-lo.`,
    };
  }

  let current: Record<string, unknown> = raw;
  let migrated = false;
  for (let v = version; v < PROJECT_FORMAT_VERSION; v += 1) {
    const step = MIGRATIONS[v];
    if (!step) {
      return {
        ok: false,
        code: 'unreadable',
        message: `Não há migração do formato ${v} para o ${v + 1}.`,
      };
    }
    current = { ...step(current), formatVersion: v + 1 };
    migrated = true;
  }

  const problem = validateRecord(current);
  if (problem) {
    return { ok: false, code: 'unreadable', message: `Projeto inválido: ${problem}` };
  }
  return { ok: true, record: current as unknown as ProjectRecord, migrated };
}

function validateRecord(r: Record<string, unknown>): string | null {
  if (!isValidId(r.id)) return 'id ausente ou com caracteres inválidos.';
  if (typeof r.name !== 'string' || normalizeName(r.name) === null) return 'nome ausente.';
  if (!isIsoDate(r.createdAt)) return 'data de criação inválida.';
  if (!isIsoDate(r.updatedAt)) return 'data de modificação inválida.';

  if (r.referenceImage !== null) {
    const image = r.referenceImage;
    if (!isPlainObject(image)) return 'imagem de referência inválida.';
    const fileProblem = validateFileInfo(image);
    if (fileProblem) return `imagem de referência: ${fileProblem}`;
    if (!isPositive(image.width) || !isPositive(image.height)) {
      return 'imagem de referência sem dimensões válidas.';
    }
  }

  if (r.anchor !== null) {
    const anchor = r.anchor;
    if (!isPlainObject(anchor)) return 'alvo inválido.';
    const fileProblem = validateFileInfo(anchor);
    if (fileProblem) return `alvo: ${fileProblem}`;
    if (!Number.isInteger(anchor.mindFormat)) return 'alvo sem versão de formato.';
    if (!isPositive(anchor.width) || !isPositive(anchor.height)) {
      return 'alvo sem dimensões válidas.';
    }
    if (typeof anchor.engine !== 'string') return 'alvo sem engine.';
    if (!isIsoDate(anchor.compiledAt)) return 'data de compilação do alvo inválida.';
  }

  return validateScene(r.scene);
}

function validateFileInfo(info: Record<string, unknown>): string | null {
  if (typeof info.mimeType !== 'string' || info.mimeType.length === 0) return 'tipo de arquivo ausente.';
  if (!Number.isInteger(info.size) || (info.size as number) < 0) return 'tamanho inválido.';
  if (!isSha256Hex(info.sha256)) return 'hash inválido.';
  return null;
}

function validateTransform(t: unknown): string | null {
  if (!isPlainObject(t)) return 'ajustes de posicionamento ausentes.';
  if (!isFiniteNumber(t.scale) || (t.scale as number) <= 0) return 'escala inválida.';
  for (const key of ['rotation', 'position', 'offset'] as const) {
    if (!isVec3(t[key])) return `${key} inválido.`;
  }
  return null;
}

function validateOptions(o: unknown): string | null {
  if (!isPlainObject(o)) return 'opções ausentes.';
  for (const key of ['opacity', 'volume'] as const) {
    const value = o[key];
    if (!isFiniteNumber(value) || value < 0 || value > 1) return `${key} fora do intervalo 0–1.`;
  }
  for (const key of ['loop', 'muted', 'animate'] as const) {
    if (typeof o[key] !== 'boolean') return `${key} inválido.`;
  }
  if (o.clip !== null && (typeof o.clip !== 'string' || o.clip.length === 0 || o.clip.length > 200)) {
    return 'nome da animação inválido.';
  }
  return null;
}

function validateItem(item: unknown): string | null {
  if (!isPlainObject(item)) return 'formato inválido.';
  if (!isValidId(item.id)) return 'id inválido.';
  if (!ITEM_TYPES.includes(item.type as ItemType)) return 'tipo desconhecido.';
  const type = item.type as ItemType;
  if (typeof item.name !== 'string' || normalizeName(item.name) === null) return 'nome ausente.';
  if (typeof item.visible !== 'boolean') return 'visibilidade inválida.';

  const file = item.file;
  if (!isPlainObject(file)) return 'arquivo ausente.';
  const fileProblem = validateFileInfo(file);
  if (fileProblem) return `arquivo: ${fileProblem}`;
  if (!ITEM_MIME[type].includes(file.mimeType as string)) {
    return `tipo de arquivo ${String(file.mimeType)} não é aceito para ${type}.`;
  }
  if ((file.size as number) > MAX_ITEM_FILE_BYTES) return 'arquivo grande demais.';
  if (typeof file.fileName !== 'string' || file.fileName.length === 0 || file.fileName.length > ITEM_FILENAME_MAX_LENGTH) {
    return 'nome do arquivo inválido.';
  }
  for (const key of ['width', 'height', 'durationMs'] as const) {
    if (file[key] !== undefined && !isPositive(file[key])) return `${key} inválido.`;
  }

  const transformProblem = validateTransform(item.transform);
  if (transformProblem) return transformProblem;
  return validateOptions(item.options);
}

function validateScene(scene: unknown): string | null {
  if (!isPlainObject(scene) || !Array.isArray(scene.items)) return 'cena ausente.';
  if (scene.items.length > MAX_ITEMS_PER_PROJECT) {
    return `itens demais (o limite é ${MAX_ITEMS_PER_PROJECT}).`;
  }
  const seen = new Set<string>();
  for (let index = 0; index < scene.items.length; index++) {
    const problem = validateItem(scene.items[index]);
    if (problem) return `item ${index + 1}: ${problem}`;
    const id = (scene.items[index] as { id: string }).id;
    if (seen.has(id)) return `item ${index + 1}: id repetido.`;
    seen.add(id);
  }
  return null;
}

// ---------------------------------------------------------------- saúde

export interface FilePresence {
  anchor: boolean;
  referenceImage: boolean;
}

/**
 * - ready: o alvo existe, está presente e no formato que este app usa.
 * - needs-recompile: o alvo não serve (ausente ou formato antigo), mas a
 *   imagem de referência está íntegra: dá para recompilar sem perder o projeto.
 * - broken: não há como abrir nem recompilar.
 */
export type ProjectHealth =
  | { status: 'ready' }
  | { status: 'needs-recompile'; reason: string }
  | { status: 'broken'; reason: string };

export function assessProject(record: ProjectRecord, present: FilePresence): ProjectHealth {
  if (record.anchor !== null && present.anchor && record.anchor.mindFormat === MIND_FORMAT_VERSION) {
    return { status: 'ready' };
  }

  let reason: string;
  if (record.anchor === null) reason = 'O projeto não tem alvo compilado.';
  else if (!present.anchor) reason = 'O arquivo do alvo está ausente.';
  else {
    reason = `O alvo está em formato incompatível (versão ${record.anchor.mindFormat}; este app usa a ${MIND_FORMAT_VERSION}).`;
  }

  if (record.referenceImage !== null && present.referenceImage) {
    return { status: 'needs-recompile', reason };
  }
  return { status: 'broken', reason: `${reason} Também não há imagem de referência para recompilar.` };
}

// ---------------------------------------------------------------- utilidades

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositive(value: unknown): boolean {
  return isFiniteNumber(value) && value > 0;
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && !Number.isNaN(Date.parse(value));
}
