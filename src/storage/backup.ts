import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { readMindHeader } from '../tracking/mindFormat';
import { isSha256Hex, newId, sha256Hex } from './hash';
import { ITEM_PATH_EXTENSIONS, itemExtension, matchesSignature } from './itemFiles';
import {
  assessProject,
  isIsoDate,
  isValidId,
  itemFileUnits,
  MAX_CAROUSEL_SLIDES,
  MAX_ITEMS_PER_PROJECT,
  MAX_ITEM_FILE_BYTES,
  normalizeName,
  parseProjectRecord,
  type FileKind,
  type ProjectHealth,
  type ProjectRecord,
} from './model';
import type { FileWrites, ProjectRepository } from './repository';

/**
 * Backup em ZIP. O formato está documentado em docs/FORMATO-BACKUP.md.
 *
 *   manifest.json
 *   projects/<id>/project.json
 *   projects/<id>/anchor.mind
 *   projects/<id>/reference-image.(png|jpg|webp|bin)
 *   projects/<id>/items/<itemId>.<ext>        (formato 2: itens da cena)
 *   projects/<id>/items/<itemId>~<n>.<ext>    (formato 3: imagens de um carrossel)
 *
 * A importação trata o arquivo como entrada NÃO confiável: só lê os caminhos
 * que o manifesto declara e que seguem o padrão acima, limita tamanhos e
 * confere SHA-256 de cada arquivo antes de gravar qualquer coisa.
 */

export const BACKUP_FORMAT = 'tattoo-ar-backup';
/** 1: alvo + foto. 2: acrescenta os itens da cena. 3: carrossel (várias imagens por item). O importador aceita 1, 2 e 3. */
export const BACKUP_FORMAT_VERSION = 3;
export const BACKUP_EXTENSION = '.tattoo-ar.zip';
export const MANIFEST_PATH = 'manifest.json';

export interface BackupLimits {
  /** Tamanho máximo do .zip. */
  maxZipBytes: number;
  /** Tamanho máximo (descompactado) de cada arquivo. */
  maxFileBytes: number;
  /** Soma máxima (descompactada) de todos os arquivos lidos. */
  maxTotalBytes: number;
  maxProjects: number;
  maxManifestBytes: number;
  maxProjectJsonBytes: number;
}

const MiB = 1024 * 1024;
export const DEFAULT_LIMITS: BackupLimits = {
  maxZipBytes: 256 * MiB,
  maxFileBytes: 64 * MiB,
  maxTotalBytes: 512 * MiB,
  maxProjects: 200,
  maxManifestBytes: 2 * MiB,
  maxProjectJsonBytes: 256 * 1024,
};

export type BackupErrorCode =
  | 'invalid-zip'
  | 'not-a-backup'
  | 'invalid-manifest'
  | 'newer-version'
  | 'too-large'
  | 'nothing-to-export';

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export interface BackupFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface BackupSlideEntry {
  slot: number;
  file: BackupFileEntry;
}

/** Item de arquivo único (`file`) ou carrossel (`slides`). */
export interface BackupItemEntry {
  id: string;
  file?: BackupFileEntry;
  slides?: BackupSlideEntry[];
}

export interface BackupProjectEntry {
  id: string;
  /** Só para leitura humana do manifesto; o nome de verdade está em project.json. */
  name: string;
  dir: string;
  project: BackupFileEntry;
  anchor?: BackupFileEntry;
  referenceImage?: BackupFileEntry;
  /** Arquivos dos itens da cena (formato 2). */
  items?: BackupItemEntry[];
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  app: { name: string; version: string };
  projects: BackupProjectEntry[];
}

// ------------------------------------------------------------------ caminhos

const IMAGE_EXTENSIONS = ['png', 'jpg', 'webp', 'bin'] as const;

const dirOf = (id: string): string => `projects/${id}`;
const projectJsonPath = (id: string): string => `${dirOf(id)}/project.json`;
const anchorPath = (id: string): string => `${dirOf(id)}/anchor.mind`;

function imageExtension(mimeType: string): (typeof IMAGE_EXTENSIONS)[number] {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

const itemPath = (id: string, itemId: string, mimeType: string, slot: number | null = null): string =>
  `${dirOf(id)}/items/${itemId}${slot === null ? '' : `~${slot}`}.${itemExtension(mimeType)}`;

function isItemPathFor(id: string, itemId: string, path: string, slot: number | null = null): boolean {
  const prefix = `${dirOf(id)}/items/${itemId}${slot === null ? '' : `~${slot}`}.`;
  return path.startsWith(prefix) && ITEM_PATH_EXTENSIONS.includes(path.slice(prefix.length));
}

const imagePath = (id: string, mimeType: string): string =>
  `${dirOf(id)}/reference-image.${imageExtension(mimeType)}`;

function isImagePathFor(id: string, path: string): boolean {
  const prefix = `${dirOf(id)}/reference-image.`;
  return (
    path.startsWith(prefix) &&
    (IMAGE_EXTENSIONS as readonly string[]).includes(path.slice(prefix.length))
  );
}

export function backupFileName(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}`;
  return `tattoo-ar-backup-${date}-${time}${BACKUP_EXTENSION}`;
}

// ------------------------------------------------------------------ exportar

export interface ExportOptions {
  appVersion: string;
  now?: Date;
}

export interface ExportResult {
  bytes: Uint8Array;
  fileName: string;
  manifest: BackupManifest;
  exported: Array<{ id: string; name: string }>;
  skipped: Array<{ id: string; reason: string }>;
  warnings: string[];
}

/**
 * Gera o ZIP com os projetos pedidos. Só entra no backup o que está íntegro:
 * um arquivo cujo tamanho ou SHA-256 não confere com o registro é deixado de
 * fora (com aviso), em vez de ser copiado corrompido sem ninguém saber.
 */
export async function exportBackup(
  repo: ProjectRepository,
  ids: readonly string[] | 'all',
  options: ExportOptions,
): Promise<ExportResult> {
  const now = options.now ?? new Date();
  const entries = await repo.list();
  const wanted = ids === 'all' ? null : new Set(ids);

  const exported: ExportResult['exported'] = [];
  const skipped: ExportResult['skipped'] = [];
  const warnings: string[] = [];
  const manifestProjects: BackupProjectEntry[] = [];
  const zippable: Zippable = {};

  if (wanted) {
    const known = new Set(entries.map((e) => (e.kind === 'project' ? e.record.id : e.id)));
    for (const id of wanted) {
      if (!known.has(id)) skipped.push({ id, reason: 'Projeto não encontrado.' });
    }
  }

  for (const entry of entries) {
    const id = entry.kind === 'project' ? entry.record.id : entry.id;
    if (wanted && !wanted.has(id)) continue;
    if (entry.kind === 'unreadable') {
      skipped.push({ id, reason: entry.message });
      continue;
    }

    const { record } = entry;
    const kept: Partial<Record<FileKind, { bytes: Uint8Array; path: string }>> = {};
    const outRecord: ProjectRecord = { ...record };

    for (const kind of ['anchor', 'referenceImage'] as const) {
      const info = record[kind];
      if (info === null) continue;
      const file = await repo.getFile(id, kind);
      const label = kind === 'anchor' ? 'o alvo' : 'a imagem de referência';
      if (!file) {
        warnings.push(`"${record.name}": ${label} está ausente e ficou fora do backup.`);
      } else if (
        file.data.byteLength !== info.size ||
        (await sha256Hex(file.data)) !== info.sha256
      ) {
        warnings.push(`"${record.name}": ${label} está corrompido e ficou fora do backup.`);
      } else {
        kept[kind] = {
          bytes: new Uint8Array(file.data),
          path: kind === 'anchor' ? anchorPath(id) : imagePath(id, info.mimeType),
        };
        continue;
      }
      // Reflete a realidade no registro exportado: sem o arquivo, sem o descritor.
      outRecord[kind] = null;
    }

    if (!kept.anchor && !kept.referenceImage) {
      skipped.push({ id, reason: `"${record.name}" não tem nenhum arquivo íntegro para exportar.` });
      continue;
    }

    // Itens da cena: só saem os que têm todos os arquivos íntegros; os demais são
    // removidos da cena exportada (com aviso) para não deixar item sem arquivo.
    const keptItems: Array<{
      id: string;
      slot: number | null;
      mimeType: string;
      bytes: Uint8Array;
      path: string;
      size: number;
      sha256: string;
    }> = [];
    const outItems = [];
    for (const sceneItem of record.scene.items) {
      const units: typeof keptItems = [];
      let problem: string | null = null;
      for (const unit of itemFileUnits(sceneItem)) {
        const file = await repo.getFile(id, unit.kind);
        if (!file) {
          problem = 'ausente';
          break;
        }
        if (file.data.byteLength !== unit.info.size || (await sha256Hex(file.data)) !== unit.info.sha256) {
          problem = 'corrompido';
          break;
        }
        units.push({
          id: sceneItem.id,
          slot: unit.slot,
          mimeType: unit.info.mimeType,
          bytes: new Uint8Array(file.data),
          path: itemPath(id, sceneItem.id, unit.info.mimeType, unit.slot),
          size: unit.info.size,
          sha256: unit.info.sha256,
        });
      }
      if (problem !== null) {
        warnings.push(
          `"${record.name}": um arquivo do item "${sceneItem.name}" está ${problem} e o item ficou fora do backup.`,
        );
        continue;
      }
      outItems.push(sceneItem);
      keptItems.push(...units);
    }
    outRecord.scene = { items: outItems };

    const projectBytes = strToU8(JSON.stringify(outRecord, null, 2));
    const item: BackupProjectEntry = {
      id,
      name: record.name,
      dir: dirOf(id),
      project: {
        path: projectJsonPath(id),
        size: projectBytes.byteLength,
        sha256: await sha256Hex(projectBytes),
      },
    };
    zippable[item.project.path] = [projectBytes, { level: 6, mtime: now }];

    if (kept.anchor && outRecord.anchor) {
      item.anchor = { path: kept.anchor.path, size: outRecord.anchor.size, sha256: outRecord.anchor.sha256 };
      zippable[kept.anchor.path] = [kept.anchor.bytes, { level: 6, mtime: now }];
    }
    if (kept.referenceImage && outRecord.referenceImage) {
      item.referenceImage = {
        path: kept.referenceImage.path,
        size: outRecord.referenceImage.size,
        sha256: outRecord.referenceImage.sha256,
      };
      // PNG/JPEG/WebP já são comprimidos: guardar sem recomprimir.
      zippable[kept.referenceImage.path] = [kept.referenceImage.bytes, { level: 0, mtime: now }];
    }

    if (keptItems.length > 0) {
      item.items = [];
      for (const kept of keptItems) {
        const file: BackupFileEntry = { path: kept.path, size: kept.size, sha256: kept.sha256 };
        if (kept.slot === null) {
          item.items.push({ id: kept.id, file });
        } else {
          let entry = item.items.find((candidate) => candidate.id === kept.id);
          if (!entry) {
            entry = { id: kept.id, slides: [] };
            item.items.push(entry);
          }
          entry.slides!.push({ slot: kept.slot, file });
        }
        // Mídia já é comprimida; só o GLB se beneficia de deflate.
        const level = kept.mimeType === 'model/gltf-binary' ? 6 : 0;
        zippable[kept.path] = [kept.bytes, { level, mtime: now }];
      }
    }

    manifestProjects.push(item);
    exported.push({ id, name: record.name });
  }

  if (manifestProjects.length === 0) {
    throw new BackupError('nothing-to-export', 'Nenhum projeto íntegro para exportar.');
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    app: { name: 'momentoos', version: options.appVersion },
    projects: manifestProjects,
  };
  zippable[MANIFEST_PATH] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6, mtime: now }];

  return {
    bytes: zipSync(zippable),
    fileName: backupFileName(now),
    manifest,
    exported,
    skipped,
    warnings,
  };
}

// ------------------------------------------------------------------ importar

export interface ImportOptions {
  limits?: Partial<BackupLimits>;
}

export interface ImportedItem {
  id: string;
  originalId: string;
  name: string;
  /** true quando o id já existia aqui e o projeto entrou como cópia. */
  renamed: boolean;
  health: ProjectHealth;
}

export interface SkippedItem {
  id?: string;
  name?: string;
  reason: string;
}

export interface ImportReport {
  imported: ImportedItem[];
  skipped: SkippedItem[];
  warnings: string[];
  backupCreatedAt: string;
}

export async function importBackup(
  repo: ProjectRepository,
  zip: Uint8Array,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const limits: BackupLimits = { ...DEFAULT_LIMITS, ...options.limits };

  if (zip.byteLength > limits.maxZipBytes) {
    throw new BackupError('too-large', 'O arquivo de backup é grande demais para importar.');
  }

  // 1) Só o manifesto: o que mais existir no ZIP é ignorado e nem é descompactado.
  let manifestFiles: Record<string, Uint8Array>;
  try {
    manifestFiles = unzipSync(zip, {
      filter: (file) => file.name === MANIFEST_PATH && file.originalSize <= limits.maxManifestBytes,
    });
  } catch {
    throw new BackupError('invalid-zip', 'O arquivo não é um ZIP válido (ou está corrompido).');
  }
  const manifestBytes = manifestFiles[MANIFEST_PATH];
  if (!manifestBytes) {
    throw new BackupError('not-a-backup', 'Este ZIP não é um backup do Tattoo AR (não há manifest.json).');
  }
  const manifest = parseManifest(manifestBytes, limits);

  // 2) Só os arquivos declarados no manifesto, com o tamanho declarado.
  const declared = new Map<string, BackupFileEntry>();
  for (const project of manifest.projects) {
    declared.set(project.project.path, project.project);
    if (project.anchor) declared.set(project.anchor.path, project.anchor);
    if (project.referenceImage) declared.set(project.referenceImage.path, project.referenceImage);
    for (const entry of project.items ?? []) {
      if (entry.file) declared.set(entry.file.path, entry.file);
      for (const slide of entry.slides ?? []) declared.set(slide.file.path, slide.file);
    }
  }

  let total = 0;
  let overLimit = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (file) => {
        const entry = declared.get(file.name);
        if (!entry) return false;
        if (file.originalSize > limits.maxFileBytes || file.originalSize !== entry.size) return false;
        total += file.originalSize;
        if (total > limits.maxTotalBytes) {
          overLimit = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new BackupError('invalid-zip', 'O arquivo não é um ZIP válido (ou está corrompido).');
  }
  if (overLimit) {
    throw new BackupError('too-large', 'O conteúdo do backup descompactado é grande demais para importar.');
  }

  const report: ImportReport = {
    imported: [],
    skipped: [],
    warnings: [],
    backupCreatedAt: manifest.createdAt,
  };

  for (const item of manifest.projects) {
    try {
      await importProject(repo, item, files, report);
    } catch (error) {
      report.skipped.push({
        id: item.id,
        name: item.name,
        reason: error instanceof Error ? error.message : 'Falha ao importar.',
      });
    }
  }
  return report;
}

async function importProject(
  repo: ProjectRepository,
  item: BackupProjectEntry,
  files: Record<string, Uint8Array>,
  report: ImportReport,
): Promise<void> {
  const name = item.name || item.id;
  const skip = (reason: string): void => {
    report.skipped.push({ id: item.id, name, reason });
  };

  // project.json
  const projectBytes = files[item.project.path];
  if (!projectBytes) return skip('project.json ausente ou com tamanho diferente do declarado.');
  if ((await sha256Hex(projectBytes)) !== item.project.sha256) return skip('project.json corrompido (hash não confere).');

  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(projectBytes));
  } catch {
    return skip('project.json não é um JSON válido.');
  }
  const parsed = parseProjectRecord(raw);
  if (!parsed.ok) return skip(parsed.message);
  const record: ProjectRecord = { ...parsed.record };
  if (record.id !== item.id) return skip('O id em project.json não bate com o do manifesto.');

  // arquivos: só entram os que conferem em tamanho e hash
  const payloads: FileWrites = {};
  for (const kind of ['anchor', 'referenceImage'] as const) {
    const info = record[kind];
    if (info === null) continue;
    const label = kind === 'anchor' ? 'o alvo' : 'a imagem de referência';
    const declaredEntry = item[kind];
    const bytes = declaredEntry ? files[declaredEntry.path] : undefined;

    let problem: string | null = null;
    if (!declaredEntry || !bytes) problem = 'ausente no backup';
    else if (
      bytes.byteLength !== info.size ||
      declaredEntry.size !== info.size ||
      declaredEntry.sha256 !== info.sha256 ||
      (await sha256Hex(bytes)) !== info.sha256
    ) {
      problem = 'corrompido (hash ou tamanho não conferem)';
    }

    if (problem === null && kind === 'anchor' && bytes) {
      const header = readMindHeader(bytes);
      if (!header.ok) problem = header.message;
    }

    if (problem !== null || !bytes) {
      report.warnings.push(`"${name}": ${label} ${problem ?? 'ausente'}; foi ignorado.`);
      record[kind] = null;
      continue;
    }
    payloads[kind] = {
      mimeType: info.mimeType,
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  }

  if (record.anchor === null && record.referenceImage === null) {
    return skip('Nenhum arquivo íntegro no backup: não há como abrir nem recompilar.');
  }

  // itens da cena: só entram os que conferem em tamanho, hash e formato
  const keptItems = [];
  for (const sceneItem of record.scene.items) {
    const declaredItem = item.items?.find((entry) => entry.id === sceneItem.id);
    const itemPayloads: FileWrites = {};
    let problem: string | null = null;

    for (const unit of itemFileUnits(sceneItem)) {
      const declaredEntry =
        unit.slot === null
          ? declaredItem?.file
          : declaredItem?.slides?.find((slide) => slide.slot === unit.slot)?.file;
      const bytes = declaredEntry ? files[declaredEntry.path] : undefined;

      if (!declaredEntry || !bytes) problem = 'ausente no backup';
      else if (
        bytes.byteLength !== unit.info.size ||
        declaredEntry.size !== unit.info.size ||
        declaredEntry.sha256 !== unit.info.sha256 ||
        (await sha256Hex(bytes)) !== unit.info.sha256
      ) {
        problem = 'corrompido (hash ou tamanho não conferem)';
      } else if (!matchesSignature(unit.info.mimeType, bytes)) {
        problem = 'com conteúdo diferente do formato declarado';
      }
      if (problem !== null || !bytes) {
        problem ??= 'ausente no backup';
        break;
      }
      itemPayloads[unit.kind] = {
        mimeType: unit.info.mimeType,
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      };
    }

    if (problem !== null) {
      report.warnings.push(`"${name}": um arquivo do item "${sceneItem.name}" está ${problem}; o item foi ignorado.`);
      continue;
    }
    keptItems.push(sceneItem);
    Object.assign(payloads, itemPayloads);
  }
  record.scene = { items: keptItems };

  // colisão de id
  const existing = await repo.getEntry(record.id);
  let renamed = false;
  if (existing) {
    if (
      existing.kind === 'project' &&
      existing.record.updatedAt === record.updatedAt &&
      existing.record.anchor?.sha256 === record.anchor?.sha256 &&
      existing.record.referenceImage?.sha256 === record.referenceImage?.sha256
    ) {
      return skip('Este projeto já existe aqui, idêntico.');
    }
    record.id = newId();
    record.name = normalizeName(`${record.name} (importado)`) ?? record.name;
    renamed = true;
  }

  await repo.save(record, payloads);
  report.imported.push({
    id: record.id,
    originalId: item.id,
    name: record.name,
    renamed,
    health: assessProject(record, {
      anchor: payloads.anchor !== undefined && payloads.anchor !== null,
      referenceImage: payloads.referenceImage !== undefined && payloads.referenceImage !== null,
    }),
  });
}

// ------------------------------------------------------------------ manifesto

function parseManifest(bytes: Uint8Array, limits: BackupLimits): BackupManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(bytes));
  } catch {
    throw new BackupError('invalid-manifest', 'O manifest.json não é um JSON válido.');
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) {
    throw new BackupError('not-a-backup', 'Este ZIP não é um backup do Tattoo AR.');
  }

  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupError('invalid-manifest', 'O manifesto não informa a versão do formato de backup.');
  }
  if (version > BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      'newer-version',
      `Este backup foi gerado por uma versão mais nova do app (formato ${version}; esta versão entende até o ${BACKUP_FORMAT_VERSION}). Atualize o app para importá-lo.`,
    );
  }

  if (!isIsoDate(raw.createdAt)) throw new BackupError('invalid-manifest', 'Data de criação do backup inválida.');
  if (!Array.isArray(raw.projects)) throw new BackupError('invalid-manifest', 'O manifesto não lista projetos.');
  if (raw.projects.length > limits.maxProjects) {
    throw new BackupError('too-large', `O backup tem projetos demais (o limite é ${limits.maxProjects}).`);
  }

  const seen = new Set<string>();
  const projects = raw.projects.map((value, index): BackupProjectEntry => {
    const where = `projeto ${index + 1} do manifesto`;
    if (!isObject(value)) throw new BackupError('invalid-manifest', `${where}: formato inválido.`);
    const id = value.id;
    if (!isValidId(id)) throw new BackupError('invalid-manifest', `${where}: id inválido.`);
    if (seen.has(id)) throw new BackupError('invalid-manifest', `${where}: id repetido.`);
    seen.add(id);
    if (value.dir !== dirOf(id)) throw new BackupError('invalid-manifest', `${where}: pasta inesperada.`);

    const item: BackupProjectEntry = {
      id,
      name: typeof value.name === 'string' ? value.name.slice(0, 200) : '',
      dir: dirOf(id),
      project: fileEntry(value.project, where, limits.maxProjectJsonBytes, (p) => p === projectJsonPath(id)),
    };
    if (value.anchor !== undefined) {
      item.anchor = fileEntry(value.anchor, where, limits.maxFileBytes, (p) => p === anchorPath(id));
    }
    if (value.referenceImage !== undefined) {
      item.referenceImage = fileEntry(value.referenceImage, where, limits.maxFileBytes, (p) =>
        isImagePathFor(id, p),
      );
    }
    if (value.items !== undefined) {
      if (!Array.isArray(value.items) || value.items.length > MAX_ITEMS_PER_PROJECT) {
        throw new BackupError('invalid-manifest', `${where}: lista de itens inválida.`);
      }
      const itemIds = new Set<string>();
      item.items = value.items.map((entry: unknown): BackupItemEntry => {
        if (!isObject(entry) || !isValidId(entry.id)) {
          throw new BackupError('invalid-manifest', `${where}: item mal descrito.`);
        }
        const itemId = entry.id;
        if (itemIds.has(itemId)) throw new BackupError('invalid-manifest', `${where}: item repetido.`);
        itemIds.add(itemId);
        const limit = Math.min(limits.maxFileBytes, MAX_ITEM_FILE_BYTES);
        if (entry.slides !== undefined) {
          if (entry.file !== undefined) {
            throw new BackupError('invalid-manifest', `${where}: item com arquivo e com imagens ao mesmo tempo.`);
          }
          if (!Array.isArray(entry.slides) || entry.slides.length === 0 || entry.slides.length > MAX_CAROUSEL_SLIDES) {
            throw new BackupError('invalid-manifest', `${where}: lista de imagens do carrossel inválida.`);
          }
          const slots = new Set<number>();
          const slides = entry.slides.map((value: unknown): BackupSlideEntry => {
            if (!isObject(value) || !Number.isInteger(value.slot) || (value.slot as number) < 0 || (value.slot as number) > 9999) {
              throw new BackupError('invalid-manifest', `${where}: imagem de carrossel mal descrita.`);
            }
            const slot = value.slot as number;
            if (slots.has(slot)) throw new BackupError('invalid-manifest', `${where}: imagem de carrossel repetida.`);
            slots.add(slot);
            return { slot, file: fileEntry(value.file, where, limit, (p) => isItemPathFor(id, itemId, p, slot)) };
          });
          return { id: itemId, slides };
        }
        return {
          id: itemId,
          file: fileEntry(entry.file, where, limit, (p) => isItemPathFor(id, itemId, p)),
        };
      });
    }
    return item;
  });

  const app = isObject(raw.app) ? raw.app : {};
  return {
    format: BACKUP_FORMAT,
    formatVersion: version,
    createdAt: raw.createdAt,
    app: {
      name: typeof app.name === 'string' ? app.name.slice(0, 100) : '',
      version: typeof app.version === 'string' ? app.version.slice(0, 50) : '',
    },
    projects,
  };
}

function fileEntry(
  value: unknown,
  where: string,
  maxBytes: number,
  pathOk: (path: string) => boolean,
): BackupFileEntry {
  if (!isObject(value)) throw new BackupError('invalid-manifest', `${where}: arquivo mal descrito.`);
  const { path, size, sha256 } = value;
  if (typeof path !== 'string' || !pathOk(path)) {
    throw new BackupError('invalid-manifest', `${where}: caminho de arquivo inesperado.`);
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > maxBytes) {
    throw new BackupError('invalid-manifest', `${where}: tamanho de arquivo inválido ou acima do limite.`);
  }
  if (!isSha256Hex(sha256)) throw new BackupError('invalid-manifest', `${where}: hash de arquivo inválido.`);
  return { path, size, sha256 };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
