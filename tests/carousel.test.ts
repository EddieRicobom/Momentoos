import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, type BackupManifest } from '../src/storage/backup';
import { sha256Hex } from '../src/storage/hash';
import {
  CAROUSEL_INTERVAL_MAX_MS,
  CAROUSEL_INTERVAL_MIN_MS,
  MAX_CAROUSEL_BYTES,
  MAX_CAROUSEL_SLIDES,
  defaultOptions,
  isFileKind,
  itemFileKind,
  itemFileUnits,
  parseProjectRecord,
  slideFileKind,
  type CarouselSlide,
  type SceneItem,
} from '../src/storage/model';
import { createProject } from '../src/storage/projects';
import type { ProjectRepository } from '../src/storage/repository';
import {
  addCarousel,
  addItem,
  addSlides,
  duplicateItem,
  openItemFile,
  openSlideFile,
  removeItem,
  removeSlide,
  updateItem,
} from '../src/storage/scene';
import { freshRepository, makeMind, makeRecord, signedBytes } from './helpers';

const NOW = new Date('2026-10-14T09:00:00.000Z');

async function setup(): Promise<{ repo: ProjectRepository; id: string }> {
  const repo = await freshRepository();
  const record = await createProject(repo, { name: 'Braço', anchor: makeMind(), now: new Date('2026-10-13T09:00:00.000Z') });
  return { repo, id: record.id };
}

const png = (name: string, seed: number, size = 80) => ({ data: signedBytes('image/png', size, seed), fileName: name });
const jpg = (name: string, seed: number) => ({ data: signedBytes('image/jpeg', 90, seed), fileName: name });

const entryOf = async (repo: ProjectRepository, id: string) => {
  const entry = await repo.getEntry(id);
  if (entry?.kind !== 'project') throw new Error('esperado projeto');
  return entry;
};

describe('FileKind de slide', () => {
  it('aceita item:<id>~<n> e rejeita variações', () => {
    expect(isFileKind(slideFileKind('abc', 0))).toBe(true);
    expect(isFileKind('item:abc~12')).toBe(true);
    expect(isFileKind('item:abc~')).toBe(false);
    expect(isFileKind('item:abc~x')).toBe(false);
    expect(isFileKind('item:abc~1~2')).toBe(false);
    expect(isFileKind('item:~1')).toBe(false);
    expect(isFileKind('item:a/b~1')).toBe(false);
    expect(isFileKind('item:abc~12345')).toBe(false);
    expect(isFileKind(itemFileKind('abc'))).toBe(true);
  });
});

describe('modelo do carrossel', () => {
  const slide = (slot: number, seed = slot): CarouselSlide => ({
    slot,
    mimeType: 'image/png',
    size: 10 + seed,
    sha256: seed.toString(16).padStart(64, '0'),
    fileName: `s${slot}.png`,
  });

  function carousel(slides: CarouselSlide[], extra: Partial<SceneItem> = {}): SceneItem {
    const { slot: _slot, ...first } = slides[0]!;
    return {
      id: 'c1',
      type: 'carousel',
      name: 'Carrossel',
      visible: true,
      file: first,
      slides,
      transform: { scale: 1, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] },
      options: defaultOptions('carousel'),
      ...extra,
    };
  }

  async function parse(item: SceneItem) {
    const base = await makeRecord({ id: 'abc123' });
    return parseProjectRecord({ ...base, scene: { items: [item] } });
  }

  it('aceita um carrossel válido e as opções padrão trazem intervalo e transição', async () => {
    expect(defaultOptions('carousel')).toMatchObject({ intervalMs: 3000, fade: true });
    expect((await parse(carousel([slide(0), slide(1), slide(5)]))).ok).toBe(true);
  });

  it('itemFileUnits devolve um arquivo por slide (ou um só para os outros tipos)', () => {
    const c = carousel([slide(0), slide(4)]);
    expect(itemFileUnits(c).map((u) => [u.kind, u.slot, u.info.fileName])).toEqual([
      ['item:c1~0', 0, 's0.png'],
      ['item:c1~4', 4, 's4.png'],
    ]);
    const single: SceneItem = { ...c, type: 'image' };
    delete single.slides;
    expect(itemFileUnits(single).map((u) => [u.kind, u.slot])).toEqual([['item:c1', null]]);
  });

  it.each<[string, (slides: CarouselSlide[]) => Partial<SceneItem>]>([
    ['sem slides', () => ({ slides: [] })],
    ['slides ausentes', () => ({ slides: undefined })],
    ['slot repetido', (s) => ({ slides: [s[0]!, { ...s[1]!, slot: 0 }] })],
    ['slot negativo', (s) => ({ slides: [s[0]!, { ...s[1]!, slot: -1 }] })],
    ['slot fracionário', (s) => ({ slides: [s[0]!, { ...s[1]!, slot: 1.5 }] })],
    ['slide com GIF', (s) => ({ slides: [s[0]!, { ...s[1]!, mimeType: 'image/gif' }] })],
    ['slide com hash inválido', (s) => ({ slides: [s[0]!, { ...s[1]!, sha256: 'xyz' }] })],
    ['slide acima do limite por arquivo', (s) => ({ slides: [s[0]!, { ...s[1]!, size: 49 * 1024 * 1024 }] })],
    [
      'soma acima do limite',
      (s) => ({
        slides: Array.from({ length: 3 }, (_, i) => ({ ...s[0]!, slot: i, size: Math.ceil(MAX_CAROUSEL_BYTES / 3) + 1 })),
        file: { ...s[0]!, size: Math.ceil(MAX_CAROUSEL_BYTES / 3) + 1, slot: undefined },
      }),
    ],
    ['file diferente do primeiro slide', (s) => ({ file: { ...s[1]!, slot: undefined } as never })],
  ])('rejeita carrossel inválido: %s', async (_label, change) => {
    const slides = [slide(0), slide(1)];
    const item = { ...carousel(slides), ...change(slides) } as SceneItem;
    expect((await parse(item)).ok).toBe(false);
  });

  it('rejeita acima do máximo de imagens e aceita no máximo', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => slide(i, i + 1));
    expect((await parse(carousel(many(MAX_CAROUSEL_SLIDES)))).ok).toBe(true);
    expect((await parse(carousel(many(MAX_CAROUSEL_SLIDES + 1)))).ok).toBe(false);
  });

  it('só carrossel pode ter slides', async () => {
    const c = carousel([slide(0)]);
    expect((await parse({ ...c, type: 'image' })).ok).toBe(false);
  });

  it.each([
    [CAROUSEL_INTERVAL_MIN_MS - 1, false],
    [CAROUSEL_INTERVAL_MIN_MS, true],
    [CAROUSEL_INTERVAL_MAX_MS, true],
    [CAROUSEL_INTERVAL_MAX_MS + 1, false],
    [1500.5, false],
  ])('intervalo %s ms → válido=%s', async (intervalMs, ok) => {
    const c = carousel([slide(0)]);
    expect((await parse({ ...c, options: { ...c.options, intervalMs } })).ok).toBe(ok);
  });

  it('fade precisa ser booleano', async () => {
    const c = carousel([slide(0)]);
    expect((await parse({ ...c, options: { ...c.options, fade: 'sim' as never } })).ok).toBe(false);
  });

  it('migra um projeto v2: itens ganham intervalo e transição padrão sem perder o resto', async () => {
    const base = await makeRecord({ id: 'abc123' });
    const v2Item = {
      id: 'i1',
      type: 'image',
      name: 'Foto',
      visible: true,
      file: { mimeType: 'image/png', size: 10, sha256: 'a'.repeat(64), fileName: 'f.png' },
      transform: { scale: 2, rotation: [0, 0, 0], position: [0, 0, 0], offset: [0, 0, 0] },
      options: { opacity: 0.4, loop: true, muted: false, volume: 1, animate: false, clip: null },
    };
    const result = parseProjectRecord({ ...base, formatVersion: 2, scene: { items: [v2Item] } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.record.formatVersion).toBe(3);
    expect(result.record.scene.items[0]).toMatchObject({
      transform: { scale: 2 },
      options: { opacity: 0.4, intervalMs: 3000, fade: true },
    });
  });
});

describe('addCarousel', () => {
  it('cria um item com um arquivo por imagem, na ordem recebida, e file = primeira', async () => {
    const { repo, id } = await setup();
    const a = png('a.png', 1);
    const b = jpg('b.jpg', 2);
    const { item, record } = await addCarousel(repo, id, { files: [a, b], name: 'Flores', now: NOW });

    expect(item).toMatchObject({ type: 'carousel', name: 'Flores', visible: true });
    expect(item.slides?.map((s) => [s.slot, s.fileName, s.mimeType])).toEqual([
      [0, 'a.png', 'image/png'],
      [1, 'b.jpg', 'image/jpeg'],
    ]);
    expect(item.file).toMatchObject({ fileName: 'a.png', sha256: await sha256Hex(a.data) });
    expect(record.scene.items).toEqual([item]);
    expect(record.updatedAt).toBe(NOW.toISOString());

    for (const [slot, f] of [a, b].entries()) {
      const stored = await repo.getFile(id, slideFileKind(item.id, slot));
      expect(new Uint8Array(stored!.data)).toEqual(new Uint8Array(f.data));
    }
    expect(await repo.getFile(id, itemFileKind(item.id))).toBeFalsy();
    expect((await entryOf(repo, id)).missingItems).toEqual([]);
  });

  it('exige ao menos uma imagem e recusa GIF, vídeo e arquivos inválidos sem gravar nada', async () => {
    const { repo, id } = await setup();
    await expect(addCarousel(repo, id, { files: [] })).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      addCarousel(repo, id, { files: [png('a.png', 1), { data: signedBytes('image/gif'), fileName: 'x.gif' }] }),
    ).rejects.toThrow(/x\.gif.*carrossel/);
    await expect(
      addCarousel(repo, id, { files: [png('a.png', 1), { data: signedBytes('video/mp4'), fileName: 'v.mp4' }] }),
    ).rejects.toThrow(/v\.mp4/);
    await expect(
      addCarousel(repo, id, { files: [png('a.png', 1), { data: new Uint8Array([1, 2, 3, 4]).buffer, fileName: 'x.png' }] }),
    ).rejects.toThrow(/conteúdo/);
    expect((await entryOf(repo, id)).record.scene.items).toEqual([]);
  });

  it('respeita o máximo de imagens e a soma de bytes', async () => {
    const { repo, id } = await setup();
    const tooMany = Array.from({ length: MAX_CAROUSEL_SLIDES + 1 }, (_, i) => png(`${i}.png`, i + 1, 20));
    await expect(addCarousel(repo, id, { files: tooMany })).rejects.toThrow(/no máximo/);

    const big = (seed: number) => png(`g${seed}.png`, seed, 40 * 1024 * 1024);
    await expect(addCarousel(repo, id, { files: [big(1), big(2), big(3)] })).rejects.toThrow(/somam mais/);
    expect((await entryOf(repo, id)).record.scene.items).toEqual([]);
  });

  it('um carrossel conta como um item no limite do projeto', async () => {
    const { repo, id } = await setup();
    await addCarousel(repo, id, { files: [png('a.png', 1), png('b.png', 2)] });
    await addItem(repo, id, { file: png('c.png', 3) });
    expect((await entryOf(repo, id)).record.scene.items).toHaveLength(2);
  });
});

describe('addSlides e removeSlide', () => {
  async function withCarousel(count = 2) {
    const { repo, id } = await setup();
    const files = Array.from({ length: count }, (_, i) => png(`s${i}.png`, i + 1));
    const { item } = await addCarousel(repo, id, { files });
    return { repo, id, item, files };
  }

  it('addSlides acrescenta ao fim, usando slots livres', async () => {
    const { repo, id, item } = await withCarousel(2);
    const { item: updated } = await addSlides(repo, id, item.id, [jpg('novo.jpg', 9), png('outro.png', 10)], NOW);
    expect(updated.slides?.map((s) => [s.slot, s.fileName])).toEqual([
      [0, 's0.png'],
      [1, 's1.png'],
      [2, 'novo.jpg'],
      [3, 'outro.png'],
    ]);
    expect((await entryOf(repo, id)).record.scene.items[0]).toEqual(updated);
    expect(new Uint8Array((await repo.getFile(id, slideFileKind(item.id, 3)))!.data)).toEqual(
      new Uint8Array(png('outro.png', 10).data),
    );
  });

  it('depois de remover um slide, o slot liberado é reaproveitado e as outras imagens não mudam de arquivo', async () => {
    const { repo, id, item, files } = await withCarousel(3);
    await removeSlide(repo, id, item.id, 1);
    expect(await repo.getFile(id, slideFileKind(item.id, 1))).toBeFalsy();
    const { item: updated } = await addSlides(repo, id, item.id, [png('reuso.png', 20)]);
    expect(updated.slides?.map((s) => [s.slot, s.fileName])).toEqual([
      [0, 's0.png'],
      [2, 's2.png'],
      [1, 'reuso.png'],
    ]);
    expect(new Uint8Array((await repo.getFile(id, slideFileKind(item.id, 2)))!.data)).toEqual(new Uint8Array(files[2]!.data));
    expect(new Uint8Array((await repo.getFile(id, slideFileKind(item.id, 1)))!.data)).toEqual(
      new Uint8Array(png('reuso.png', 20).data),
    );
  });

  it('removeSlide apaga o arquivo e, ao tirar a primeira imagem, file passa a ser a nova primeira', async () => {
    const { repo, id, item, files } = await withCarousel(3);
    const { item: updated } = await removeSlide(repo, id, item.id, 0);
    expect(updated.slides?.map((s) => s.slot)).toEqual([1, 2]);
    expect(updated.file).toMatchObject({ fileName: 's1.png', sha256: await sha256Hex(files[1]!.data) });
    expect(await repo.getFile(id, slideFileKind(item.id, 0))).toBeFalsy();
    expect((await entryOf(repo, id)).record.scene.items[0]).toEqual(updated);
  });

  it('não deixa remover a última imagem, nem slot inexistente, nem operar em item que não é carrossel', async () => {
    const { repo, id, item } = await withCarousel(1);
    await expect(removeSlide(repo, id, item.id, 0)).rejects.toThrow(/pelo menos uma imagem/);
    await expect(removeSlide(repo, id, item.id, 7)).rejects.toMatchObject({ code: 'not-found' });
    const { item: plain } = await addItem(repo, id, { file: png('p.png', 5) });
    await expect(removeSlide(repo, id, plain.id, 0)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(addSlides(repo, id, plain.id, [png('q.png', 6)])).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(addSlides(repo, id, 'nada', [png('q.png', 6)])).rejects.toMatchObject({ code: 'not-found' });
    await expect(addSlides(repo, id, item.id, [])).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('addSlides respeita o máximo de imagens e recusa GIF sem alterar nada', async () => {
    const { repo, id, item } = await withCarousel(MAX_CAROUSEL_SLIDES);
    await expect(addSlides(repo, id, item.id, [png('extra.png', 99)])).rejects.toThrow(/no máximo/);
    const small = await withCarousel(2);
    await expect(
      addSlides(small.repo, small.id, small.item.id, [{ data: signedBytes('image/gif'), fileName: 'g.gif' }]),
    ).rejects.toThrow(/carrossel/);
    expect((await entryOf(small.repo, small.id)).record.scene.items[0]).toEqual(small.item);
  });
});

describe('abrir, duplicar e remover', () => {
  it('openSlideFile confere tamanho e hash; openItemFile devolve a primeira imagem', async () => {
    const { repo, id } = await setup();
    const a = png('a.png', 1);
    const b = png('b.png', 2);
    const { item } = await addCarousel(repo, id, { files: [a, b] });

    const first = await openItemFile(repo, id, item.id);
    expect(new Uint8Array(first.data)).toEqual(new Uint8Array(a.data));
    const second = await openSlideFile(repo, id, item.id, 1);
    expect(new Uint8Array(second.data)).toEqual(new Uint8Array(b.data));
    await expect(openSlideFile(repo, id, item.id, 9)).rejects.toMatchObject({ code: 'not-found' });

    // adultera o arquivo do slide 1 (mesmo tamanho, outro conteúdo)
    await repo.save((await entryOf(repo, id)).record, {
      [slideFileKind(item.id, 1)]: { mimeType: 'image/png', data: signedBytes('image/png', 80, 77) },
    });
    await expect(openSlideFile(repo, id, item.id, 1)).rejects.toMatchObject({ code: 'integrity' });
    // tamanho diferente
    await repo.save((await entryOf(repo, id)).record, {
      [slideFileKind(item.id, 1)]: { mimeType: 'image/png', data: signedBytes('image/png', 50, 2) },
    });
    await expect(openSlideFile(repo, id, item.id, 1)).rejects.toMatchObject({ code: 'integrity' });
    // ausente
    await repo.save((await entryOf(repo, id)).record, { [slideFileKind(item.id, 1)]: null });
    await expect(openSlideFile(repo, id, item.id, 1)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('openSlideFile recusa item que não é carrossel', async () => {
    const { repo, id } = await setup();
    const { item } = await addItem(repo, id, { file: png('p.png', 1) });
    await expect(openSlideFile(repo, id, item.id, 0)).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('removeItem apaga todos os arquivos do carrossel e não toca nos de outros itens', async () => {
    const { repo, id } = await setup();
    const { item } = await addCarousel(repo, id, { files: [png('a.png', 1), png('b.png', 2), png('c.png', 3)] });
    const { item: other } = await addItem(repo, id, { file: png('o.png', 4) });
    await removeItem(repo, id, item.id);
    for (let slot = 0; slot < 3; slot++) expect(await repo.getFile(id, slideFileKind(item.id, slot))).toBeFalsy();
    expect(await repo.getFile(id, itemFileKind(other.id))).toBeTruthy();
    expect((await entryOf(repo, id)).record.scene.items.map((i) => i.id)).toEqual([other.id]);
  });

  it('duplicateItem copia todas as imagens com os mesmos slots sob o novo id', async () => {
    const { repo, id } = await setup();
    const files = [png('a.png', 1), png('b.png', 2)];
    const { item } = await addCarousel(repo, id, { files });
    await removeSlide(repo, id, item.id, 0); // deixa só o slot 1
    await addSlides(repo, id, item.id, [png('c.png', 3)]); // slot 0 reaproveitado, depois do slot 1
    const current = (await entryOf(repo, id)).record.scene.items[0]!;

    const { item: copy } = await duplicateItem(repo, id, item.id, NOW);
    expect(copy.id).not.toBe(item.id);
    expect(copy.slides).toEqual(current.slides);
    for (const slide of current.slides!) {
      const original = await repo.getFile(id, slideFileKind(item.id, slide.slot));
      const copied = await repo.getFile(id, slideFileKind(copy.id, slide.slot));
      expect(new Uint8Array(copied!.data)).toEqual(new Uint8Array(original!.data));
    }
    // a cópia é independente
    await removeItem(repo, id, copy.id);
    expect(await repo.getFile(id, slideFileKind(item.id, 1))).toBeTruthy();
  });

  it('duplicar com um slide corrompido falha e não cria nada', async () => {
    const { repo, id } = await setup();
    const { item } = await addCarousel(repo, id, { files: [png('a.png', 1), png('b.png', 2)] });
    await repo.save((await entryOf(repo, id)).record, { [slideFileKind(item.id, 1)]: null });
    await expect(duplicateItem(repo, id, item.id)).rejects.toMatchObject({ code: 'not-found' });
    expect((await entryOf(repo, id)).record.scene.items).toHaveLength(1);
  });

  it('missingItems aponta o carrossel quando falta qualquer slide', async () => {
    const { repo, id } = await setup();
    const { item } = await addCarousel(repo, id, { files: [png('a.png', 1), png('b.png', 2)] });
    const { item: ok } = await addItem(repo, id, { file: png('o.png', 3) });
    await repo.save((await entryOf(repo, id)).record, { [slideFileKind(item.id, 1)]: null });
    const entry = await entryOf(repo, id);
    expect(entry.missingItems).toEqual([item.id]);
    expect(entry.missingItems).not.toContain(ok.id);
  });

  it('updateItem altera intervalo e transição do carrossel', async () => {
    const { repo, id } = await setup();
    const { item } = await addCarousel(repo, id, { files: [png('a.png', 1), png('b.png', 2)] });
    const record = await updateItem(repo, id, item.id, { options: { intervalMs: 8000, fade: false } });
    expect(record.scene.items[0]?.options).toMatchObject({ intervalMs: 8000, fade: false });
    await expect(updateItem(repo, id, item.id, { options: { intervalMs: 10 } })).rejects.toMatchObject({
      code: 'invalid-input',
    });
  });
});

describe('repositório recusa chaves inválidas de slide', () => {
  it('save com chave mal formada falha', async () => {
    const { repo, id } = await setup();
    const { record } = await entryOf(repo, id);
    await expect(
      repo.save(record, { ['item:abc~x' as never]: { mimeType: 'image/png', data: signedBytes('image/png') } }),
    ).rejects.toBeTruthy();
  });
});

describe('backup com carrossel', () => {
  const OPTIONS = { appVersion: '0.0.0-teste', now: new Date('2026-10-13T18:30:00.000Z') };

  async function origin() {
    const repo = await freshRepository('origem');
    const project = await createProject(repo, {
      name: 'Braço',
      anchor: makeMind({ seed: 1, filler: 400 }),
      now: new Date('2026-10-01T10:00:00.000Z'),
    });
    const files = [png('a.png', 1, 200), jpg('b.jpg', 2), png('c.png', 3, 120)];
    const { item } = await addCarousel(repo, project.id, { files, name: 'Flores', options: { intervalMs: 4500, fade: false } });
    await removeSlide(repo, project.id, item.id, 1); // slots 0 e 2: o backup precisa preservá-los
    const { item: plain } = await addItem(repo, project.id, { file: png('solto.png', 9) });
    return { repo, id: project.id, carouselId: item.id, plainId: plain.id, files };
  }

  const readManifest = (zip: Uint8Array): BackupManifest =>
    JSON.parse(strFromU8(unzipSync(zip)['manifest.json']!)) as BackupManifest;

  it('exporta um arquivo por slide com o slot no nome e declara os slides no manifesto', async () => {
    const { repo, id, carouselId, plainId } = await origin();
    const result = await exportBackup(repo, 'all', OPTIONS);
    expect(result.warnings).toEqual([]);
    const entries = readManifest(result.bytes).projects[0]!.items!;
    const car = entries.find((e) => e.id === carouselId)!;
    expect(car.file).toBeUndefined();
    expect(car.slides?.map((s) => [s.slot, s.file.path])).toEqual([
      [0, `projects/${id}/items/${carouselId}~0.png`],
      [2, `projects/${id}/items/${carouselId}~2.png`],
    ]);
    expect(entries.find((e) => e.id === plainId)?.file?.path).toBe(`projects/${id}/items/${plainId}.png`);
    const zip = unzipSync(result.bytes);
    for (const slide of car.slides!) {
      expect(await sha256Hex(zip[slide.file.path]!)).toBe(slide.file.sha256);
    }
  });

  it('ida e volta: o carrossel volta igual, com os mesmos bytes e as opções', async () => {
    const { repo, id, carouselId, files } = await origin();
    const { bytes } = await exportBackup(repo, 'all', OPTIONS);
    const dest = await freshRepository('destino');
    const report = await importBackup(dest, bytes);
    expect(report.warnings).toEqual([]);
    const imported = await entryOf(dest, id);
    const car = imported.record.scene.items.find((i) => i.id === carouselId)!;
    const original = (await entryOf(repo, id)).record.scene.items.find((i) => i.id === carouselId)!;
    expect(car).toEqual(original);
    expect(car.options).toMatchObject({ intervalMs: 4500, fade: false });
    expect(imported.missingItems).toEqual([]);
    expect(new Uint8Array((await dest.getFile(id, slideFileKind(carouselId, 2)))!.data)).toEqual(
      new Uint8Array(files[2]!.data),
    );
    expect(new Uint8Array((await dest.getFile(id, slideFileKind(carouselId, 0)))!.data)).toEqual(
      new Uint8Array(files[0]!.data),
    );
  });

  it('slide corrompido no banco: o carrossel fica fora do backup, com aviso, e o resto sai', async () => {
    const { repo, id, carouselId, plainId } = await origin();
    await repo.save((await entryOf(repo, id)).record, {
      [slideFileKind(carouselId, 2)]: { mimeType: 'image/png', data: signedBytes('image/png', 120, 55) },
    });
    const result = await exportBackup(repo, 'all', OPTIONS);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Flores.*corrompido/);
    const zip = unzipSync(result.bytes);
    expect(Object.keys(zip).filter((n) => n.includes(carouselId))).toEqual([]);
    const dest = await freshRepository('destino');
    await importBackup(dest, result.bytes);
    expect((await entryOf(dest, id)).record.scene.items.map((i) => i.id)).toEqual([plainId]);
  });

  it('slide ausente no banco também deixa o carrossel de fora', async () => {
    const { repo, id, carouselId } = await origin();
    await repo.save((await entryOf(repo, id)).record, { [slideFileKind(carouselId, 0)]: null });
    const result = await exportBackup(repo, 'all', OPTIONS);
    expect(result.warnings[0]).toMatch(/Flores.*ausente/);
  });

  async function exported() {
    const o = await origin();
    const { bytes } = await exportBackup(o.repo, 'all', OPTIONS);
    return { ...o, bytes };
  }

  function rezip(zip: Uint8Array, mutate: (files: Record<string, Uint8Array>) => void): Uint8Array {
    const files = unzipSync(zip);
    mutate(files);
    return zipSync(files);
  }

  function editManifest(zip: Uint8Array, edit: (m: BackupManifest) => void): Uint8Array {
    return rezip(zip, (files) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as BackupManifest;
      edit(manifest);
      files['manifest.json'] = strToU8(JSON.stringify(manifest));
    });
  }

  it('importar: um slide adulterado no ZIP derruba só o carrossel', async () => {
    const { bytes, id, carouselId, plainId } = await exported();
    const tampered = rezip(bytes, (files) => {
      files[`projects/${id}/items/${carouselId}~2.png`] = new Uint8Array(signedBytes('image/png', 120, 99));
    });
    const dest = await freshRepository('destino');
    const report = await importBackup(dest, tampered);
    expect(report.warnings.some((w) => /Flores/.test(w) && /ignorado/.test(w))).toBe(true);
    expect((await entryOf(dest, id)).record.scene.items.map((i) => i.id)).toEqual([plainId]);
  });

  it('importar: slide declarado no projeto mas ausente do manifesto derruba o carrossel', async () => {
    const { bytes, id, carouselId, plainId } = await exported();
    const edited = editManifest(bytes, (m) => {
      const car = m.projects[0]!.items!.find((e) => e.id === carouselId)!;
      car.slides = car.slides!.filter((s) => s.slot !== 2);
    });
    const dest = await freshRepository('destino');
    const report = await importBackup(dest, edited);
    expect(report.warnings.some((w) => /Flores/.test(w))).toBe(true);
    expect((await entryOf(dest, id)).record.scene.items.map((i) => i.id)).toEqual([plainId]);
  });

  it('importar: manifesto com hash vazio num slide é recusado', async () => {
    const { bytes, id, carouselId } = await exported();
    const path = `projects/${id}/items/${carouselId}~0.png`;
    const edited = rezip(bytes, (files) => {
      files[path] = new Uint8Array(200).fill(7);
      const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as BackupManifest;
      const slide = manifest.projects[0]!.items!.find((e) => e.id === carouselId)!.slides!.find((s) => s.slot === 0)!;
      slide.file.sha256 = '';
      files['manifest.json'] = strToU8(JSON.stringify(manifest));
    });
    await expect(importBackup(await freshRepository('destino'), edited)).rejects.toMatchObject({ code: 'invalid-manifest' });
  });

  it.each<[string, (m: BackupManifest, carouselId: string, id: string) => void]>([
    ['arquivo e slides juntos', (m, cid) => {
      const e = m.projects[0]!.items!.find((x) => x.id === cid)!;
      e.file = e.slides![0]!.file;
    }],
    ['slides vazio', (m, cid) => { m.projects[0]!.items!.find((x) => x.id === cid)!.slides = []; }],
    ['slot repetido', (m, cid) => {
      const s = m.projects[0]!.items!.find((x) => x.id === cid)!.slides!;
      s[1] = { slot: s[0]!.slot, file: s[0]!.file };
    }],
    ['slot negativo', (m, cid) => { m.projects[0]!.items!.find((x) => x.id === cid)!.slides![0]!.slot = -1; }],
    ['caminho do slide aponta para outro slot', (m, cid, id) => {
      m.projects[0]!.items!.find((x) => x.id === cid)!.slides![0]!.file.path = `projects/${id}/items/${cid}~7.png`;
    }],
    ['caminho do slide sem slot', (m, cid, id) => {
      m.projects[0]!.items!.find((x) => x.id === cid)!.slides![0]!.file.path = `projects/${id}/items/${cid}.png`;
    }],
    ['slides não é lista', (m, cid) => { (m.projects[0]!.items!.find((x) => x.id === cid)! as { slides: unknown }).slides = 'x'; }],
    ['mais slides que o máximo', (m, cid, id) => {
      const e = m.projects[0]!.items!.find((x) => x.id === cid)!;
      e.slides = Array.from({ length: MAX_CAROUSEL_SLIDES + 1 }, (_, slot) => ({
        slot,
        file: { path: `projects/${id}/items/${cid}~${slot}.png`, size: 1, sha256: 'a'.repeat(64) },
      }));
    }],
  ])('importar: manifesto com %s é recusado', async (_label, edit) => {
    const { bytes, id, carouselId } = await exported();
    const edited = editManifest(bytes, (m) => edit(m, carouselId, id));
    await expect(importBackup(await freshRepository('destino'), edited)).rejects.toMatchObject({ code: 'invalid-manifest' });
  });

  it('importar: um backup do formato 2 (itens de arquivo único) continua funcionando', async () => {
    const repo = await freshRepository('origem');
    const project = await createProject(repo, { name: 'Velho', anchor: makeMind({ seed: 1, filler: 400 }), now: new Date('2026-10-01T10:00:00.000Z') });
    const { item } = await addItem(repo, project.id, { file: png('x.png', 1) });
    const { bytes } = await exportBackup(repo, 'all', OPTIONS);
    // simula um backup antigo: formato 2 no manifesto e projeto v2 sem as opções novas
    const v2 = rezip(bytes, (files) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']!));
      manifest.formatVersion = 2;
      files['manifest.json'] = strToU8(JSON.stringify(manifest));
    });
    const dest = await freshRepository('destino');
    const report = await importBackup(dest, v2);
    expect(report.warnings).toEqual([]);
    expect((await entryOf(dest, project.id)).record.scene.items.map((i) => i.id)).toEqual([item.id]);
  });
});
