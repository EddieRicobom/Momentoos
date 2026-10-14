// @vitest-environment happy-dom
//
// Carregador do carrossel com decodificação de imagem SIMULADA (Image/Blob
// falsos): confere a lógica de tempo, carregamento sob demanda, descarte,
// falhas e transição. NÃO confere o desenho real em WebGL nem a decodificação
// de arquivos reais.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserLoaders } from '../src/scene/loaders';
import { defaultOptions, defaultTransform, type CarouselSlide, type SceneItem } from '../src/storage/model';

const blobs = new Map<string, Blob>();
let urlCounter = 0;

class FakeImage {
  src = '';
  naturalWidth = 0;
  naturalHeight = 0;
  async decode(): Promise<void> {
    const blob = blobs.get(this.src);
    if (!blob) throw new Error('sem blob');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[0] === 0xff) throw new Error('imagem inválida');
    this.naturalWidth = bytes[1]! * 100;
    this.naturalHeight = bytes[2]! * 100;
  }
}

const original = { Image: globalThis.Image, create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  blobs.clear();
  urlCounter = 0;
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    const url = `blob:fake-${++urlCounter}`;
    blobs.set(url, blob as Blob);
    return url;
  };
  URL.revokeObjectURL = () => {};
});
afterEach(() => {
  (globalThis as unknown as { Image: unknown }).Image = original.Image;
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
  vi.restoreAllMocks();
});

/** Bytes de uma "imagem" falsa: [válida?, largura/100, altura/100]. Largura = 100 × (slot + 1). */
const bytesFor = (slot: number, valid = true, height = 2): ArrayBuffer =>
  new Uint8Array([valid ? 1 : 0xff, slot + 1, height]).buffer;

function makeCarousel(slots: number[], options: Partial<SceneItem['options']> = {}): SceneItem {
  const slides: CarouselSlide[] = slots.map((slot) => ({
    slot,
    mimeType: 'image/png',
    size: 3,
    sha256: 'a'.repeat(64),
    fileName: `s${slot}.png`,
  }));
  const { slot: _slot, ...first } = slides[0]!;
  return {
    id: 'c1',
    type: 'carousel',
    name: 'Carrossel',
    visible: true,
    file: first,
    slides,
    transform: defaultTransform(),
    options: { ...defaultOptions('carousel'), intervalMs: 1000, fade: false, ...options },
  };
}

interface Harness {
  controller: Awaited<ReturnType<typeof browserLoaders.carousel>>;
  opened: number[];
  front: THREE.Mesh;
  back: THREE.Mesh;
  /** Slot cuja imagem está desenhada em cada plano (null se vazio/oculto). */
  shown(mesh: THREE.Mesh): number | null;
  /** Avança o tempo e espera as aberturas pendentes assentarem. */
  tick(seconds: number): Promise<void>;
}

async function setup(item: SceneItem, bad: ReadonlySet<number> = new Set()): Promise<Harness> {
  const opened: number[] = [];
  const controller = await browserLoaders.carousel(item, bytesFor(item.slides![0]!.slot), {
    openSlide: async (slot) => {
      opened.push(slot);
      return bytesFor(slot, !bad.has(slot));
    },
  });
  const group = controller.object as THREE.Group;
  const [front, back] = group.children as [THREE.Mesh, THREE.Mesh];
  const shown = (mesh: THREE.Mesh): number | null => {
    if (!mesh.visible) return null;
    const map = (mesh.material as THREE.MeshBasicMaterial).map;
    const image = map?.image as { naturalWidth: number } | undefined;
    return image ? image.naturalWidth / 100 - 1 : null;
  };
  const tick = async (seconds: number): Promise<void> => {
    controller.update(seconds);
    // deixa as decodificações assíncronas terminarem e aplica o resultado
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.update(0);
  };
  return { controller, opened, front, back, shown, tick };
}

describe('carrossel: carregador', () => {
  it('mostra a primeira imagem na hora, com a proporção dela, e não abre as outras antes de precisar', async () => {
    const h = await setup(makeCarousel([0, 1, 2], { fade: false }));
    expect(h.shown(h.front)).toBe(0);
    expect(h.front.scale.x).toBeCloseTo(0.5);
    expect(h.front.scale.y).toBeCloseTo(0.5 * (200 / 100)); // largura 100, altura 200
    expect(h.back.visible).toBe(false);
    expect(h.opened).toEqual([]);
    expect(h.controller.blocked).toBe(false);
    expect(h.controller.needsLights).toBe(false);
  });

  it('sem a tatuagem à vista o tempo não anda; ao ser vista, troca a cada intervalo e dá a volta', async () => {
    const h = await setup(makeCarousel([0, 1, 2]));
    await h.tick(5); // inativo
    expect(h.shown(h.front)).toBe(0);

    await h.controller.setActive(true);
    await h.tick(0.5);
    expect(h.shown(h.front)).toBe(0);
    await h.tick(0.6); // 1,1 s
    expect(h.shown(h.front)).toBe(1);
    await h.tick(1); // 2,1 s
    expect(h.shown(h.front)).toBe(2);
    await h.tick(1); // 3,1 s: volta ao início
    expect(h.shown(h.front)).toBe(0);

    await h.controller.setActive(false);
    await h.tick(10);
    expect(h.shown(h.front)).toBe(0); // pausado onde estava
  });

  it('abre só a imagem atual e a próxima: a segunda já está pronta quando chega a hora', async () => {
    const h = await setup(makeCarousel([0, 1, 2, 3, 4, 5], { intervalMs: 1000 }));
    await h.controller.setActive(true);
    await h.tick(0.1);
    expect(h.opened).toEqual([1]); // próxima, pré-carregada
    await h.tick(1);
    expect(h.shown(h.front)).toBe(1);
    expect(h.opened).toEqual([1, 2]);
  });

  it('com transição, o próximo aparece por cima com opacidade proporcional e a opacidade do item vale', async () => {
    const h = await setup(makeCarousel([0, 1], { fade: true, intervalMs: 2000 }));
    h.controller.setOpacity(0.8);
    await h.controller.setActive(true);
    await h.tick(0.1); // pré-carrega a segunda
    await h.tick(1.6); // 1,7 s: transição começa em 1,4 s (600 ms antes do fim) → mix 0.5
    expect(h.shown(h.front)).toBe(0);
    expect(h.shown(h.back)).toBe(1);
    expect((h.back.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.8 * 0.5, 1);
    expect((h.front.material as THREE.MeshBasicMaterial).opacity).toBeCloseTo(0.8);
    await h.tick(0.35); // 2,05 s: transição acabou, segunda inteira
    expect(h.shown(h.front)).toBe(1);
    expect(h.back.visible).toBe(false);
  });

  it('se o próximo ainda não carregou, segue mostrando o atual (sem tela vazia)', async () => {
    const slow = makeCarousel([0, 1], { fade: false, intervalMs: 1000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const controller = await browserLoaders.carousel(slow, bytesFor(0), {
      openSlide: async (slot) => {
        await gate;
        return bytesFor(slot);
      },
    });
    const front = (controller.object as THREE.Group).children[0] as THREE.Mesh;
    await controller.setActive(true);
    controller.update(1.5); // já deveria estar na imagem 2
    await Promise.resolve();
    expect(front.visible).toBe(true);
    expect((front.material as THREE.MeshBasicMaterial).map?.image).toMatchObject({ naturalWidth: 100 });
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.update(0);
    expect((front.material as THREE.MeshBasicMaterial).map?.image).toMatchObject({ naturalWidth: 200 });
  });

  it('imagem que não abre é pulada, o carrossel segue e o aviso aparece', async () => {
    const h = await setup(makeCarousel([0, 1, 2]), new Set([1]));
    expect(h.controller.note).toBeUndefined();
    await h.controller.setActive(true);
    await h.tick(0.1);
    await h.tick(0.1);
    expect(h.controller.note).toMatch(/1 imagem\(ns\).*puladas/);
    await h.tick(1); // 1,2 s: sem a imagem 1, quem vem depois da 0 é a 2
    expect(h.shown(h.front)).toBe(2);
    expect(h.opened.filter((slot) => slot === 1)).toHaveLength(1); // não insiste
  });

  it('com muitas imagens descarta as texturas que ficaram para trás', async () => {
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const h = await setup(makeCarousel([0, 1, 2, 3, 4, 5, 6]));
    await h.controller.setActive(true);
    for (let i = 0; i < 6; i += 1) await h.tick(1);
    expect(dispose.mock.calls.length).toBeGreaterThanOrEqual(3);
    // ao dar a volta, a primeira precisa ser aberta de novo
    for (let i = 0; i < 2; i += 1) await h.tick(1);
    expect(h.opened).toContain(0);
  });

  it('com poucas imagens guarda todas e nunca reabre', async () => {
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const h = await setup(makeCarousel([0, 1, 2]));
    await h.controller.setActive(true);
    for (let i = 0; i < 7; i += 1) await h.tick(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(h.opened.sort()).toEqual([1, 2]);
  });

  it('configure muda o intervalo e a transição ao vivo', async () => {
    const item = makeCarousel([0, 1], { intervalMs: 10000, fade: false });
    const h = await setup(item);
    await h.controller.setActive(true);
    await h.tick(2);
    expect(h.shown(h.front)).toBe(0);
    h.controller.configure!({ ...item, options: { ...item.options, intervalMs: 1000 } });
    await h.tick(0.1);
    await h.tick(0.1);
    expect(h.shown(h.front)).toBe(0); // 2,2 s com ciclo de 2 s → 0,2 s: volta à primeira
    await h.tick(1);
    expect(h.shown(h.front)).toBe(1);
  });

  it('configure liga e desliga a transição ao vivo', async () => {
    const item = makeCarousel([0, 1], { intervalMs: 2000, fade: false });
    const h = await setup(item);
    await h.controller.setActive(true);
    await h.tick(0.1);
    await h.tick(1.6); // 1,7 s: dentro da janela de transição
    expect(h.back.visible).toBe(false);
    h.controller.configure!({ ...item, options: { ...item.options, fade: true } });
    await h.tick(0);
    expect(h.shown(h.back)).toBe(1);
    h.controller.configure!({ ...item, options: { ...item.options, fade: false } });
    await h.tick(0);
    expect(h.back.visible).toBe(false);
  });

  it('a imagem na tela não é descartada enquanto a atual ainda não carregou', async () => {
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const item = makeCarousel([0, 1, 2, 3, 4, 5], { intervalMs: 1000 });
    const controller = await browserLoaders.carousel(item, bytesFor(0), {
      openSlide: (slot) => (slot === 1 ? new Promise<ArrayBuffer>(() => {}) : Promise.resolve(bytesFor(slot))),
    });
    await controller.setActive(true);
    controller.update(1.2); // a imagem 1 é a atual, mas nunca chega; a 0 segue na tela
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.update(0);
    const front = (controller.object as THREE.Group).children[0] as THREE.Mesh;
    expect((front.material as THREE.MeshBasicMaterial).map?.image).toMatchObject({ naturalWidth: 100 });
    expect(dispose).not.toHaveBeenCalled();
  });

  it('dispose libera texturas e uma abertura que termina depois não deixa nada para trás', async () => {
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const created = vi.spyOn(THREE.Texture.prototype, 'needsUpdate', 'set');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const item = makeCarousel([0, 1]);
    const controller = await browserLoaders.carousel(item, bytesFor(0), {
      openSlide: async (slot) => {
        await gate;
        return bytesFor(slot);
      },
    });
    await controller.setActive(true);
    controller.update(0.1); // dispara a abertura da 2ª
    controller.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispose).toHaveBeenCalledTimes(1);
    // nenhuma textura nova foi criada depois do dispose (só a da primeira imagem)
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('falha na primeira imagem derruba o item; carrossel sem imagens também', async () => {
    const item = makeCarousel([0, 1]);
    await expect(browserLoaders.carousel(item, bytesFor(0, false), { openSlide: async () => bytesFor(1) })).rejects.toThrow(/decodificada/);
    await expect(
      browserLoaders.carousel({ ...item, slides: [] }, bytesFor(0), { openSlide: async () => bytesFor(1) }),
    ).rejects.toThrow(/não tem imagens/);
  });

  it('foto enorme não quebra (reduzida quando o navegador permite)', async () => {
    const item = makeCarousel([0]);
    const controller = await browserLoaders.carousel(item, new Uint8Array([1, 250, 250]).buffer, { openSlide: async () => bytesFor(0) });
    const front = (controller.object as THREE.Group).children[0] as THREE.Mesh;
    expect(front.scale.x).toBeCloseTo(0.5);
    expect(front.scale.y).toBeCloseTo(0.5);
  });
});
