export type StorageErrorCode =
  | 'unavailable' // IndexedDB inexistente ou bloqueado (ex.: modo privado)
  | 'insecure-context' // sem crypto.subtle: precisa de HTTPS ou localhost
  | 'quota' // sem espaço
  | 'not-found'
  | 'unreadable' // registro corrompido ou fora do formato
  | 'newer-version' // gravado por uma versão mais nova do app
  | 'integrity' // bytes não conferem com o hash/tamanho registrado
  | 'incompatible' // alvo .mind de outra versão do formato
  | 'invalid-input'
  | 'unknown';

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}

/** Converte erros do IndexedDB (DOMException) em StorageError com mensagem em português. */
export function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'QuotaExceededError':
      return new StorageError(
        'quota',
        'Sem espaço de armazenamento no navegador. Libere espaço ou exclua projetos que não usa mais.',
        { cause: error },
      );
    case 'SecurityError':
    case 'InvalidStateError':
      return new StorageError(
        'unavailable',
        'O navegador bloqueou o armazenamento local. Isso acontece em abas privadas ou quando os dados do site estão desativados.',
        { cause: error },
      );
    default:
      return new StorageError(
        'unknown',
        `Falha no armazenamento local${name ? ` (${name})` : ''}.`,
        { cause: error },
      );
  }
}
