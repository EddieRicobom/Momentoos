import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/storage/hash';
import { MAX_ITEMS_PER_PROJECT, MAX_ITEM_FILE_BYTES, itemFileKind } from '../src/storage/model';
import { createProject } from '../src/storage/projects';
import type { ProjectRepository } from '../src/storage/repository';
import { addItem, duplicateItem, openItemFile, removeItem, updateItem, updateItems } from '../src/storage/scene';
import { freshRepository, makeMind, signedBytes } from './helpers';

const NOW = new Date('2026-10-14T09:00:00.000Z');

async function setup(): Promise<{ repo: ProjectRepository; id: string }> {
  const repo = await freshRepository();
  const record = await createProject(repo, { name: 'Braço', anchor: makeMind(), now: new Date('2026-10-13T09:00:00.000Z') });
  return { repo, id: record.id };
}

const png = (name = 'foto.png', seed = 1) => ({ data: signedBytes('image/png', 80, seed), fileName: name });

describe('addItem', () => {
  it('guarda o arquivo, o descritor com hash e as configurações padrão do tipo', async () => {
    const { repo, id } = await setup();
    const data = signedBytes('image/png', 80);
    const { record, item } = await addItem(repo, id, {
      file: { data, fileName: 'borboleta.png', width: 300, height: 200 },
      now: NOW,
    });

    expect(record.scene.items).toEqual([item]);
    expect(record.updatedAt).toBe(NOW.toISOString());
    expect(item).toMatchObject({
      type: 'image',
      name: 'borboleta',
      visible: true,
      file: { mimeType: 'image/png', size: 80, sha256: await sha256Hex(data), fileName: 'borboleta.png', width: 300, height: 200 },
      transform: { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] },
    });
    expect(item.id).toMatch(/^[0-9a-f]{16}$/);

    const stored = await repo.getFile(id, itemFileKind(item.id));
    expect(new Uint8Array(stored!.data)).toEqual(new Uint8Array(data));
    expect(stored!.mimeType).toBe('image/png');
    const entry = await repo.getEntry(id);
    expect(entry).toMatchObject({ kind: 'project', record: { scene: { items: [{ id: item.id }] } } });
  });

  it('aceita os cinco tipos e usa opções padrão diferentes por tipo', async () => {
    const { repo, id } = await setup();
    const types = [
      ['a.png', 'image/png', 'image'],
      ['b.gif', 'image/gif', 'gif'],
      ['c.mp4', 'video/mp4', 'video'],
      ['d.glb', 'model/gltf-binary', 'model'],
      ['e.mp3', 'audio/mpeg', 'audio'],
    ] as const;
    for (const [fileName, mime, type] of types) {
      const { item } = await addItem(repo, id, { file: { data: signedBytes(mime), fileName } });
      expect(item.type).toBe(type);
    }
    const entry = await repo.getEntry(id);
    if (entry?.kind !== 'project') throw new Error('esperado projeto');
    const [, , video, model] = entry.record.scene.items;
    expect(video!.options.muted).toBe(true);
    expect(model!.options.animate).toBe(true);
    expect(entry.missingItems).toEqual([]);
  });

  it('transform e opções informadas valem sobre o padrão (parcial)', async () => {
    const { repo, id } = await setup();
    const { item } = await addItem(repo, id, {
      ...{ file: png() },
      name: '  Nome  ',
      transform: { scale: 2.5, position: [0.1, -0.2, 0] },
      options: { opacity: 0.4 },
    });
    expect(item.name).toBe('Nome');
    expect(item.transform).toEqual({ scale: 2.5, rotation: [0, 0, 0], position: [0.1, -0.2, 0], offset: [0, 0, 0] });
    expect(item.options.opacity).toBe(0.4);
    expect(item.options.loop).toBe(true);
  });

  it('o mesmo arquivo pode entrar várias vezes (cada item tem o seu id e o seu arquivo)', async () => {
    const { repo, id } = await setup();
    const a = await addItem(repo, id, { file: png() });
    const b = await addItem(repo, id, { file: png() });
    expect(a.item.id).not.toBe(b.item.id);
    expect(b.record.scene.items).toHaveLength(2);
    expect(await repo.getFile(id, itemFileKind(a.item.id))).not.toBeNull();
    expect(await repo.getFile(id, itemFileKind(b.item.id))).not.toBeNull();
  });

  it.each([
    ['formato não suportado', { data: signedBytes('image/png'), fileName: 'x.mov' }, /mov/],
    ['extensão desconhecida', { data: signedBytes('image/png'), fileName: 'x.abc' }, /não suportado/i],
    ['arquivo vazio', { data: new ArrayBuffer(0), fileName: 'x.png' }, /vazio/],
    ['extensão trocada (PNG chamado .glb)', { data: signedBytes('image/png'), fileName: 'x.glb' }, /não corresponde/],
    ['nome vazio', { data: signedBytes('image/png'), fileName: '' }, /Nome de arquivo/],
    ['nome longo demais', { data: signedBytes('image/png'), fileName: `${'a'.repeat(250)}.png` }, /Nome de arquivo/],
  ])('recusa: %s — e não grava nada', async (_label, file, message) => {
    const { repo, id } = await setup();
    await expect(addItem(repo, id, { file })).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(message) });
    const entry = await repo.getEntry(id);
    expect(entry).toMatchObject({ kind: 'project', record: { scene: { items: [] } } });
  });

  it('recusa arquivo acima do limite por item', async () => {
    const { repo, id } = await setup();
    const big = signedBytes('image/png', MAX_ITEM_FILE_BYTES + 1);
    await expect(addItem(repo, id, { file: { data: big, fileName: 'g.png' } })).rejects.toMatchObject({
      code: 'invalid-input',
      message: expect.stringMatching(/grande demais/),
    });
  });

  it('para no limite de itens por projeto', async () => {
    const { repo, id } = await setup();
    // Preenche a cena direto no registro (100 chamadas a addItem seriam lentas sem ganho).
    const first = await addItem(repo, id, { file: png() });
    const entry = await repo.getEntry(id);
    if (entry?.kind !== 'project') throw new Error('esperado projeto');
    const items = Array.from({ length: MAX_ITEMS_PER_PROJECT }, (_, i) => ({ ...first.item, id: `item${i}` }));
    await repo.updateMeta(id, { scene: { items }, updatedAt: NOW.toISOString() });
    await expect(addItem(repo, id, { file: png('mais.png') })).rejects.toMatchObject({
      code: 'invalid-input',
      message: expect.stringMatching(/máximo de 100/),
    });
  });

  it('projeto inexistente: not-found', async () => {
    const repo = await freshRepository();
    await expect(addItem(repo, 'naoexiste', { file: png() })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('transformação inválida é recusada e o arquivo não fica órfão', async () => {
    const { repo, id } = await setup();
    await expect(addItem(repo, id, { file: png(), transform: { scale: 0 } })).rejects.toMatchObject({ code: 'invalid-input' });
    const entry = await repo.getEntry(id);
    expect(entry).toMatchObject({ kind: 'project', record: { scene: { items: [] } } });
  });

  it('com id repetido a cena inteira é recusada (nada é gravado)', async () => {
    const { repo, id } = await setup();
    await addItem(repo, id, { file: png(), id: 'fixo' });
    await expect(addItem(repo, id, { file: png('b.png', 2), id: 'fixo' })).rejects.toMatchObject({ code: 'invalid-input' });
    const entry = await repo.getEntry(id);
    if (entry?.kind !== 'project') throw new Error('esperado projeto');
    expect(entry.record.scene.items).toHaveLength(1);
    // O arquivo original do item "fixo" continua intacto.
    const opened = await openItemFile(repo, id, 'fixo');
    expect(new Uint8Array(opened.data)).toEqual(new Uint8Array(signedBytes('image/png', 80, 1)));
  });
});

describe('updateItem / updateItems', () => {
  it('mescla ajustes parciais sem mexer no resto', async () => {
    const { repo, id } = await setup();
    const { item } = await addItem(repo, id, { file: png() });
    const record = await updateItem(
      repo,
      id,
      item.id,
      { name: ' Novo ', visible: false, transform: { scale: 3 }, options: { opacity: 0.5 } },
      NOW,
    );
    const updated = record.scene.items[0]!;
    expect(updated).toMatchObject({ name: 'Novo', visible: false });
    expect(updated.transform).toEqual({ ...item.transform, scale: 3 });
    expect(updated.options).toEqual({ ...item.options, opacity: 0.5 });
    expect(updated.file).toEqual(item.file);
    expect(record.updatedAt).toBe(NOW.toISOString());
  });

  it('atualiza vários itens numa gravação só e preserva a ordem', async () => {
    const { repo, id } = await setup();
    const a = await addItem(repo, id, { file: png('a.png') });
    const b = await addItem(repo, id, { file: png('b.png', 2) });
    const c = await addItem(repo, id, { file: png('c.png', 3) });
    const record = await updateItems(
      repo,
      id,
      new Map([
        [a.item.id, { transform: { position: [0.3, 0, 0] as [number, number, number] } }],
        [c.item.id, { visible: false }],
      ]),
      NOW,
    );
    expect(record.scene.items.map((i) => i.id)).toEqual([a.item.id, b.item.id, c.item.id]);
    expect(record.scene.items[0]!.transform.position).toEqual([0.3, 0, 0]);
    expect(record.scene.items[1]).toEqual(b.item);
    expect(record.scene.items[2]!.visible).toBe(false);
  });

  it('item inexistente: não grava nenhum dos outros ajustes', async () => {
    const { repo, id } = await setup();
    const a = await addItem(repo, id, { file: png() });
    await expect(
      updateItems(repo, id, new Map([[a.item.id, { visible: false }], ['fantasma', { visible: false }]])),
    ).rejects.toMatchObject({ code: 'not-found' });
    const entry = await repo.getEntry(id);
    if (entry?.kind !== 'project') throw new Error('esperado projeto');
    expect(entry.record.scene.items[0]!.visible).toBe(true);
  });

  it.each([
    ['nome vazio', { name: '   ' }],
    ['opacidade fora da faixa', { options: { opacity: 5 } }],
    ['escala negativa', { transform: { scale: -1 } }],
    ['posição com NaN', { transform: { position: [Number.NaN, 0, 0] as [number, number, number] } }],
  ])('recusa ajuste inválido (%s) e mantém o que estava', async (_label, patch) => {
    const { repo, id } = await setup();
    const { item } = await addItem(repo, id, { file: png() });
    await expect(updateItem(repo, id, item.id, patch)).rejects.toMatchObject({ code: 'invalid-input' });
    const entry = await repo.getEntry(id);
    if (entry?.kind !== 'project') throw new Error('esperado projeto');
    expect(entry.record.scene.items[0]).toEqual(item);
  });
});

describe('removeItem', () => {
  it('tira o item da cena E apaga o arquivo; os outros ficam', async () => {
    const { repo, id } = await setup();
    const a = await addItem(repo, id, { file: png('a.png') });
    const b = await addItem(repo, id, { file: png('b.png', 2) });
    const record = await removeItem(repo, id, a.item.id, NOW);
    expect(record.scene.items.map((i) => i.id)).toEqual([b.item.id]);
    expect(await repo.getFile(id, itemFileKind(a.item.id))).toBeNull();
    expect(await repo.getFile(id, itemFileKind(b.item.id))).not.toBeNull();
  });

  it('item inexistente: not-found', async () => {
    const { repo, id } = await setup();
    await expect(removeItem(repo, id, 'fantasma')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('duplicateItem', () => {
  it('cria cópia independente (outro id e outro arquivo), com nome e posição deslocados', async () => {
    const { repo, id } = await setup();
    const { item } = await addItem(repo, id, {
      file: png(),
      name: 'Rosa',
      transform: { position: [0.2, 0.2, 0.1], scale: 2 },
      options: { opacity: 0.7 },
    });
    const { record, item: copy } = await duplicateItem(repo, id, item.id, NOW);

    expect(record.scene.items.map((i) => i.id)).toEqual([item.id, copy.id]);
    expect(copy.id).not.toBe(item.id);
    expect(copy.name).toBe('Rosa (cópia)');
    expect(copy.transform.position[0]).toBeCloseTo(0.25);
    expect(copy.transform.position[1]).toBeCloseTo(0.15);
    expect(copy.transform.position[2]).toBe(0.1);
    expect(copy.transform.scale).toBe(2);
    expect(copy.options.opacity).toBe(0.7);
    expect(copy.file).toEqual(item.file);

    // Apagar o original não pode levar o arquivo da cópia junto.
    await removeItem(repo, id, item.id);
    const opened = await openItemFile(repo, id, copy.id);
    expect(new Uint8Array(opened.data)).toEqual(new Uint8Array(signedBytes('image/png', 80, 1)));
  });

  it('item inexistente: not-found', async () => {
    const { repo, id } = await setup();
    await expect(duplicateItem(repo, id, 'fantasma')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('respeita o limite de itens por projeto', async () => {
    const { repo, id } = await setup();
    const first = await addItem(repo, id, { file: png() });
    const items = Array.from({ length: MAX_ITEMS_PER_PROJECT }, (_, i) => ({ ...first.item, id: `item${i}` }));
    await repo.save({ ...first.record, scene: { items } }, Object.fromEntries(items.map((i) => [itemFileKind(i.id), { mimeType: 'image/png', data: signedBytes('image/png', 80, 1) }])));
    await expect(duplicateItem(repo, id, 'item0')).rejects.toMatchObject({ code: 'invalid-input', message: expect.stringMatching(/máximo/) });
  });
});

describe('openItemFile', () => {
  it('devolve os bytes originais conferidos', async () => {
    const { repo, id } = await setup();
    const data = signedBytes('model/gltf-binary', 200, 5);
    const { item } = await addItem(repo, id, { file: { data, fileName: 'bicho.glb' } });
    const opened = await openItemFile(repo, id, item.id);
    expect(opened.item).toEqual(item);
    expect(new Uint8Array(opened.data)).toEqual(new Uint8Array(data));
  });

  it('arquivo ausente: not-found com o nome do item', async () => {
    const { repo, id } = await setup();
    const { item } = await addItem(repo, id, { file: png(), name: 'Rosa' });
    await repo.save((await repo.getEntry(id) as any).record, { [itemFileKind(item.id)]: null });
    await expect(openItemFile(repo, id, item.id)).rejects.toMatchObject({ code: 'not-found', message: expect.stringMatching(/Rosa/) });
    const entry = await repo.getEntry(id);
    expect(entry).toMatchObject({ kind: 'project', missingItems: [item.id] });
  });

  it('tamanho diferente: integrity', async () => {
    const { repo, id } = await setup();
    const { item, record } = await addItem(repo, id, { file: png() });
    await repo.save(record, { [itemFileKind(item.id)]: { mimeType: 'image/png', data: signedBytes('image/png', 40) } });
    await expect(openItemFile(repo, id, item.id)).rejects.toMatchObject({ code: 'integrity', message: expect.stringMatching(/incompleto/) });
  });

  it('mesmo tamanho, conteúdo diferente: só o hash denuncia', async () => {
    const { repo, id } = await setup();
    const { item, record } = await addItem(repo, id, { file: png() });
    await repo.save(record, { [itemFileKind(item.id)]: { mimeType: 'image/png', data: signedBytes('image/png', 80, 99) } });
    await expect(openItemFile(repo, id, item.id)).rejects.toMatchObject({ code: 'integrity', message: expect.stringMatching(/corrompido/) });
  });

  it('item inexistente e projeto inexistente', async () => {
    const { repo, id } = await setup();
    await expect(openItemFile(repo, id, 'fantasma')).rejects.toMatchObject({ code: 'not-found' });
    await expect(openItemFile(repo, 'nada', 'x')).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('excluir projeto', () => {
  it('apaga também os arquivos dos itens, sem tocar nos de projetos de id parecido', async () => {
    const repo = await freshRepository();
    const a = await createProject(repo, { name: 'A', anchor: makeMind(), id: 'a'.repeat(32) });
    const b = await createProject(repo, { name: 'B', anchor: makeMind({ seed: 2 }), id: 'a'.repeat(31) + 'b' });
    const itemA = await addItem(repo, a.id, { file: png() });
    const itemB = await addItem(repo, b.id, { file: png('b.png', 2) });

    await repo.delete(a.id);
    expect(await repo.getEntry(a.id)).toBeNull();
    expect(await repo.getFile(a.id, itemFileKind(itemA.item.id))).toBeNull();
    expect(await repo.getFile(a.id, 'anchor')).toBeNull();
    expect(await repo.getFile(b.id, itemFileKind(itemB.item.id))).not.toBeNull();
    expect(await repo.getFile(b.id, 'anchor')).not.toBeNull();
  });
});
