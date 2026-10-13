import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/storage/hash';
import { PROJECT_FORMAT_VERSION } from '../src/storage/model';
import {
  createProject,
  openProjectAnchor,
  renameProject,
  replaceAnchor,
} from '../src/storage/projects';
import { fakeImage, freshRepository, makeMind, makeRecord, toBuffer } from './helpers';

const BIN = 'application/octet-stream';
const IMAGE = { data: fakeImage(), mimeType: 'image/png', width: 640, height: 480 };

describe('createProject', () => {
  it('cria o projeto completo e o deixa pronto para abrir', async () => {
    const repo = await freshRepository();
    const anchor = makeMind({ width: 800, height: 600 });
    const now = new Date('2026-10-13T18:00:00.000Z');

    const record = await createProject(repo, { name: '  Braço   direito ', anchor, referenceImage: IMAGE, now });

    expect(record.name).toBe('Braço direito');
    expect(record.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(record.createdAt).toBe('2026-10-13T18:00:00.000Z');
    expect(record.updatedAt).toBe(record.createdAt);
    expect(record.id).toMatch(/^[0-9a-f]{32}$/);
    expect(record.content.type).toBe('none');
    // Dimensões vêm do próprio .mind, não do que o chamador disse.
    expect(record.anchor).toMatchObject({ width: 800, height: 600, mindFormat: 2, size: anchor.byteLength });
    expect(record.anchor?.sha256).toBe(await sha256Hex(anchor));
    expect(record.referenceImage?.sha256).toBe(await sha256Hex(IMAGE.data));

    expect(await repo.getEntry(record.id)).toMatchObject({ kind: 'project', health: { status: 'ready' } });
  });

  it('gera ids diferentes a cada projeto', async () => {
    const repo = await freshRepository();
    const a = await createProject(repo, { name: 'A', anchor: makeMind() });
    const b = await createProject(repo, { name: 'B', anchor: makeMind() });
    expect(a.id).not.toBe(b.id);
  });

  it('aceita projeto vindo de .mind solto (sem imagem de referência)', async () => {
    const repo = await freshRepository();
    const record = await createProject(repo, { name: 'Sem foto', anchor: makeMind() });
    expect(record.referenceImage).toBeNull();
    expect(await repo.getFile(record.id, 'referenceImage')).toBeNull();
    expect(await repo.getEntry(record.id)).toMatchObject({ health: { status: 'ready' } });
  });

  it('recusa nome vazio', async () => {
    const repo = await freshRepository();
    await expect(createProject(repo, { name: '   ', anchor: makeMind() })).rejects.toMatchObject({
      code: 'invalid-input',
    });
    expect(await repo.list()).toEqual([]);
  });

  it('recusa alvo de outra versão do formato e não grava nada', async () => {
    const repo = await freshRepository();
    await expect(createProject(repo, { name: 'X', anchor: makeMind({ version: 1 }) })).rejects.toMatchObject({
      code: 'incompatible',
    });
    await expect(createProject(repo, { name: 'X', anchor: new Uint8Array([1, 2, 3]) })).rejects.toMatchObject({
      code: 'incompatible',
    });
    expect(await repo.list()).toEqual([]);
  });
});

describe('openProjectAnchor (reutilizar sem recompilar)', () => {
  it('devolve exatamente os bytes salvos', async () => {
    const repo = await freshRepository();
    const anchor = makeMind({ filler: 5000 });
    const { id } = await createProject(repo, { name: 'A', anchor, referenceImage: IMAGE });

    const opened = await openProjectAnchor(repo, id);
    expect(opened.buffer).toEqual(anchor);
    expect(opened.record.id).toBe(id);
  });

  it('funciona depois de fechar e reabrir o banco', async () => {
    const { IDBFactory } = await import('fake-indexeddb');
    const { openRepository } = await import('../src/storage/repository');
    const factory = new IDBFactory();
    const first = await openRepository({ factory, name: 'sessao' });
    const anchor = makeMind({ filler: 2000 });
    const { id } = await createProject(first, { name: 'A', anchor });
    first.close();

    const second = await openRepository({ factory, name: 'sessao' });
    expect((await openProjectAnchor(second, id)).buffer).toEqual(anchor);
  });

  it('detecta bytes adulterados com o mesmo tamanho (hash diferente)', async () => {
    const repo = await freshRepository();
    const anchor = makeMind({ filler: 100, seed: 1 });
    const record = await createProject(repo, { name: 'A', anchor });

    const tampered = makeMind({ filler: 100, seed: 2 });
    expect(tampered.byteLength).toBe(anchor.byteLength);
    await repo.save(record, { anchor: { mimeType: BIN, data: toBuffer(tampered) } });

    await expect(openProjectAnchor(repo, record.id)).rejects.toMatchObject({
      code: 'integrity',
      message: expect.stringMatching(/corrompido/),
    });
  });

  it('detecta arquivo truncado (tamanho diferente)', async () => {
    const repo = await freshRepository();
    const anchor = makeMind({ filler: 500 });
    const record = await createProject(repo, { name: 'A', anchor });
    await repo.save(record, { anchor: { mimeType: BIN, data: toBuffer(anchor.slice(0, 100)) } });

    await expect(openProjectAnchor(repo, record.id)).rejects.toMatchObject({
      code: 'integrity',
      message: expect.stringMatching(/incompleto/),
    });
  });

  it('arquivo do alvo ausente: not-found', async () => {
    const repo = await freshRepository();
    const record = await createProject(repo, { name: 'A', anchor: makeMind() });
    await repo.save(record, { anchor: null });
    await expect(openProjectAnchor(repo, record.id)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('projeto sem alvo: not-found', async () => {
    const repo = await freshRepository();
    await repo.save(await makeRecord({ id: 'p1', anchor: null }));
    await expect(openProjectAnchor(repo, 'p1')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('formato de alvo antigo: incompatible, e o projeto continua recompilável', async () => {
    const repo = await freshRepository();
    const old = makeMind({ version: 1 });
    const image = fakeImage();
    const record = await makeRecord({ id: 'p1' }, { anchor: old, image });
    await repo.save({ ...record, anchor: { ...record.anchor!, mindFormat: 1 } }, {
      anchor: { mimeType: BIN, data: toBuffer(old) },
      referenceImage: { mimeType: 'image/png', data: image },
    });

    await expect(openProjectAnchor(repo, 'p1')).rejects.toMatchObject({ code: 'incompatible' });
    expect(await repo.getEntry('p1')).toMatchObject({ health: { status: 'needs-recompile' } });
  });

  it('o registro diz formato certo mas os bytes são de outro: incompatible', async () => {
    const repo = await freshRepository();
    const wrong = makeMind({ version: 1, filler: 10 });
    const record = await makeRecord({ id: 'p1' }, { anchor: wrong });
    await repo.save(record, { anchor: { mimeType: BIN, data: toBuffer(wrong) } });
    await expect(openProjectAnchor(repo, 'p1')).rejects.toMatchObject({ code: 'incompatible' });
  });

  it('projeto inexistente: not-found', async () => {
    const repo = await freshRepository();
    await expect(openProjectAnchor(repo, 'fantasma')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('replaceAnchor (recompilar)', () => {
  it('troca o alvo e a data de modificação, preservando nome, criação e conteúdo', async () => {
    const repo = await freshRepository();
    const created = new Date('2026-10-01T10:00:00.000Z');
    const record = await createProject(repo, {
      name: 'A',
      anchor: makeMind({ width: 640, height: 480 }),
      referenceImage: IMAGE,
      now: created,
    });

    const novo = makeMind({ width: 1024, height: 768, filler: 300 });
    const later = new Date('2026-10-13T10:00:00.000Z');
    const updated = await replaceAnchor(repo, record.id, novo, later);

    expect(updated.name).toBe('A');
    expect(updated.createdAt).toBe('2026-10-01T10:00:00.000Z');
    expect(updated.updatedAt).toBe('2026-10-13T10:00:00.000Z');
    expect(updated.anchor).toMatchObject({ width: 1024, height: 768, compiledAt: '2026-10-13T10:00:00.000Z' });
    expect(updated.anchor?.sha256).toBe(await sha256Hex(novo));
    expect((await openProjectAnchor(repo, record.id)).buffer).toEqual(novo);
    expect(await repo.getFile(record.id, 'referenceImage')).not.toBeNull();
  });

  it('recupera um projeto que precisava recompilar', async () => {
    const repo = await freshRepository();
    const old = makeMind({ version: 1 });
    const image = fakeImage();
    const base = await makeRecord({ id: 'p1' }, { anchor: old, image });
    await repo.save({ ...base, anchor: { ...base.anchor!, mindFormat: 1 } }, {
      anchor: { mimeType: BIN, data: toBuffer(old) },
      referenceImage: { mimeType: 'image/png', data: image },
    });
    expect(await repo.getEntry('p1')).toMatchObject({ health: { status: 'needs-recompile' } });

    await replaceAnchor(repo, 'p1', makeMind());
    expect(await repo.getEntry('p1')).toMatchObject({ health: { status: 'ready' } });
  });

  it('recusa alvo incompatível sem tocar no que já estava salvo', async () => {
    const repo = await freshRepository();
    const anchor = makeMind({ filler: 50 });
    const { id } = await createProject(repo, { name: 'A', anchor });
    await expect(replaceAnchor(repo, id, makeMind({ version: 9 }))).rejects.toMatchObject({ code: 'incompatible' });
    expect((await openProjectAnchor(repo, id)).buffer).toEqual(anchor);
  });

  it('projeto inexistente: not-found', async () => {
    const repo = await freshRepository();
    await expect(replaceAnchor(repo, 'fantasma', makeMind())).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('renameProject', () => {
  it('renomeia normalizando o nome e atualiza a data', async () => {
    const repo = await freshRepository();
    const { id } = await createProject(repo, { name: 'A', anchor: makeMind(), now: new Date('2026-01-01T00:00:00Z') });
    const renamed = await renameProject(repo, id, '  Costela   esquerda ', new Date('2026-02-02T00:00:00Z'));
    expect(renamed.name).toBe('Costela esquerda');
    expect(renamed.updatedAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('recusa nome vazio e mantém o anterior', async () => {
    const repo = await freshRepository();
    const { id } = await createProject(repo, { name: 'Original', anchor: makeMind() });
    await expect(renameProject(repo, id, '   ')).rejects.toMatchObject({ code: 'invalid-input' });
    expect(await repo.getEntry(id)).toMatchObject({ record: { name: 'Original' } });
  });
});
