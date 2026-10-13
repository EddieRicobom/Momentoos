import { StorageError } from './errors';

/** SHA-256 em hexadecimal minúsculo (64 caracteres). */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new StorageError(
      'insecure-context',
      'Salvar e conferir projetos exige HTTPS ou localhost (o navegador só libera a criptografia nesses contextos).',
    );
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Identificador único de 128 bits em hexadecimal (32 caracteres).
 * Usa getRandomValues, que funciona também fora de contexto seguro.
 */
export function newId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
