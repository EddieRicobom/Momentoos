import { encode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { MIND_FORMAT_VERSION, readMindHeader } from '../src/tracking/mindFormat';
import { makeMind } from './helpers';

describe('readMindHeader', () => {
  it('lê versão, quantidade de alvos e dimensões de um .mind válido', () => {
    const result = readMindHeader(makeMind({ width: 800, height: 600 }));
    expect(result).toEqual({
      ok: true,
      header: { version: MIND_FORMAT_VERSION, targetCount: 1, width: 800, height: 600 },
    });
  });

  it('aceita ArrayBuffer além de Uint8Array', () => {
    const bytes = makeMind();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(readMindHeader(buffer as ArrayBuffer).ok).toBe(true);
  });

  it('recusa versão de formato diferente e informa qual era', () => {
    const result = readMindHeader(makeMind({ version: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('wrong-version');
      expect(result.version).toBe(1);
      expect(result.message).toContain('incompatível');
    }
  });

  it('recusa bytes que não são MessagePack', () => {
    const result = readMindHeader(new Uint8Array([0xc1, 0xc1, 0xc1, 0xc1]));
    expect(result).toMatchObject({ ok: false, code: 'unreadable' });
  });

  it('recusa arquivo vazio e valores que não são objeto', () => {
    expect(readMindHeader(new Uint8Array(0))).toMatchObject({ ok: false, code: 'unreadable' });
    expect(readMindHeader(encode(5))).toMatchObject({ ok: false, code: 'unreadable' });
    expect(readMindHeader(encode(null))).toMatchObject({ ok: false, code: 'unreadable' });
  });

  it('recusa arquivo sem campo de versão', () => {
    expect(readMindHeader(encode({ dataList: [] }))).toMatchObject({ ok: false, code: 'unreadable' });
  });

  it('recusa arquivo sem nenhum alvo', () => {
    expect(readMindHeader(encode({ v: 2, dataList: [] }))).toMatchObject({ ok: false, code: 'empty' });
    expect(readMindHeader(encode({ v: 2 }))).toMatchObject({ ok: false, code: 'empty' });
  });

  it.each([
    [{ width: 0, height: 100 }],
    [{ width: 100, height: -5 }],
    [{ width: 'x', height: 100 }],
    [{}],
  ])('recusa dimensões inválidas %j', (targetImage) => {
    const buffer = encode({ v: 2, dataList: [{ targetImage }] });
    expect(readMindHeader(buffer)).toMatchObject({ ok: false, code: 'unreadable' });
  });
});
