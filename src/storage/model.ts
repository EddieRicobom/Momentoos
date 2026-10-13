import { MIND_FORMAT_VERSION } from '../tracking/mindFormat';
import { isSha256Hex } from './hash';

/**
 * Versão do formato do registro de projeto (campo `formatVersion`).
 * Aumente quando a estrutura mudar e adicione o passo em MIGRATIONS.
 */
export const PROJECT_FORMAT_VERSION = 1;

export const NAME_MAX_LENGTH = 80;

/** Engine que gerou o alvo; guardado para diagnosticar incompatibilidades. */
export const ANCHOR_ENGINE = 'mind-ar@1.2.5';

// ---------------------------------------------------------------- conteúdo

/**
 * Tipos de conteúdo previstos. Hoje só 'none' é usado: a associação de
 * conteúdo real é a Etapa D. O campo existe desde já para que os projetos
 * salvos agora continuem válidos quando os demais tipos forem implementados.
 */
export const CONTENT_TYPES = [
  'none',
  'image',
  'gif',
  'video',
  'youtube',
  'model3d',
  'model3d-animated',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export type Vec3 = [number, number, number];

/**
 * Ajustes de posicionamento do conteúdo. Convenção (a mesma do MindARThree,
 * ver docs/RASTREAMENTO.md): origem no centro do alvo, 1 unidade = largura do
 * alvo, +z saindo da pele. Valores reservados para o editor da Etapa D.
 */
export interface ContentTransform {
  /** Escala uniforme; 1 = largura do alvo. */
  scale: number;
  /** Rotação em graus (x, y, z). */
  rotation: Vec3;
  /** Posição sobre o alvo. */
  position: Vec3;
  /** Deslocamento fino aplicado depois da rotação, no eixo local do conteúdo. */
  offset: Vec3;
}

export interface ContentConfig {
  type: ContentType;
  transform: ContentTransform;
}

export function defaultContent(): ContentConfig {
  return {
    type: 'none',
    transform: { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] },
  };
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
  content: ContentConfig;
}

export type FileKind = 'anchor' | 'referenceImage';
export const FILE_KINDS: readonly FileKind[] = ['anchor', 'referenceImage'];

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
 * versão n para a n+1. Vazio porque a versão 1 é a primeira.
 */
const MIGRATIONS: Record<number, (record: Record<string, unknown>) => Record<string, unknown>> = {};

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

  return validateContent(r.content);
}

function validateFileInfo(info: Record<string, unknown>): string | null {
  if (typeof info.mimeType !== 'string' || info.mimeType.length === 0) return 'tipo de arquivo ausente.';
  if (!Number.isInteger(info.size) || (info.size as number) < 0) return 'tamanho inválido.';
  if (!isSha256Hex(info.sha256)) return 'hash inválido.';
  return null;
}

function validateContent(content: unknown): string | null {
  if (!isPlainObject(content)) return 'configuração de conteúdo ausente.';
  if (!CONTENT_TYPES.includes(content.type as ContentType)) return 'tipo de conteúdo desconhecido.';
  const t = content.transform;
  if (!isPlainObject(t)) return 'ajustes de posicionamento ausentes.';
  if (!isFiniteNumber(t.scale) || (t.scale as number) <= 0) return 'escala inválida.';
  for (const key of ['rotation', 'position', 'offset'] as const) {
    if (!isVec3(t[key])) return `${key} inválido.`;
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
