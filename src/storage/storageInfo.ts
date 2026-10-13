/**
 * Uso do armazenamento do navegador e pedido de armazenamento "persistente".
 *
 * Honestidade sobre o que a API garante:
 *  - estimate() devolve valores aproximados, decididos pelo navegador.
 *  - persist() é um PEDIDO. O navegador pode negar sem explicar (Chrome decide por
 *    heurística de engajamento, Safari/Firefox têm regras próprias). Mesmo
 *    concedido, o usuário ainda pode limpar os dados do site manualmente.
 *  Por isso a interface nunca promete que os projetos estão "seguros": o backup
 *  em ZIP é a proteção real.
 */

export interface StorageNavigator {
  storage?: {
    estimate?: () => Promise<{ usage?: number; quota?: number }>;
    persisted?: () => Promise<boolean>;
    persist?: () => Promise<boolean>;
  };
}

export interface StorageInfo {
  /** Bytes usados por este site (aproximado), ou null se o navegador não informa. */
  usage: number | null;
  quota: number | null;
  /** true/false se o navegador informa; null se não há essa API. */
  persisted: boolean | null;
  canRequestPersistence: boolean;
}

export async function getStorageInfo(nav: StorageNavigator = navigator): Promise<StorageInfo> {
  const storage = nav.storage;
  let usage: number | null = null;
  let quota: number | null = null;
  let persisted: boolean | null = null;

  try {
    const estimate = await storage?.estimate?.();
    if (estimate) {
      usage = typeof estimate.usage === 'number' && Number.isFinite(estimate.usage) ? estimate.usage : null;
      quota = typeof estimate.quota === 'number' && Number.isFinite(estimate.quota) ? estimate.quota : null;
    }
  } catch {
    /* sem estimativa: segue com null */
  }
  try {
    const value = await storage?.persisted?.();
    persisted = typeof value === 'boolean' ? value : null;
  } catch {
    /* idem */
  }

  return { usage, quota, persisted, canRequestPersistence: typeof storage?.persist === 'function' };
}

export type PersistenceResult =
  | { status: 'granted' }
  | { status: 'denied' }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

export async function requestPersistence(nav: StorageNavigator = navigator): Promise<PersistenceResult> {
  const storage = nav.storage;
  if (!storage || typeof storage.persist !== 'function') return { status: 'unsupported' };
  try {
    const granted = await storage.persist();
    return granted ? { status: 'granted' } : { status: 'denied' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Falha desconhecida.' };
  }
}
