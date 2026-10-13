import { describe, expect, it } from 'vitest';
import { getStorageInfo, requestPersistence, type StorageNavigator } from '../src/storage/storageInfo';

describe('getStorageInfo', () => {
  it('lê uso, cota e persistência quando o navegador informa', async () => {
    const nav: StorageNavigator = {
      storage: {
        estimate: async () => ({ usage: 1_500_000, quota: 2_000_000_000 }),
        persisted: async () => true,
        persist: async () => true,
      },
    };
    expect(await getStorageInfo(nav)).toEqual({
      usage: 1_500_000,
      quota: 2_000_000_000,
      persisted: true,
      canRequestPersistence: true,
    });
  });

  it('sem a API de armazenamento, devolve tudo como desconhecido (sem inventar valores)', async () => {
    expect(await getStorageInfo({})).toEqual({
      usage: null,
      quota: null,
      persisted: null,
      canRequestPersistence: false,
    });
  });

  it('ignora valores inválidos e erros da API', async () => {
    const nav: StorageNavigator = {
      storage: {
        estimate: async () => ({ usage: Number.NaN, quota: undefined }),
        persisted: async () => {
          throw new Error('boom');
        },
      },
    };
    expect(await getStorageInfo(nav)).toEqual({
      usage: null,
      quota: null,
      persisted: null,
      canRequestPersistence: false,
    });
  });

  it('estimate que rejeita não derruba a leitura do restante', async () => {
    const nav: StorageNavigator = {
      storage: {
        estimate: async () => {
          throw new Error('indisponível');
        },
        persisted: async () => false,
      },
    };
    expect(await getStorageInfo(nav)).toMatchObject({ usage: null, quota: null, persisted: false });
  });
});

describe('requestPersistence', () => {
  it('concedido', async () => {
    expect(await requestPersistence({ storage: { persist: async () => true } })).toEqual({ status: 'granted' });
  });

  it('negado pelo navegador é um resultado normal, não um erro', async () => {
    expect(await requestPersistence({ storage: { persist: async () => false } })).toEqual({ status: 'denied' });
  });

  it('API ausente', async () => {
    expect(await requestPersistence({})).toEqual({ status: 'unsupported' });
    expect(await requestPersistence({ storage: {} })).toEqual({ status: 'unsupported' });
  });

  it('exceção vira status de erro com a mensagem', async () => {
    const result = await requestPersistence({
      storage: {
        persist: async () => {
          throw new Error('SecurityError');
        },
      },
    });
    expect(result).toEqual({ status: 'error', message: 'SecurityError' });
  });

  it('chama persist() com o this correto (a API real exige)', async () => {
    let receivedThis: unknown = null;
    const storage = {
      persist(this: unknown) {
        receivedThis = this;
        return Promise.resolve(true);
      },
    };
    await requestPersistence({ storage });
    expect(receivedThis).toBe(storage);
  });
});
