import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { describeModelError } from '../src/scene/loaders';
import { SceneRuntime, type RuntimeSummary } from '../src/scene/runtime';
import { describeProblems, describeSummary } from '../src/scene/summaryText';
import type { ItemController, ItemLoaders } from '../src/scene/types';
import { defaultOptions, defaultTransform, type ItemType, type SceneItem } from '../src/storage/model';

const MIME: Record<ItemType, string> = {
  image: 'image/png',
  gif: 'image/gif',
  video: 'video/mp4',
  model: 'model/gltf-binary',
  audio: 'audio/mpeg',
};

function makeItem(id: string, type: ItemType = 'image', patch: Partial<SceneItem> = {}): SceneItem {
  return {
    id,
    type,
    name: `Item ${id}`,
    visible: true,
    file: { mimeType: MIME[type], size: 8, sha256: 'a'.repeat(64), fileName: `${id}.bin` },
    transform: defaultTransform(),
    options: defaultOptions(type),
    ...patch,
  };
}

interface Fake extends ItemController {
  calls: string[];
  opacity: number | null;
  active: boolean | null;
  isBlocked: boolean;
  failOnUpdate?: boolean;
  failOnActive?: unknown;
}

function makeFake(type: ItemType, overrides: Partial<Fake> = {}): Fake {
  const calls: string[] = [];
  const fake: Fake = {
    calls,
    opacity: null,
    active: null,
    isBlocked: false,
    object: type === 'audio' ? null : new THREE.Mesh(new THREE.PlaneGeometry(1, 1)),
    get blocked() {
      return fake.isBlocked;
    },
    needsLights: type === 'model',
    async setActive(active) {
      calls.push(`active:${active}`);
      if (fake.failOnActive !== undefined) throw fake.failOnActive;
      fake.active = active;
    },
    async resume() {
      calls.push('resume');
      fake.isBlocked = false;
    },
    update(dt) {
      calls.push(`update:${dt}`);
      if (fake.failOnUpdate) throw new Error('quebrou no quadro');
    },
    setOpacity(o) {
      fake.opacity = o;
    },
    dispose() {
      calls.push('dispose');
    },
    ...overrides,
  };
  return fake;
}

function setup(items: SceneItem[], options: { fail?: Set<string>; fakes?: Map<string, Fake>; includeHidden?: boolean; open?: (id: string) => Promise<ArrayBuffer>; loaderDelay?: Map<string, Promise<void>> } = {}) {
  const fakes = options.fakes ?? new Map<string, Fake>();
  const loader = (type: ItemType) => async (item: SceneItem): Promise<ItemController> => {
    await options.loaderDelay?.get(item.id);
    if (options.fail?.has(item.id)) throw new Error(`falha ${item.id}`);
    const fake = fakes.get(item.id) ?? makeFake(type);
    fakes.set(item.id, fake);
    return fake;
  };
  const loaders: ItemLoaders = {
    image: loader('image'),
    gif: loader('gif'),
    video: loader('video'),
    model: loader('model'),
    audio: loader('audio'),
  };
  const changes: RuntimeSummary[] = [];
  const runtime = new SceneRuntime({
    items,
    openFile: options.open ?? (async () => new ArrayBuffer(8)),
    loaders,
    ...(options.includeHidden !== undefined ? { includeHidden: options.includeHidden } : {}),
    onChange: (s) => changes.push(s),
  });
  return { runtime, fakes, changes };
}

describe('SceneRuntime: carregamento', () => {
  it('monta um nó por item, na ordem, com transformação, visibilidade e opacidade aplicadas', async () => {
    const items = [
      makeItem('a', 'image', { transform: { ...defaultTransform(), position: [0.1, 0.2, 0] }, options: { ...defaultOptions('image'), opacity: 0.4 } }),
      makeItem('b', 'video'),
    ];
    const { runtime, fakes } = setup(items);
    await runtime.load();

    const roots = runtime.group.children.filter((c) => !(c instanceof THREE.Light));
    expect(roots).toHaveLength(2);
    expect(roots[0]!.position.toArray()).toEqual([0.1, 0.2, 0]);
    expect(fakes.get('a')!.opacity).toBe(0.4);
    expect(runtime.summary()).toMatchObject({ total: 2, ready: 2, loading: 0, failed: [], blocked: false });
    // O objeto do item está dentro da cadeia de nós.
    expect(fakes.get('a')!.object!.parent).not.toBeNull();
  });

  it('item oculto não é carregado (a menos que o editor peça)', async () => {
    const open = vi.fn(async () => new ArrayBuffer(8));
    const { runtime } = setup([makeItem('a'), makeItem('b', 'image', { visible: false })], { open });
    await runtime.load();
    expect(open).toHaveBeenCalledTimes(1);
    expect(runtime.summary()).toMatchObject({ total: 2, ready: 1, skipped: 1 });

    const { runtime: editor, fakes } = setup([makeItem('a'), makeItem('b', 'image', { visible: false })], { includeHidden: true });
    await editor.load();
    expect(editor.summary()).toMatchObject({ ready: 2, skipped: 0 });
    const hidden = fakes.get('b')!.object!.parent!.parent!.parent!.parent!;
    expect(hidden.visible).toBe(false);
  });

  it('um item que falha não derruba os outros e o erro aparece no resumo', async () => {
    const { runtime, fakes } = setup([makeItem('a'), makeItem('b'), makeItem('c')], { fail: new Set(['b']) });
    await runtime.load();
    const summary = runtime.summary();
    expect(summary.ready).toBe(2);
    expect(summary.failed).toEqual([{ id: 'b', name: 'Item b', message: 'falha b' }]);
    expect(fakes.has('b')).toBe(false);
    expect(describeProblems(summary)).toEqual(['Item b: falha b']);
  });

  it('arquivo que não abre (integridade) vira erro do item', async () => {
    const open = async (id: string) => {
      if (id === 'a') throw new Error('O arquivo de "Item a" está corrompido.');
      return new ArrayBuffer(8);
    };
    const { runtime } = setup([makeItem('a'), makeItem('b')], { open });
    await runtime.load();
    expect(runtime.summary().failed[0]).toMatchObject({ id: 'a', message: expect.stringMatching(/corrompido/) });
    expect(runtime.summary().ready).toBe(1);
  });

  it('só adiciona luzes quando algum modelo 3D foi carregado, e uma vez só', async () => {
    const noModel = setup([makeItem('a')]);
    await noModel.runtime.load();
    expect(noModel.runtime.group.children.some((c) => c instanceof THREE.Light)).toBe(false);

    const models = setup([makeItem('m1', 'model'), makeItem('m2', 'model')]);
    await models.runtime.load();
    expect(models.runtime.group.children.filter((c) => c instanceof THREE.Light)).toHaveLength(2);
  });

  it('respeita o limite de itens carregando ao mesmo tempo', async () => {
    let running = 0;
    let peak = 0;
    const loader = async (): Promise<ItemController> => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return makeFake('image');
    };
    const runtime = new SceneRuntime({
      items: Array.from({ length: 8 }, (_, i) => makeItem(`i${i}`)),
      openFile: async () => new ArrayBuffer(8),
      loaders: { image: loader, gif: loader, video: loader, model: loader, audio: loader },
      concurrency: 2,
    });
    await runtime.load();
    expect(peak).toBe(2);
    expect(runtime.summary().ready).toBe(8);
  });

  it('descartar durante o carregamento descarta também o que chegar depois', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runtime, fakes } = setup([makeItem('a'), makeItem('b')], { loaderDelay: new Map([['a', gate]]), });
    const loading = runtime.load();
    await new Promise((r) => setTimeout(r, 0));
    runtime.dispose();
    release();
    await loading;
    // O que já estava pronto ou chegou depois foi liberado; nada fica pendurado.
    for (const fake of fakes.values()) expect(fake.calls).toContain('dispose');
    expect(runtime.group.children).toHaveLength(0);
  });
});

describe('SceneRuntime: reconhecer e perder a tatuagem', () => {
  it('toca tudo ao reconhecer e pausa tudo ao perder', async () => {
    const { runtime, fakes } = setup([makeItem('a', 'video'), makeItem('b', 'audio')]);
    await runtime.load();
    await runtime.setTracking(true);
    expect([...fakes.values()].map((f) => f.active)).toEqual([true, true]);
    await runtime.setTracking(false);
    expect([...fakes.values()].map((f) => f.active)).toEqual([false, false]);
  });

  it('item que termina de carregar com a tatuagem já reconhecida começa tocando', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runtime, fakes } = setup([makeItem('a', 'video')], { loaderDelay: new Map([['a', gate]]) });
    const loading = runtime.load();
    await runtime.setTracking(true); // reconheceu antes de o vídeo carregar
    release();
    await loading;
    expect(fakes.get('a')!.active).toBe(true);
  });

  it('item que carrega com a tatuagem perdida não toca', async () => {
    const { runtime, fakes } = setup([makeItem('a', 'video')]);
    await runtime.load();
    expect(fakes.get('a')!.calls).not.toContain('active:true');
  });

  it('autoplay bloqueado: o resumo pede o toque, e resume() libera', async () => {
    const blocked = makeFake('video', { isBlocked: true });
    blocked.failOnActive = new DOMException('bloqueado', 'NotAllowedError');
    const { runtime } = setup([makeItem('a', 'video')], { fakes: new Map([['a', blocked]]) });
    await runtime.load();
    await runtime.setTracking(true);
    expect(runtime.summary()).toMatchObject({ blocked: true, failed: [] });

    blocked.failOnActive = undefined;
    await runtime.resume();
    expect(blocked.calls).toContain('resume');
    expect(runtime.summary().blocked).toBe(false);
  });

  it('falha de reprodução que não é bloqueio de autoplay marca o item com erro e o esconde', async () => {
    const bad = makeFake('audio');
    bad.failOnActive = new Error('decodificação falhou');
    const { runtime } = setup([makeItem('a', 'audio'), makeItem('b')], { fakes: new Map([['a', bad]]) });
    await runtime.load();
    await runtime.setTracking(true);
    expect(runtime.summary().failed[0]).toMatchObject({ id: 'a', message: 'decodificação falhou' });
    expect(runtime.summary().ready).toBe(1);
  });

  it('resume() só chama os itens bloqueados', async () => {
    const ok = makeFake('video');
    const blocked = makeFake('audio', { isBlocked: true });
    const { runtime } = setup([makeItem('a', 'video'), makeItem('b', 'audio')], { fakes: new Map([['a', ok], ['b', blocked]]) });
    await runtime.load();
    await runtime.resume();
    expect(ok.calls).not.toContain('resume');
    expect(blocked.calls).toContain('resume');
  });
});

describe('SceneRuntime: quadros e edição ao vivo', () => {
  it('update repassa o tempo aos itens prontos', async () => {
    const { runtime, fakes } = setup([makeItem('a', 'gif'), makeItem('b', 'model')], { fail: new Set(['b']) });
    await runtime.load();
    runtime.update(0.016);
    expect(fakes.get('a')!.calls).toContain('update:0.016');
  });

  it('erro dentro de update isola o item: some da cena e os outros seguem animando', async () => {
    const bad = makeFake('gif', { failOnUpdate: true });
    const { runtime, fakes } = setup([makeItem('a', 'gif'), makeItem('b', 'gif')], { fakes: new Map([['a', bad]]) });
    await runtime.load();
    expect(() => runtime.update(0.1)).not.toThrow();
    expect(runtime.summary().failed[0]?.id).toBe('a');
    runtime.update(0.1);
    expect(bad.calls.filter((c) => c.startsWith('update')).length).toBe(1);
    expect(fakes.get('b')!.calls.filter((c) => c.startsWith('update')).length).toBe(2);
  });

  it('updateItem aplica transformação, visibilidade e opacidade sem recarregar', async () => {
    const { runtime, fakes } = setup([makeItem('a')]);
    await runtime.load();
    runtime.updateItem(makeItem('a', 'image', { visible: false, transform: { ...defaultTransform(), scale: 3, position: [0.3, 0, 0] }, options: { ...defaultOptions('image'), opacity: 0.25 } }));
    const fake = fakes.get('a')!;
    expect(fake.opacity).toBe(0.25);
    const root = fake.object!.parent!.parent!.parent!.parent!;
    expect(root.visible).toBe(false);
    expect(root.position.x).toBeCloseTo(0.3);
    expect(fake.object!.parent!.scale.x).toBe(3);
  });

  it('updateItem de item desconhecido ou com erro é ignorado', async () => {
    const { runtime } = setup([makeItem('a')], { fail: new Set(['a']) });
    await runtime.load();
    expect(() => runtime.updateItem(makeItem('a'))).not.toThrow();
    expect(() => runtime.updateItem(makeItem('zzz'))).not.toThrow();
  });
});

describe('SceneRuntime: encerramento', () => {
  it('dispose libera todos os controladores uma única vez e esvazia o grupo', async () => {
    const { runtime, fakes } = setup([makeItem('a'), makeItem('b', 'audio')]);
    await runtime.load();
    const parent = new THREE.Group();
    parent.add(runtime.group);
    runtime.dispose();
    runtime.dispose();
    for (const fake of fakes.values()) expect(fake.calls.filter((c) => c === 'dispose')).toHaveLength(1);
    expect(parent.children).toHaveLength(0);
    expect(runtime.group.children).toHaveLength(0);
  });

  it('depois de dispose não avisa mais ninguém', async () => {
    const { runtime, changes } = setup([makeItem('a')]);
    await runtime.load();
    const before = changes.length;
    runtime.dispose();
    await runtime.setTracking(true);
    expect(changes.length).toBe(before);
  });
});

describe('resumo em texto', () => {
  const base: RuntimeSummary = { total: 5, loading: 0, ready: 5, skipped: 0, failed: [], blocked: false, notes: [] };

  it('sem itens esperados não mostra nada', () => {
    expect(describeSummary({ ...base, total: 0, ready: 0 })).toBe('');
    expect(describeSummary({ ...base, total: 2, ready: 0, skipped: 2 })).toBe('');
  });

  it('carregando, pronto e com erro', () => {
    expect(describeSummary({ ...base, ready: 2, loading: 3 })).toBe('Carregando itens: 2/5');
    expect(describeSummary(base)).toBe('Itens: 5/5 prontos');
    expect(describeSummary({ ...base, ready: 4, failed: [{ id: 'x', name: 'X', message: 'm' }] })).toBe('Itens: 4/5 prontos · 1 com erro');
    expect(describeSummary({ ...base, total: 6, skipped: 1 })).toBe('Itens: 5/5 prontos');
  });

  it('avisos entram junto dos erros', () => {
    expect(describeProblems({ ...base, failed: [{ id: 'x', name: 'X', message: 'ruim' }], notes: ['Y: aviso'] })).toEqual(['X: ruim', 'Y: aviso']);
  });
});

describe('describeModelError', () => {
  it.each([
    ['THREE.GLTFLoader: setDRACOLoader() must be called to load Draco compressed meshes', /Draco/],
    ['GLTFLoader: setMeshoptDecoder must be called', /Meshopt/],
    ['THREE.GLTFLoader: setKTX2Loader must be called for KHR_texture_basisu', /KTX2/],
    ['Unexpected token < in JSON', /GLB/],
  ])('%s', (text, expected) => {
    expect(describeModelError(new Error(text))).toMatch(expected);
  });

  it('valor que não é Error também é traduzido', () => {
    expect(describeModelError('qualquer coisa')).toMatch(/GLB/);
  });
});
