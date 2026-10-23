// @vitest-environment happy-dom
//
// Editor da cena num DOM SIMULADO. A prévia 3D (WebGL) e os carregadores de
// mídia do navegador são SUBSTITUÍDOS por falsos: aqui se confere a lógica das
// telas (adicionar, selecionar, ajustar, salvar, duplicar, remover, salvar ao
// sair), não a prévia nem a decodificação de arquivos reais.
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemController } from '../src/scene/types';
import { createProject } from '../src/storage/projects';
import type { ProjectRepository } from '../src/storage/repository';
import { addCarousel, addItem } from '../src/storage/scene';
import { createTrackingStore } from '../src/tracking/store';
import type { AppContext } from '../src/ui/context';
import { freshRepository, makeMind, signedBytes } from './helpers';

interface FakeStage {
  options: Record<string, any>;
  attach: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  setTool: ReturnType<typeof vi.fn>;
  focusItem: ReturnType<typeof vi.fn>;
  frameAll: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
const stages: FakeStage[] = [];
let webgl = true;
let visualGeometry = false;

vi.mock('../src/ui/previewStage', () => ({
  createPreviewStage: (options: Record<string, any>) => {
    if (!webgl) return null;
    const stage: FakeStage = { options, attach: vi.fn(), setView: vi.fn(), setTool: vi.fn(), focusItem: vi.fn(), frameAll: vi.fn(), dispose: vi.fn() };
    stages.push(stage);
    return stage;
  },
}));

const fakeController = (): ItemController => ({
  object: visualGeometry ? new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1)) : new THREE.Group(),
  blocked: false,
  needsLights: false,
  async setActive() {},
  async resume() {},
  update() {},
  setOpacity() {},
  dispose() {},
});
const { carouselLoads } = vi.hoisted(() => ({ carouselLoads: [] as number[] }));

vi.mock('../src/scene/loaders', () => ({
  browserLoaders: {
    image: async () => fakeController(),
    gif: async () => fakeController(),
    video: async () => fakeController(),
    model: async () => fakeController(),
    audio: async () => ({ ...fakeController(), object: null }),
    carousel: async (item: { slides?: unknown[] }) => {
      carouselLoads.push(item.slides?.length ?? 0);
      return fakeController();
    },
  },
}));

const { editorView } = await import('../src/ui/editorView');

const toasts: string[] = [];

async function mount(repo: ProjectRepository, projectId: string | null) {
  const navigations: string[] = [];
  const context: AppContext = {
    store: createTrackingStore(),
    getTarget: () => null,
    setTarget: () => {},
    getRepository: async () => repo,
    getEditingProject: () => projectId,
    setEditingProject: () => {},
    navigate: (name) => {
      navigations.push(name);
    },
    toast: (text) => {
      toasts.push(text);
    },
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const cleanup = editorView(context, root);
  return { root, cleanup, navigations };
}

async function ready(root: HTMLElement): Promise<void> {
  await vi.waitFor(() => {
    if (!root.querySelector('.editor-stage')) throw new Error('editor ainda não montado');
  });
}

const button = (root: HTMLElement, label: string | RegExp): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) =>
    typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''),
  );
  if (!found) throw new Error(`Botão não encontrado: ${String(label)}`);
  return found as HTMLButtonElement;
};

const slider = (root: HTMLElement, label: string): HTMLInputElement => {
  const found = root.querySelector(`input[type=range][aria-label="${label}"]`);
  if (!found) throw new Error(`Controle não encontrado: ${label}`);
  return found as HTMLInputElement;
};

function setSlider(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function chooseFiles(root: HTMLElement, files: File[], confirm = true): Promise<void> {
  const input = root.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (confirm) {
    await vi.waitFor(() => {
      if (!root.querySelector('.add-confirm-box button')) throw new Error('prévia de adição ainda não abriu');
    });
    button(root, 'Confirmar adição').click();
  }
}

const file = (name: string, mime: string, seed = 1): File => new File([signedBytes(mime, 64, seed)], name, { type: mime });

async function savedItems(repo: ProjectRepository, id: string) {
  const entry = await repo.getEntry(id);
  if (entry?.kind !== 'project') throw new Error('esperado projeto');
  return entry.record.scene.items;
}

async function newProject(repo: ProjectRepository, withItem = false) {
  const project = await createProject(repo, { name: 'Braço', anchor: makeMind() });
  const item = withItem
    ? (await addItem(repo, project.id, { file: { data: signedBytes('image/png', 64, 1), fileName: 'rosa.png' }, name: 'Rosa' })).item
    : null;
  return { project, item };
}

beforeEach(() => {
  carouselLoads.length = 0;
  stages.length = 0;
  toasts.length = 0;
  webgl = true;
  visualGeometry = false;
  document.body.replaceChildren();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('abrir o editor', () => {
  it('sem lembrança escolhida, explica e leva a "Minhas lembranças"', async () => {
    const repo = await freshRepository();
    const { root, navigations } = await mount(repo, null);
    expect(root.textContent).toMatch(/Nenhuma lembrança escolhida/);
    button(root, 'Minhas lembranças').click();
    expect(navigations).toEqual(['projects']);
  });

  it('projeto que não existe mostra o erro, sem travar', async () => {
    const repo = await freshRepository();
    const { root } = await mount(repo, 'naoexiste');
    await vi.waitFor(() => {
      if (!/não foi encontrado/.test(root.textContent ?? '')) throw new Error('sem erro ainda');
    });
    expect(root.querySelector('.editor-stage')).toBeNull();
  });

  it('projeto vazio: convida a adicionar e oferece o player do YouTube', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    expect(root.textContent).toMatch(/Adicione fotos, vídeos ou sons para começar/);
    expect(root.textContent).toMatch(/0\/100 lembranças/);
    expect(root.textContent).toMatch(/GLB/);
    expect(root.querySelector('#youtube-note')?.textContent).toMatch(/YouTube.*player incorporado/);
    expect(stages).toHaveLength(1);
    expect(stages[0]!.attach).toHaveBeenCalledTimes(1);
  });

  it('projeto com itens: lista e seleciona o primeiro, com os controles dele', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    expect(root.querySelectorAll('.item-row')).toHaveLength(1);
    expect(root.querySelector('.item-row')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toMatch(/Imagem · rosa.png/);
    expect(slider(root, 'Tamanho').value).toBe('1');
  });

  it('sem WebGL a tela segue funcionando e avisa', async () => {
    webgl = false;
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    expect(root.textContent).toMatch(/prévia 3D não está disponível/);
    setSlider(slider(root, 'Tamanho'), 2);
    expect(root.textContent).toMatch(/Alterações não salvas/);
  });
});

describe('layouts e apresentação', () => {
  it('salva movimentos no conjunto e pausa a prévia ao começar uma edição', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    await addItem(repo, project.id, { file: { data: signedBytes('image/png', 64, 8), fileName: 'azul.png', mimeType: 'image/png' } });
    const { root, cleanup } = await mount(repo, project.id);
    await ready(root);
    button(root, 'Movimentos').click();
    expect(root.querySelector('.motion-box')?.hasAttribute('hidden')).toBe(false);
    button(root, /^Flutuar/).click();
    await vi.waitFor(() => expect(root.textContent).toContain('Pausar movimentos'));
    stages.at(-1)!.options.onManipulationStart();
    stages.at(-1)!.options.onManipulationEnd();
    expect(root.textContent).toContain('Experimentar movimentos');
    button(root, 'Salvar').click();
    await vi.waitFor(async () => expect((await savedItems(repo, project.id)).every((item) => item.options.motion === 'float')).toBe(true));
    cleanup();
  });

  it('cancelar uma prévia ao trocar de aba preserva a disposição anterior', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    await addItem(repo, project.id, { file: { data: signedBytes('image/png', 64, 8), fileName: 'azul.png', mimeType: 'image/png' } });
    const { root, cleanup } = await mount(repo, project.id);
    await ready(root);
    const before = await savedItems(repo, project.id);
    button(root, 'Layouts').click();
    (root.querySelector('.layout-option') as HTMLButtonElement).click();
    expect(root.textContent).toContain('Prévia: Mural');
    expect(root.querySelector('.save-bar')?.textContent).toContain('Confirmar layout');
    expect(root.querySelector('.save-bar')?.textContent).not.toContain('Salvar');
    button(root, 'Ajustar').click();
    expect(root.textContent).not.toContain('Alterações não salvas');
    cleanup();
    expect(await savedItems(repo, project.id)).toEqual(before);
  });

  it('centraliza o selecionado ao ativar os anéis e esconde as ferramentas na aba Layouts', async () => {
    const repo = await freshRepository();
    const { project, item } = await newProject(repo, true);
    const { root, cleanup } = await mount(repo, project.id);
    await ready(root);
    (root.querySelector('button[data-tool="rotate"]') as HTMLButtonElement).click();
    expect(stages.at(-1)!.focusItem).toHaveBeenLastCalledWith(item!.id);
    expect(stages.at(-1)!.options.getShowTools()).toBe(true);
    button(root, 'Layouts').click();
    expect(stages.at(-1)!.options.getShowTools()).toBe(false);
    cleanup();
  });

  it('confirma um layout, desfaz e refaz a disposição, e centraliza a câmera', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    await addItem(repo, project.id, { file: { data: signedBytes('image/png', 64, 8), fileName: 'azul.png', mimeType: 'image/png' } });
    const { root } = await mount(repo, project.id);
    await ready(root);
    const before = (await savedItems(repo, project.id))[0]!;
    (root.querySelector('button[aria-label="Ver de perto a lembrança selecionada"]') as HTMLButtonElement).click();
    expect(stages.at(-1)?.focusItem).toHaveBeenCalledWith(before.id);
    expect(root.textContent).toContain('Reúna várias lembranças e veja tudo de uma vez.');
    (root.querySelector('.layout-option') as HTMLButtonElement).click();
    expect(root.textContent).toMatch(/Prévia: Mural/);
    button(root, 'Usar esta disposição').click();
    expect(root.textContent).toMatch(/Alterações não salvas/);
    (root.querySelector('button[aria-label="Desfazer"]') as HTMLButtonElement).click();
    expect(root.textContent).not.toMatch(/Alterações não salvas/);
    (root.querySelector('button[aria-label="Refazer"]') as HTMLButtonElement).click();
    expect(root.textContent).toMatch(/Alterações não salvas/);
  });

  it('permite iniciar o player YouTube por toque e mostra o player incorporado', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    const input = root.querySelector('input[aria-label="Link de música do YouTube"]') as HTMLInputElement;
    input.value = 'https://youtu.be/abcdefghijk';
    button(root, 'Reproduzir YouTube').click();
    const frame = root.querySelector('iframe.youtube-player') as HTMLIFrameElement;
    expect(frame).not.toBeNull();
    expect(frame.src).toContain('/embed/abcdefghijk?autoplay=1');
    button(root, 'Pausar YouTube').click();
    expect(root.querySelector('iframe.youtube-player')).toBeNull();
  });
});

describe('adicionar arquivos', () => {
  it('apoia a geometria na tatuagem e procura espaço ao adicionar vários objetos', async () => {
    visualGeometry = true;
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root, cleanup } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, [file('retrato.png', 'image/png'), file('movimento.gif', 'image/gif', 2)]);
    await vi.waitFor(async () => {
      const items = await savedItems(repo, project.id);
      expect(items).toHaveLength(2);
      expect(items[1]!.transform.position[2]).toBeCloseTo(0.5);
    });
    const items = await savedItems(repo, project.id);
    expect(items[0]!.transform.position).not.toEqual(items[1]!.transform.position);
    const runtime = stages.at(-1)!.attach.mock.calls[0]![0];
    const object = runtime.rootOf(items[1]!.id);
    object.updateWorldMatrix(true, true);
    expect(new THREE.Box3().setFromObject(object).min.z).toBeGreaterThanOrEqual(-1e-9);
    setSlider(slider(root, 'Tamanho'), 2);
    object.updateWorldMatrix(true, true);
    expect(new THREE.Box3().setFromObject(object).min.z).toBeGreaterThanOrEqual(-1e-9);
    cleanup();
  });

  it('mostra a prévia inicial e permite cancelar sem gravar', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, [file('rosa.png', 'image/png')], false);
    const preview = root.querySelector('.add-confirm-box') as HTMLElement;
    expect(preview.hidden).toBe(false);
    expect(preview.textContent).toMatch(/centro do alvo/);
    expect(preview.querySelector('img')).not.toBeNull();
    expect(await savedItems(repo, project.id)).toHaveLength(0);
    button(root, 'Cancelar').click();
    expect(preview.hidden).toBe(true);
    expect(await savedItems(repo, project.id)).toHaveLength(0);
  });

  it('grava no armazenamento, seleciona o novo item e o coloca na cena', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);

    await chooseFiles(root, [file('rosa.png', 'image/png'), file('bicho.glb', 'model/gltf-binary', 2)]);
    await vi.waitFor(async () => {
      if ((await savedItems(repo, project.id)).length !== 2) throw new Error('ainda não');
    });
    const items = await savedItems(repo, project.id);
    expect(items.map((i) => i.type)).toEqual(['image', 'model']);
    expect(items[0]!.transform.position).toEqual([0, 0, 0]);
    expect(items[0]!.transform.rotation).toEqual([90, 0, 0]);
    expect(items[1]!.transform.position).toEqual([0, 0, 0]);
    expect(items[1]!.transform.rotation).toEqual([0, 0, 0]);
    await vi.waitFor(() => {
      if (root.querySelectorAll('.item-row').length !== 2) throw new Error('lista ainda não atualizou');
    });
    expect(root.querySelectorAll('.item-row')[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toMatch(/Modelo 3D · bicho.glb/);
    expect(root.textContent).toMatch(/2\/100 lembranças/);
  });

  it('formato não suportado aparece como erro e não impede os outros arquivos', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);

    await chooseFiles(root, [new File([new Uint8Array(32)], 'clipe.mov', { type: 'video/quicktime' }), file('ok.png', 'image/png')]);
    await vi.waitFor(() => {
      if (!/clipe\.mov/.test(root.textContent ?? '')) throw new Error('sem erro ainda');
    });
    expect(root.textContent).toMatch(/Converta para MP4 ou WebM/);
    expect((await savedItems(repo, project.id)).map((i) => i.file.fileName)).toEqual(['ok.png']);
  });

  it('arquivo com extensão trocada é recusado', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, [new File([signedBytes('image/png')], 'falso.glb', { type: '' })]);
    await vi.waitFor(() => {
      if (!/não corresponde/.test(root.textContent ?? '')) throw new Error('sem erro ainda');
    });
    expect(await savedItems(repo, project.id)).toEqual([]);
  });

  it('ajustes pendentes são salvos antes de adicionar, para não se perderem', async () => {
    const repo = await freshRepository();
    const { project, item } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    setSlider(slider(root, 'Tamanho'), 3);
    await chooseFiles(root, [file('outro.png', 'image/png', 5)]);
    await vi.waitFor(async () => {
      if ((await savedItems(repo, project.id)).length !== 2) throw new Error('ainda não');
    });
    const items = await savedItems(repo, project.id);
    expect(items.find((i) => i.id === item!.id)!.transform.scale).toBe(3);
  });
});

describe('ajustar e salvar', () => {
  it('mexer num controle mostra "não salvas"; Salvar grava e volta a "Tudo salvo"', async () => {
    const repo = await freshRepository();
    const { project, item } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    expect(root.querySelector('.save-bar')?.textContent).toMatch(/Tudo salvo/);

    setSlider(slider(root, 'Posição horizontal'), 0.25);
    setSlider(slider(root, 'Giro (no plano do item)'), 45);
    setSlider(slider(root, 'Opacidade'), 0.5);
    expect(root.querySelector('.save-bar')?.textContent).toMatch(/Alterações não salvas/);
    expect((await savedItems(repo, project.id))[0]!.transform.position[0]).toBe(0); // ainda não gravou

    button(root, 'Salvar').click();
    await vi.waitFor(() => {
      if (!/Tudo salvo/.test(root.querySelector('.save-bar')?.textContent ?? '')) throw new Error('ainda não');
    });
    const [saved] = await savedItems(repo, project.id);
    expect(saved!.id).toBe(item!.id);
    expect(saved!.transform.position[0]).toBe(0.25);
    expect(saved!.transform.rotation[2]).toBe(45);
    expect(saved!.options.opacity).toBe(0.5);
    expect(root.textContent).toMatch(/Ajustes salvos/);
  });

  it('o valor mostrado acompanha o controle', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    setSlider(slider(root, 'Tamanho'), 2.5);
    expect(root.querySelector('.slider-value')?.parentElement?.textContent).toBeDefined();
    expect((root.querySelector('input[aria-label="Tamanho valor"]') as HTMLInputElement).value).toBe('2,5');
    expect([...root.querySelectorAll('output')].some((o) => o.textContent === '×')).toBe(true);
  });

  it('permite digitar um valor preciso e desfazer a edição', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    const numeric = root.querySelector('input[aria-label="Tamanho valor"]') as HTMLInputElement;
    numeric.value = '2,75';
    numeric.dispatchEvent(new Event('change', { bubbles: true }));
    expect(slider(root, 'Tamanho').value).toBe('2.75');
    (root.querySelector('button[aria-label="Desfazer"]') as HTMLButtonElement).click();
    expect(slider(root, 'Tamanho').value).toBe('1');
  });

  it('arrastar na prévia move o item, atualiza os controles e fica como alteração pendente', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    stages[0]!.options.onDrag((await savedItems(repo, project.id))[0]!.id, 0.31, -0.12);
    expect(slider(root, 'Posição horizontal').value).toBe('0.31');
    expect(slider(root, 'Posição vertical').value).toBe('-0.12');
    expect(root.querySelector('.save-bar')?.textContent).toMatch(/não salvas/);
  });

  it('as setas movem o item de 1 em 1% (0,2% com passo fino) e centralizar zera', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    const x = (): number => Number(slider(root, 'Posição horizontal').value);
    const y = (): number => Number(slider(root, 'Posição vertical').value);

    (root.querySelector('button[aria-label="Mover para a direita"]') as HTMLButtonElement).click();
    expect(x()).toBeCloseTo(0.01, 6);
    (root.querySelector('button[aria-label="Mover para cima"]') as HTMLButtonElement).click();
    expect(y()).toBeCloseTo(0.01, 6);

    button(root, 'Passo fino').click();
    (root.querySelector('button[aria-label="Mover para a direita"]') as HTMLButtonElement).click();
    expect(x()).toBeCloseTo(0.012, 6);

    button(root, 'Centralizar').click();
    expect(x()).toBe(0);
    expect(y()).toBe(0);
    expect(root.querySelector('.save-bar')?.textContent).toMatch(/Tudo salvo/); // voltou ao que está salvo
  });

  it('os botões + e − mudam o tamanho em passos e respeitam os limites', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    (root.querySelector('button[aria-label="Aumentar Tamanho"]') as HTMLButtonElement).click();
    expect(slider(root, 'Tamanho').value).toBe('1.02');
    (root.querySelector('button[aria-label="Diminuir Tamanho"]') as HTMLButtonElement).click();
    (root.querySelector('button[aria-label="Diminuir Tamanho"]') as HTMLButtonElement).click();
    expect(slider(root, 'Tamanho').value).toBe('0.98');
  });

  it('desfazer e refazer: ajustes seguidos valem como um só; depois de uma pausa, outro', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const repo = await freshRepository();
      const { project } = await newProject(repo, true);
      const { root } = await mount(repo, project.id);
      await ready(root);
      const undo = root.querySelector('button[aria-label="Desfazer"]') as HTMLButtonElement;
      const redo = root.querySelector('button[aria-label="Refazer"]') as HTMLButtonElement;
      expect(undo.disabled).toBe(true);
      expect(redo.disabled).toBe(true);

      setSlider(slider(root, 'Tamanho'), 1.5);
      vi.setSystemTime(Date.now() + 100);
      setSlider(slider(root, 'Tamanho'), 2); // mesmo gesto
      expect(undo.disabled).toBe(false);

      vi.setSystemTime(Date.now() + 2000); // pausa
      setSlider(slider(root, 'Tamanho'), 3); // outro ajuste

      undo.click();
      expect(slider(root, 'Tamanho').value).toBe('2');
      expect(redo.disabled).toBe(false);
      undo.click();
      expect(slider(root, 'Tamanho').value).toBe('1');
      expect(undo.disabled).toBe(true);
      redo.click();
      expect(slider(root, 'Tamanho').value).toBe('2');
      redo.click();
      expect(slider(root, 'Tamanho').value).toBe('3');
    } finally {
      vi.useRealTimers();
    }
  });

  it('um ajuste novo depois de desfazer descarta o "refazer"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const repo = await freshRepository();
      const { project } = await newProject(repo, true);
      const { root } = await mount(repo, project.id);
      await ready(root);
      const undo = root.querySelector('button[aria-label="Desfazer"]') as HTMLButtonElement;
      const redo = root.querySelector('button[aria-label="Refazer"]') as HTMLButtonElement;
      setSlider(slider(root, 'Tamanho'), 2);
      undo.click();
      expect(redo.disabled).toBe(false);
      vi.setSystemTime(Date.now() + 2000);
      setSlider(slider(root, 'Tamanho'), 1.4);
      expect(redo.disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('girar com dois dedos muda o giro do item selecionado, sincroniza o controle e vira alteração', async () => {
    const repo = await freshRepository();
    const { project, item } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    const options = stages[0]!.options;
    expect(options.getRotationZ(item!.id)).toBe(0);

    options.onRotate(item!.id, 35);
    expect(options.getRotationZ(item!.id)).toBe(35);
    expect(slider(root, 'Giro (no plano do item)').value).toBe('35');
    expect(root.querySelector('.save-bar')?.textContent).toMatch(/não salvas/);

    button(root, 'Salvar').click();
    await vi.waitFor(async () => {
      if ((await savedItems(repo, project.id))[0]!.transform.rotation[2] !== 35) throw new Error('ainda não');
    });
  });

  it('a pinça muda o tamanho do item selecionado, com limites, e áudio não muda', async () => {
    const repo = await freshRepository();
    const { project, item } = await newProject(repo, true);
    const audio = await addItem(repo, project.id, { file: { data: signedBytes('audio/mpeg'), fileName: 'a.mp3' } });
    const { root } = await mount(repo, project.id);
    await ready(root);
    const options = stages[0]!.options;
    expect(options.getScale(item!.id)).toBe(1);
    options.onScale(item!.id, 2.5);
    expect(options.getScale(item!.id)).toBe(2.5);
    expect(slider(root, 'Tamanho').value).toBe('2.5');
    options.onScale(item!.id, 99);
    expect(options.getScale(item!.id)).toBe(5);
    options.onScale(item!.id, 0);
    expect(options.getScale(item!.id)).toBe(0.05);
    expect(options.getScale(audio.item.id)).toBeNull();
    expect(root.textContent).toMatch(/mudar o tamanho/);
  });

  it('o giro por gesto respeita os limites e áudio não gira', async () => {
    const repo = await freshRepository();
    const { project, item } = await newProject(repo, true);
    const audio = await addItem(repo, project.id, { file: { data: signedBytes('audio/mpeg'), fileName: 'a.mp3' } });
    const { root } = await mount(repo, project.id);
    await ready(root);
    const options = stages[0]!.options;
    options.onRotate(item!.id, 400);
    expect(options.getRotationZ(item!.id)).toBe(180);
    expect(options.getRotationZ(audio.item.id)).toBeNull();
    options.onRotate(audio.item.id, 10);
    expect(root.querySelector('.save-bar')?.textContent).toMatch(/não salvas/); // só pelo item de imagem
    expect(root.textContent).toMatch(/dois dedos sobre a prévia/);
  });

  it('tocar num item na prévia seleciona; tocar no vazio desmarca', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    stages[0]!.options.onSelect(null);
    expect(root.querySelector('.item-row')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('.editor-panel')?.textContent).toMatch(/Toque numa lembrança/);
    stages[0]!.options.onSelect((await savedItems(repo, project.id))[0]!.id);
    expect(root.querySelector('.item-row')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('Desfazer alterações volta ao último salvamento', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    setSlider(slider(root, 'Tamanho'), 4);
    button(root, 'Desfazer alterações').click();
    expect(slider(root, 'Tamanho').value).toBe('1');
    expect(root.querySelector('.save-bar')?.textContent).toMatch(/Tudo salvo/);
  });

  it('renomear e ocultar entram nas alterações e ficam salvos', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    const name = root.querySelector('input[aria-label="Nome do item"]') as HTMLInputElement;
    name.value = '  Rosa   vermelha ';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    const visible = [...root.querySelectorAll('label.check-row')].find((l) => /Mostrar na câmera/.test(l.textContent ?? ''))!.querySelector('input')!;
    visible.checked = false;
    visible.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.querySelector('.item-row')?.textContent).toMatch(/Rosa vermelha.*oculto/);

    button(root, 'Salvar').click();
    await vi.waitFor(async () => {
      if ((await savedItems(repo, project.id))[0]!.name !== 'Rosa vermelha') throw new Error('ainda não');
    });
    expect((await savedItems(repo, project.id))[0]!.visible).toBe(false);
  });

  it('nome vazio é recusado e volta ao anterior', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    const name = root.querySelector('input[aria-label="Nome do item"]') as HTMLInputElement;
    name.value = '   ';
    name.dispatchEvent(new Event('change', { bubbles: true }));
    expect(name.value).toBe('Rosa');
    expect(root.querySelector('.save-bar')?.textContent).toMatch(/Tudo salvo/);
  });

  it('"Restaurar posição" zera a transformação mas mantém as opções', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    setSlider(slider(root, 'Tamanho'), 3);
    setSlider(slider(root, 'Opacidade'), 0.4);
    button(root, 'Restaurar posição').click();
    expect(slider(root, 'Tamanho').value).toBe('1');
    expect(slider(root, 'Opacidade').value).toBe('0.4');
  });

  it('opções por tipo: vídeo e áudio têm volume; vídeo com som avisa do toque', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    await addItem(repo, project.id, { file: { data: signedBytes('video/mp4'), fileName: 'v.mp4' } });
    await addItem(repo, project.id, { file: { data: signedBytes('audio/mpeg'), fileName: 'a.mp3' } });
    const { root } = await mount(repo, project.id);
    await ready(root);
    expect(slider(root, 'Volume')).toBeDefined(); // primeiro item: vídeo
    expect(root.textContent).not.toMatch(/pedir um toque/);
    const muted = [...root.querySelectorAll('label.check-row')].find((l) => /Começar sem som/.test(l.textContent ?? ''))!.querySelector('input')!;
    muted.checked = false;
    muted.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.textContent).toMatch(/pedir um toque/);

    (root.querySelectorAll('.item-row')[1] as HTMLElement).click();
    expect(root.querySelector('input[aria-label="Posição horizontal"]')).toBeNull(); // áudio não tem posição
    expect(slider(root, 'Volume')).toBeDefined();
  });
});

describe('duplicar e remover', () => {
  it('duplicar cria uma cópia salva e a seleciona', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    button(root, 'Fazer cópia').click();
    await vi.waitFor(async () => {
      if ((await savedItems(repo, project.id)).length !== 2) throw new Error('ainda não');
    });
    const items = await savedItems(repo, project.id);
    expect(items[1]!.name).toBe('Rosa (cópia)');
    await vi.waitFor(() => {
      if (root.querySelectorAll('.item-row').length !== 2) throw new Error('lista ainda não atualizou');
    });
    expect(root.querySelectorAll('.item-row')[1]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('remover pede confirmação; cancelar não apaga; confirmar apaga item e arquivo', async () => {
    const repo = await freshRepository();
    const { project, item } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);

    button(root, 'Remover').click();
    expect(root.textContent).toMatch(/Remover "Rosa"\?/);
    button(root, 'Cancelar').click();
    expect(await savedItems(repo, project.id)).toHaveLength(1);

    button(root, 'Remover').click();
    button(root, 'Remover definitivamente').click();
    await vi.waitFor(async () => {
      if ((await savedItems(repo, project.id)).length !== 0) throw new Error('ainda não');
    });
    expect(await repo.getFile(project.id, `item:${item!.id}`)).toBeNull();
    await vi.waitFor(() => {
      if (root.querySelectorAll('.item-row').length !== 0) throw new Error('lista ainda não atualizou');
    });
    expect(root.querySelector('.editor-panel')?.textContent).toMatch(/Adicione fotos, vídeos ou sons/);
  });
});

describe('sair da tela', () => {
  it('ajustes pendentes são salvos sozinhos e a prévia é liberada', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root, cleanup } = await mount(repo, project.id);
    await ready(root);
    setSlider(slider(root, 'Tamanho'), 2);
    cleanup();
    expect(stages[0]!.dispose).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => {
      if ((await savedItems(repo, project.id))[0]!.transform.scale !== 2) throw new Error('ainda não');
    });
    await vi.waitFor(() => {
      if (!toasts.includes('Ajustes da cena salvos.')) throw new Error('sem aviso ainda');
    });
  });

  it('sem alterações, sair não grava nada', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const before = (await repo.getEntry(project.id)) as any;
    const { root, cleanup } = await mount(repo, project.id);
    await ready(root);
    cleanup();
    await new Promise((r) => setTimeout(r, 20));
    expect(toasts).toEqual([]);
    expect(((await repo.getEntry(project.id)) as any).record.updatedAt).toBe(before.record.updatedAt);
  });

  it('desfazer antes de sair não deixa nada para salvar', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root, cleanup } = await mount(repo, project.id);
    await ready(root);
    setSlider(slider(root, 'Tamanho'), 2);
    button(root, 'Desfazer alterações').click();
    cleanup();
    await new Promise((r) => setTimeout(r, 20));
    expect(toasts).toEqual([]);
    expect((await savedItems(repo, project.id))[0]!.transform.scale).toBe(1);
  });
});

describe('vistas da prévia', () => {
  it('os botões trocam a vista e marcam a ativa', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    expect(button(root, 'Inclinada').getAttribute('aria-pressed')).toBe('true');
    button(root, 'Inclinada').click();
    expect(stages[0]!.setView).toHaveBeenLastCalledWith('tilted');
    expect(button(root, 'Inclinada').getAttribute('aria-pressed')).toBe('true');
    expect(button(root, 'De frente').getAttribute('aria-pressed')).toBe('false');
  });

  it('"Reproduzir prévia" alterna o rótulo', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    button(root, 'Reproduzir prévia').click();
    expect(button(root, 'Pausar prévia')).toBeDefined();
  });
});

// ------------------------------------------------------------------ carrossel

const pngs = (n: number, from = 1): File[] =>
  Array.from({ length: n }, (_, i) => file(`foto${from + i}.png`, 'image/png', from + i));

async function waitForItems(repo: ProjectRepository, id: string, count: number): Promise<void> {
  await vi.waitFor(async () => {
    if ((await savedItems(repo, id)).length !== count) throw new Error('ainda não');
  });
}

describe('carrossel no editor', () => {
  it('uma imagem só vira item comum, sem perguntar nada', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, pngs(1));
    await waitForItems(repo, project.id, 1);
    expect((await savedItems(repo, project.id))[0]?.type).toBe('image');
    expect(root.querySelector('.choice-box')?.hasAttribute('hidden')).toBe(true);
  });

  it('duas ou mais imagens perguntam; nada é gravado antes da resposta', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, pngs(3));
    const box = root.querySelector('.choice-box') as HTMLElement;
    await vi.waitFor(() => {
      if (box.hidden) throw new Error('sem pergunta');
    });
    expect(box.textContent).toMatch(/3 fotos/);
    expect(await savedItems(repo, project.id)).toHaveLength(0);
  });

  it('"Carrossel automático" cria um item com as imagens na ordem escolhida e o seleciona', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, pngs(3));
    button(root, 'Criar sequência automática').click();
    await waitForItems(repo, project.id, 1);
    const [item] = await savedItems(repo, project.id);
    expect(item?.type).toBe('carousel');
    expect(item?.slides?.map((s) => s.fileName)).toEqual(['foto1.png', 'foto2.png', 'foto3.png']);
    await vi.waitFor(() => {
      if (!/Carrossel · 3 imagens/.test(root.textContent ?? '')) throw new Error('painel ainda não mostra');
    });
    expect((root.querySelector('.choice-box') as HTMLElement).hidden).toBe(true);
    expect(root.querySelectorAll('.item-row')[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('.slide-row')).toHaveLength(3);
    // entrou na cena da prévia
    const runtime = stages[0]!.attach.mock.calls[0]![0];
    await vi.waitFor(() => {
      if (runtime.summary().ready !== 1) throw new Error('carrossel não carregou na prévia');
    });
  });

  it('"Guardar como lembranças" cria um item por foto', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, pngs(3));
    button(root, 'Guardar como 3 lembranças').click();
    await waitForItems(repo, project.id, 3);
    expect((await savedItems(repo, project.id)).map((i) => i.type)).toEqual(['image', 'image', 'image']);
  });

  it('Cancelar descarta a escolha sem gravar', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, pngs(2));
    button(root, 'Cancelar').click();
    expect((root.querySelector('.choice-box') as HTMLElement).hidden).toBe(true);
    expect(await savedItems(repo, project.id)).toHaveLength(0);
  });

  it('numa seleção mista, os outros arquivos entram na hora e só as imagens esperam a resposta', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, [...pngs(2), file('bicho.glb', 'model/gltf-binary', 9)]);
    await waitForItems(repo, project.id, 1);
    expect((await savedItems(repo, project.id))[0]?.type).toBe('model');
    expect((root.querySelector('.choice-box') as HTMLElement).hidden).toBe(false);
  });

  it('GIFs não entram na pergunta: dois GIFs viram dois itens', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, [file('a.gif', 'image/gif', 1), file('b.gif', 'image/gif', 2)]);
    await waitForItems(repo, project.id, 2);
    expect((root.querySelector('.choice-box') as HTMLElement).hidden).toBe(true);
  });

  it('imagens demais para um carrossel mostram o erro e não criam nada', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    await chooseFiles(root, pngs(31));
    button(root, 'Criar sequência automática').click();
    await vi.waitFor(() => {
      if (!/no máximo 30 imagens/.test(root.textContent ?? '')) throw new Error('sem erro');
    });
    expect(await savedItems(repo, project.id)).toHaveLength(0);
  });

  async function withCarousel(count = 3) {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    await addCarousel(repo, project.id, {
      files: Array.from({ length: count }, (_, i) => ({ data: signedBytes('image/png', 64, i + 1), fileName: `s${i + 1}.png` })),
      name: 'Flores',
    });
    const view = await mount(repo, project.id);
    await ready(view.root);
    return { repo, project, ...view };
  }

  it('o painel mostra intervalo, transição e a lista de imagens; item comum não mostra', async () => {
    const { root } = await withCarousel();
    expect(slider(root, 'Tempo de cada imagem').value).toBe('3');
    expect(root.textContent).toMatch(/Imagens \(3\/30\)/);
    expect(root.textContent).toMatch(/Transição suave entre as imagens/);
    expect(root.querySelectorAll('.slide-row')).toHaveLength(3);
  });

  it('mudar intervalo e transição entra nas alterações e fica salvo', async () => {
    const { repo, project, root } = await withCarousel();
    setSlider(slider(root, 'Tempo de cada imagem'), 7.5);
    const fade = [...root.querySelectorAll('label.check-row')].find((l) => /Transição suave/.test(l.textContent ?? ''))!.querySelector('input')!;
    fade.checked = false;
    fade.dispatchEvent(new Event('change', { bubbles: true }));
    expect(root.textContent).toMatch(/Alterações não salvas/);
    button(root, 'Salvar').click();
    await vi.waitFor(async () => {
      const [item] = await savedItems(repo, project.id);
      if (item?.options.intervalMs !== 7500) throw new Error('ainda não');
    });
    expect((await savedItems(repo, project.id))[0]?.options).toMatchObject({ intervalMs: 7500, fade: false });
  });

  it('remover uma imagem apaga o arquivo, atualiza a lista e recarrega o item na prévia', async () => {
    const { repo, project, root } = await withCarousel();
    const runtime = stages[0]!.attach.mock.calls[0]![0];
    await vi.waitFor(() => {
      if (runtime.summary().ready !== 1) throw new Error('não carregou');
    });
    (root.querySelector('button[aria-label="Remover a imagem 2"]') as HTMLButtonElement).click();
    await vi.waitFor(async () => {
      if (((await savedItems(repo, project.id))[0]?.slides?.length ?? 0) !== 2) throw new Error('ainda não');
    });
    expect((await savedItems(repo, project.id))[0]?.slides?.map((s) => s.fileName)).toEqual(['s1.png', 's3.png']);
    await vi.waitFor(() => {
      if (root.querySelectorAll('.slide-row').length !== 2) throw new Error('lista não atualizou');
    });
    await vi.waitFor(() => {
      if (runtime.summary().ready !== 1) throw new Error('item não voltou à prévia');
    });
    // a prévia carregou o carrossel de novo, agora com 2 imagens
    expect(carouselLoads).toEqual([3, 2]);
  });

  it('com uma imagem só, o botão Remover fica desativado', async () => {
    const { root } = await withCarousel(1);
    expect((root.querySelector('button[aria-label="Remover a imagem 1"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Adicionar imagens" acrescenta ao fim do carrossel', async () => {
    const { repo, project, root } = await withCarousel(2);
    const input = root.querySelector('input[aria-label="Adicionar fotos a esta sequência de lembranças"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: pngs(2, 10), configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(async () => {
      if (((await savedItems(repo, project.id))[0]?.slides?.length ?? 0) !== 4) throw new Error('ainda não');
    });
    expect((await savedItems(repo, project.id))[0]?.slides?.map((s) => s.fileName)).toEqual(['s1.png', 's2.png', 'foto10.png', 'foto11.png']);
  });

  it('ajustes pendentes são salvos antes de mexer nas imagens', async () => {
    const { repo, project, root } = await withCarousel(3);
    setSlider(slider(root, 'Tempo de cada imagem'), 12);
    (root.querySelector('button[aria-label="Remover a imagem 1"]') as HTMLButtonElement).click();
    await vi.waitFor(async () => {
      if (((await savedItems(repo, project.id))[0]?.slides?.length ?? 0) !== 2) throw new Error('ainda não');
    });
    expect((await savedItems(repo, project.id))[0]?.options.intervalMs).toBe(12000);
  });

  it('criar um carrossel salva antes os ajustes pendentes de outros itens', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    setSlider(slider(root, 'Tamanho'), 2);
    await chooseFiles(root, pngs(2, 20));
    button(root, 'Criar sequência automática').click();
    await waitForItems(repo, project.id, 2);
    expect((await savedItems(repo, project.id))[0]?.transform.scale).toBe(2);
  });

  it('duplicar copia o carrossel inteiro', async () => {
    const { repo, project, root } = await withCarousel(3);
    button(root, 'Fazer cópia').click();
    await waitForItems(repo, project.id, 2);
    const items = await savedItems(repo, project.id);
    expect(items[1]?.slides).toHaveLength(3);
    expect(items[1]?.id).not.toBe(items[0]?.id);
  });
});
