import { StorageError, toStorageError } from './errors';
import {
  assessProject,
  parseProjectRecord,
  type ContentConfig,
  type FileKind,
  type ProjectHealth,
  type ProjectRecord,
  FILE_KINDS,
} from './model';

const DB_NAME = 'tattoo-ar';
/**
 * Versão do ESQUEMA do IndexedDB (stores e índices). Não confundir com
 * PROJECT_FORMAT_VERSION, que versiona o conteúdo dos registros.
 */
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_FILES = 'files';

export interface FilePayload {
  mimeType: string;
  data: ArrayBuffer;
}

/** Na gravação: undefined = não mexe; null = apaga; valor = grava. */
export type FileWrites = Partial<Record<FileKind, FilePayload | null>>;

export type ListEntry =
  | { kind: 'project'; record: ProjectRecord; health: ProjectHealth }
  | {
      kind: 'unreadable';
      id: string;
      code: 'unreadable' | 'newer-version';
      message: string;
      formatVersion?: number;
    };

export interface MetaPatch {
  name?: string;
  content?: ContentConfig;
  updatedAt: string;
}

export interface ProjectRepository {
  list(): Promise<ListEntry[]>;
  getEntry(id: string): Promise<ListEntry | null>;
  /** Grava o registro e os arquivos numa única transação (tudo ou nada). */
  save(record: ProjectRecord, files?: FileWrites): Promise<void>;
  updateMeta(id: string, patch: MetaPatch): Promise<ProjectRecord>;
  getFile(id: string, kind: FileKind): Promise<FilePayload | null>;
  delete(id: string): Promise<void>;
  close(): void;
}

interface FileRow {
  key: string;
  projectId: string;
  kind: FileKind;
  mimeType: string;
  data: ArrayBuffer;
}

const fileKey = (id: string, kind: FileKind): string => `${id}/${kind}`;

export interface OpenOptions {
  /** Injeção para testes (fake-indexeddb). Padrão: o indexedDB do navegador. */
  factory?: IDBFactory;
  name?: string;
}

export async function openRepository(options: OpenOptions = {}): Promise<ProjectRepository> {
  const factory = options.factory ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  if (!factory) {
    throw new StorageError('unavailable', 'Este navegador não oferece armazenamento local (IndexedDB).');
  }

  const db = await openDatabase(factory, options.name ?? DB_NAME);
  // Se outra aba pedir atualização do esquema, liberamos a conexão.
  db.onversionchange = () => db.close();

  const readFileKeys = async (): Promise<Set<string>> => {
    const tx = db.transaction(STORE_FILES, 'readonly');
    const keys = await requestToPromise(tx.objectStore(STORE_FILES).getAllKeys());
    return new Set(keys.map(String));
  };

  const toEntry = (raw: unknown, key: IDBValidKey | undefined, files: Set<string>): ListEntry => {
    const parsed = parseProjectRecord(raw);
    if (!parsed.ok) {
      const rawId =
        typeof raw === 'object' && raw !== null && 'id' in raw && typeof (raw as { id: unknown }).id === 'string'
          ? (raw as { id: string }).id
          : null;
      return {
        kind: 'unreadable',
        id: rawId ?? String(key),
        code: parsed.code,
        message: parsed.message,
        ...(parsed.formatVersion !== undefined ? { formatVersion: parsed.formatVersion } : {}),
      };
    }
    const { record } = parsed;
    const health = assessProject(record, {
      anchor: files.has(fileKey(record.id, 'anchor')),
      referenceImage: files.has(fileKey(record.id, 'referenceImage')),
    });
    return { kind: 'project', record, health };
  };

  return {
    async list() {
      try {
        const files = await readFileKeys();
        const tx = db.transaction(STORE_PROJECTS, 'readonly');
        const store = tx.objectStore(STORE_PROJECTS);
        const [rows, keys] = await Promise.all([
          requestToPromise(store.getAll()),
          requestToPromise(store.getAllKeys()),
        ]);
        const entries = rows.map((raw, index) => toEntry(raw, keys[index], files));
        return entries.sort(compareEntries);
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async getEntry(id) {
      try {
        const files = await readFileKeys();
        const tx = db.transaction(STORE_PROJECTS, 'readonly');
        const raw = await requestToPromise(tx.objectStore(STORE_PROJECTS).get(id));
        return raw === undefined ? null : toEntry(raw, id, files);
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async save(record, files = {}) {
      try {
        const tx = db.transaction([STORE_PROJECTS, STORE_FILES], 'readwrite');
        const done = transactionDone(tx);
        try {
          tx.objectStore(STORE_PROJECTS).put(record);
          const fileStore = tx.objectStore(STORE_FILES);
          for (const kind of FILE_KINDS) {
            const write = files[kind];
            if (write === undefined) continue;
            if (write === null) {
              fileStore.delete(fileKey(record.id, kind));
            } else {
              const row: FileRow = {
                key: fileKey(record.id, kind),
                projectId: record.id,
                kind,
                mimeType: write.mimeType,
                data: write.data,
              };
              fileStore.put(row);
            }
          }
        } catch (error) {
          // Um put() que lança (ex.: dado não clonável) NÃO aborta a transação
          // sozinho: sem este abort, o que já foi enfileirado seria gravado e o
          // projeto ficaria pela metade.
          try {
            tx.abort();
          } catch {
            /* a transação já pode ter terminado */
          }
          await done.catch(() => {});
          throw error;
        }
        await done;
      } catch (error) {
        throw toStorageError(error);
      }
    },

    updateMeta(id, patch) {
      return new Promise<ProjectRecord>((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_PROJECTS, 'readwrite');
          const store = tx.objectStore(STORE_PROJECTS);
          let updated: ProjectRecord | null = null;
          let failure: StorageError | null = null;

          const getRequest = store.get(id);
          getRequest.onsuccess = () => {
            if (getRequest.result === undefined) {
              failure = new StorageError('not-found', 'Projeto não encontrado.');
              tx.abort();
              return;
            }
            const parsed = parseProjectRecord(getRequest.result);
            if (!parsed.ok) {
              failure = new StorageError(parsed.code, parsed.message);
              tx.abort();
              return;
            }
            updated = {
              ...parsed.record,
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.content !== undefined ? { content: patch.content } : {}),
              updatedAt: patch.updatedAt,
            };
            store.put(updated);
          };

          tx.oncomplete = () => {
            if (updated) resolve(updated);
            else reject(new StorageError('unknown', 'A atualização não foi concluída.'));
          };
          tx.onabort = () => reject(failure ?? toStorageError(tx.error));
          tx.onerror = () => {
            /* o tratamento fica no onabort */
          };
        } catch (error) {
          reject(toStorageError(error));
        }
      });
    },

    async getFile(id, kind) {
      try {
        const tx = db.transaction(STORE_FILES, 'readonly');
        const row = (await requestToPromise(tx.objectStore(STORE_FILES).get(fileKey(id, kind)))) as
          | FileRow
          | undefined;
        return row ? { mimeType: row.mimeType, data: row.data } : null;
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async delete(id) {
      try {
        const tx = db.transaction([STORE_PROJECTS, STORE_FILES], 'readwrite');
        const done = transactionDone(tx);
        tx.objectStore(STORE_PROJECTS).delete(id);
        const fileStore = tx.objectStore(STORE_FILES);
        for (const kind of FILE_KINDS) fileStore.delete(fileKey(id, kind));
        await done;
      } catch (error) {
        throw toStorageError(error);
      }
    },

    close() {
      db.close();
    },
  };
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, DB_VERSION);
    } catch (error) {
      reject(toStorageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // Versão 1 do esquema. Mudanças futuras entram aqui, comparando event.oldVersion.
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toStorageError(request.error));
    request.onblocked = () =>
      reject(
        new StorageError(
          'unavailable',
          'O banco local está em uso por outra aba do app. Feche as outras abas e tente de novo.',
        ),
      );
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // Não rejeitamos em onerror: nesse momento tx.error ainda pode estar vazio.
    // Todo erro de requisição termina em abort, e é lá que o erro real
    // (por exemplo QuotaExceededError) está disponível.
    tx.onerror = () => {};
    tx.onabort = () => reject(tx.error ?? new DOMException('Transação cancelada.', 'AbortError'));
  });
}

/** Mais recentes primeiro; registros ilegíveis por último. */
function compareEntries(a: ListEntry, b: ListEntry): number {
  if (a.kind !== b.kind) return a.kind === 'project' ? -1 : 1;
  if (a.kind === 'project' && b.kind === 'project') {
    return Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt);
  }
  return 0;
}
