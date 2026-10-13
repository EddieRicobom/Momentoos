import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { StorageError } from '../src/storage/errors';
import { PROJECT_FORMAT_VERSION } from '../src/storage/model';
import { openRepository } from '../src/storage/repository';
import { fakeImage, freshRepository, makeMind, makeRecord, toBuffer } from './helpers';

const BIN = 'application/octet-stream';

describe('openRepository', () => {
  it('sem IndexedDB disponível, falha com mensagem clara', async () => {
    // O ambiente de teste (Node) não tem indexedDB global.
    await expect(openRepository()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('banco novo começa vazio', async () => {
    const repo = await freshRepository();
    expect(await repo.list()).toEqual([]);
    expect(await repo.getEntry('nada')).toBeNull();
  });
});

describe('save / list / getEntry', () => {
  it('grava registro e arquivos e devolve o projeto como pronto', async () => {
    const repo = await freshRepository();
    const anchor = makeMind();
    const image = fakeImage();
    const record = await makeRecord({ id: 'p1' }, { anchor, image });
    await repo.save(record, {
      anchor: { mimeType: BIN, data: toBuffer(anchor) },
      referenceImage: { mimeType: 'image/png', data: image },
    });

    const [entry] = await repo.list();
    expect(entry).toMatchObject({ kind: 'project', health: { status: 'ready' } });
    if (entry?.kind === 'project') expect(entry.record).toEqual(record);

    const file = await repo.getFile('p1', 'anchor');
    expect(file?.mimeType).toBe(BIN);
    expect(new Uint8Array(file!.data)).toEqual(anchor);
  });

  it('sobrevive a fechar e reabrir o banco (persistência, não só memória)', async () => {
    const factory = new IDBFactory();
    const first = await openRepository({ factory, name: 'reabrir' });
    const anchor = makeMind();
    await first.save(await makeRecord({ id: 'p1' }, { anchor }), {
      anchor: { mimeType: BIN, data: toBuffer(anchor) },
    });
    first.close();

    const second = await openRepository({ factory, name: 'reabrir' });
    const entry = await second.getEntry('p1');
    expect(entry).toMatchObject({ kind: 'project' });
    expect(new Uint8Array((await second.getFile('p1', 'anchor'))!.data)).toEqual(anchor);
  });

  it('lista do mais recente para o mais antigo', async () => {
    const repo = await freshRepository();
    await repo.save(await makeRecord({ id: 'velho', updatedAt: '2026-01-01T00:00:00.000Z' }));
    await repo.save(await makeRecord({ id: 'novo', updatedAt: '2026-10-01T00:00:00.000Z' }));
    await repo.save(await makeRecord({ id: 'meio', updatedAt: '2026-05-01T00:00:00.000Z' }));
    const ids = (await repo.list()).map((e) => (e.kind === 'project' ? e.record.id : e.id));
    expect(ids).toEqual(['novo', 'meio', 'velho']);
  });

  it('ordena por instante, não por texto, quando as datas têm fusos diferentes', async () => {
    const repo = await freshRepository();
    // 23:00-03:00 de 10/out = 02:00Z de 11/out, depois de 12:00Z de 10/out.
    await repo.save(await makeRecord({ id: 'texto-maior', updatedAt: '2026-10-10T12:00:00.000Z' }));
    await repo.save(await makeRecord({ id: 'instante-maior', updatedAt: '2026-10-10T23:00:00.000-03:00' }));
    const ids = (await repo.list()).map((e) => (e.kind === 'project' ? e.record.id : e.id));
    expect(ids).toEqual(['instante-maior', 'texto-maior']);
  });

  it('arquivos ausentes mudam a saúde: sem arquivo do alvo, precisa recompilar', async () => {
    const repo = await freshRepository();
    const image = fakeImage();
    // Registro diz que há alvo, mas só a imagem foi gravada.
    await repo.save(await makeRecord({ id: 'p1' }, { image }), {
      referenceImage: { mimeType: 'image/png', data: image },
    });
    const entry = await repo.getEntry('p1');
    expect(entry).toMatchObject({ kind: 'project', health: { status: 'needs-recompile' } });
  });

  it('sem nenhum arquivo, o projeto é incompleto', async () => {
    const repo = await freshRepository();
    await repo.save(await makeRecord({ id: 'p1' }));
    expect(await repo.getEntry('p1')).toMatchObject({ health: { status: 'broken' } });
  });

  it('semântica dos arquivos: undefined mantém, valor substitui, null apaga', async () => {
    const repo = await freshRepository();
    const record = await makeRecord({ id: 'p1' });
    const v1 = new Uint8Array([1, 1, 1]);
    const img = fakeImage(1);
    await repo.save(record, {
      anchor: { mimeType: BIN, data: toBuffer(v1) },
      referenceImage: { mimeType: 'image/png', data: img },
    });

    // undefined: não mexe em nada
    await repo.save({ ...record, name: 'outro' });
    expect(new Uint8Array((await repo.getFile('p1', 'anchor'))!.data)).toEqual(v1);

    // valor: substitui só o alvo
    const v2 = new Uint8Array([2, 2]);
    await repo.save(record, { anchor: { mimeType: BIN, data: toBuffer(v2) } });
    expect(new Uint8Array((await repo.getFile('p1', 'anchor'))!.data)).toEqual(v2);
    expect(await repo.getFile('p1', 'referenceImage')).not.toBeNull();

    // null: apaga só a imagem
    await repo.save(record, { referenceImage: null });
    expect(await repo.getFile('p1', 'referenceImage')).toBeNull();
    expect(await repo.getFile('p1', 'anchor')).not.toBeNull();
  });

  it('é tudo ou nada: dado impossível de gravar não deixa o projeto pela metade', async () => {
    const repo = await freshRepository();
    const record = await makeRecord({ id: 'meio' });
    const good = toBuffer(makeMind());
    const unclonable = (() => {}) as unknown as ArrayBuffer; // não passa pelo structured clone

    await expect(
      repo.save(record, {
        anchor: { mimeType: BIN, data: good },
        referenceImage: { mimeType: 'image/png', data: unclonable },
      }),
    ).rejects.toBeInstanceOf(StorageError);

    expect(await repo.getEntry('meio')).toBeNull();
    expect(await repo.getFile('meio', 'anchor')).toBeNull();
    expect(await repo.list()).toEqual([]);
  });

  it('uma gravação que falha não estraga um projeto já salvo', async () => {
    const repo = await freshRepository();
    const record = await makeRecord({ id: 'p1', name: 'Original' });
    const original = toBuffer(makeMind({ seed: 1 }));
    await repo.save(record, { anchor: { mimeType: BIN, data: original } });

    await repo
      .save(
        { ...record, name: 'Alterado' },
        { anchor: { mimeType: BIN, data: (() => {}) as unknown as ArrayBuffer } },
      )
      .catch(() => {});

    const entry = await repo.getEntry('p1');
    expect(entry).toMatchObject({ kind: 'project', record: { name: 'Original' } });
    expect(new Uint8Array((await repo.getFile('p1', 'anchor'))!.data)).toEqual(new Uint8Array(original));
  });
});

describe('updateMeta', () => {
  it('muda nome e data, preservando o restante', async () => {
    const repo = await freshRepository();
    const record = await makeRecord({ id: 'p1' });
    await repo.save(record);
    const updated = await repo.updateMeta('p1', { name: 'Novo nome', updatedAt: '2026-11-01T10:00:00.000Z' });
    expect(updated).toEqual({ ...record, name: 'Novo nome', updatedAt: '2026-11-01T10:00:00.000Z' });
    expect(await repo.getEntry('p1')).toMatchObject({ record: updated });
  });

  it('atualiza a cena', async () => {
    const repo = await freshRepository();
    await repo.save(await makeRecord({ id: 'p1' }));
    const scene = {
      items: [
        {
          id: 'i1',
          type: 'image' as const,
          name: 'Foto',
          visible: true,
          file: { mimeType: 'image/png', size: 4, sha256: 'b'.repeat(64), fileName: 'f.png' },
          transform: { scale: 2, rotation: [0, 0, 90] as [number, number, number], position: [0.1, 0, 0] as [number, number, number], offset: [0, 0, 0.05] as [number, number, number] },
          options: { opacity: 1, loop: true, muted: false, volume: 1, animate: false, clip: null },
        },
      ],
    };
    const updated = await repo.updateMeta('p1', { scene, updatedAt: '2026-11-01T10:00:00.000Z' });
    expect(updated.scene.items).toHaveLength(1);
    expect(updated.scene.items[0]?.transform.scale).toBe(2);
  });

  it('projeto inexistente: erro not-found', async () => {
    const repo = await freshRepository();
    await expect(repo.updateMeta('nao-existe', { name: 'x', updatedAt: '2026-01-01T00:00:00.000Z' })).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});

describe('delete', () => {
  it('remove o registro e os dois arquivos, e só os dele', async () => {
    const repo = await freshRepository();
    const anchor = toBuffer(makeMind());
    for (const id of ['a', 'b']) {
      await repo.save(await makeRecord({ id }), {
        anchor: { mimeType: BIN, data: anchor },
        referenceImage: { mimeType: 'image/png', data: fakeImage() },
      });
    }
    await repo.delete('a');
    expect(await repo.getEntry('a')).toBeNull();
    expect(await repo.getFile('a', 'anchor')).toBeNull();
    expect(await repo.getFile('a', 'referenceImage')).toBeNull();
    expect(await repo.getEntry('b')).not.toBeNull();
    expect(await repo.getFile('b', 'anchor')).not.toBeNull();
  });

  it('excluir algo que não existe não dá erro', async () => {
    const repo = await freshRepository();
    await expect(repo.delete('fantasma')).resolves.toBeUndefined();
  });
});

describe('arquivos de itens', () => {
  const item = (id: string) => ({
    id,
    type: 'image' as const,
    name: id,
    visible: true,
    file: { mimeType: 'image/png', size: 64, sha256: 'c'.repeat(64), fileName: `${id}.png` },
    transform: { scale: 1, rotation: [0, 0, 0] as [number, number, number], position: [0, 0, 0] as [number, number, number], offset: [0, 0, 0] as [number, number, number] },
    options: { opacity: 1, loop: true, muted: false, volume: 1, animate: false, clip: null },
  });

  it('grava, lê, substitui e apaga arquivos de item pela chave item:<id>', async () => {
    const repo = await freshRepository();
    const record = await makeRecord({ id: 'p1', scene: { items: [item('i1'), item('i2')] } });
    await repo.save(record, {
      'item:i1': { mimeType: 'image/png', data: fakeImage(1) },
      'item:i2': { mimeType: 'image/png', data: fakeImage(2) },
    });
    expect(new Uint8Array((await repo.getFile('p1', 'item:i1'))!.data)).toEqual(new Uint8Array(fakeImage(1)));
    await repo.save(record, { 'item:i1': { mimeType: 'image/png', data: fakeImage(9) } });
    expect(new Uint8Array((await repo.getFile('p1', 'item:i1'))!.data)).toEqual(new Uint8Array(fakeImage(9)));
    expect(new Uint8Array((await repo.getFile('p1', 'item:i2'))!.data)).toEqual(new Uint8Array(fakeImage(2)));
    await repo.save(record, { 'item:i2': null });
    expect(await repo.getFile('p1', 'item:i2')).toBeNull();
    expect(await repo.getFile('p1', 'item:i1')).not.toBeNull();
  });

  it('a lista informa quais itens estão sem arquivo, sem mudar a saúde do projeto', async () => {
    const repo = await freshRepository();
    const record = await makeRecord({ id: 'p1', scene: { items: [item('i1'), item('i2')] } });
    await repo.save(record, {
      anchor: { mimeType: BIN, data: toBuffer(makeMind()) },
      'item:i1': { mimeType: 'image/png', data: fakeImage(1) },
    });
    const entry = await repo.getEntry('p1');
    expect(entry).toMatchObject({ kind: 'project', missingItems: ['i2'], health: { status: 'ready' } });
    const [listed] = await repo.list();
    expect(listed).toMatchObject({ kind: 'project', missingItems: ['i2'] });
  });

  it('chave de arquivo inválida é recusada e a gravação inteira é desfeita', async () => {
    const repo = await freshRepository();
    const record = await makeRecord({ id: 'p1' });
    await expect(
      repo.save(record, {
        anchor: { mimeType: BIN, data: toBuffer(makeMind()) },
        ['../p2/anchor' as never]: { mimeType: BIN, data: toBuffer(makeMind()) },
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(await repo.getEntry('p1')).toBeNull();
    expect(await repo.getFile('p1', 'anchor')).toBeNull();
  });

  it('excluir apaga os arquivos dos itens e não toca em projetos de id com o mesmo começo', async () => {
    const repo = await freshRepository();
    for (const id of ['a', 'ab']) {
      await repo.save(await makeRecord({ id, scene: { items: [item('i1')] } }), {
        anchor: { mimeType: BIN, data: toBuffer(makeMind()) },
        'item:i1': { mimeType: 'image/png', data: fakeImage(1) },
      });
    }
    await repo.delete('a');
    expect(await repo.getFile('a', 'item:i1')).toBeNull();
    expect(await repo.getFile('ab', 'item:i1')).not.toBeNull();
    expect(await repo.getFile('ab', 'anchor')).not.toBeNull();
    expect(await repo.getEntry('ab')).not.toBeNull();
  });
});

describe('registros ilegíveis no banco', () => {
  /** Grava um valor cru no store, contornando o repositório, como faria um banco corrompido. */
  async function plantRaw(factory: IDBFactory, name: string, raw: unknown): Promise<void> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite');
      tx.objectStore('projects').put(raw);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }

  it('registro corrompido aparece como ilegível, sem derrubar a lista', async () => {
    const factory = new IDBFactory();
    const seed = await openRepository({ factory, name: 'corrompido' });
    await seed.save(await makeRecord({ id: 'bom' }));
    seed.close();
    await plantRaw(factory, 'corrompido', { id: 'ruim', formatVersion: 1, name: 5 });

    const repo = await openRepository({ factory, name: 'corrompido' });
    const entries = await repo.list();
    expect(entries.map((e) => e.kind)).toEqual(['project', 'unreadable']);
    expect(entries[1]).toMatchObject({ kind: 'unreadable', id: 'ruim', code: 'unreadable' });
  });

  it('registro de versão mais nova é preservado e identificado como tal', async () => {
    const factory = new IDBFactory();
    const seed = await openRepository({ factory, name: 'futuro' });
    seed.close();
    const future = { ...(await makeRecord({ id: 'futuro1' })), formatVersion: PROJECT_FORMAT_VERSION + 3 };
    await plantRaw(factory, 'futuro', future);

    const repo = await openRepository({ factory, name: 'futuro' });
    const [entry] = await repo.list();
    expect(entry).toMatchObject({
      kind: 'unreadable',
      id: 'futuro1',
      code: 'newer-version',
      formatVersion: PROJECT_FORMAT_VERSION + 3,
    });
    // Não foi apagado nem alterado.
    expect(await repo.getEntry('futuro1')).toMatchObject({ code: 'newer-version' });
  });

  it('updateMeta se recusa a reescrever um registro que não entende', async () => {
    const factory = new IDBFactory();
    const seed = await openRepository({ factory, name: 'protegido' });
    seed.close();
    await plantRaw(factory, 'protegido', {
      ...(await makeRecord({ id: 'f1' })),
      formatVersion: PROJECT_FORMAT_VERSION + 1,
    });
    const repo = await openRepository({ factory, name: 'protegido' });
    await expect(
      repo.updateMeta('f1', { name: 'x', updatedAt: '2026-01-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'newer-version' });
  });
});
