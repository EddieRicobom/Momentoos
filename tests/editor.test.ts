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
import { addItem } from '../src/storage/scene';
import { createTrackingStore } from '../src/tracking/store';
import type { AppContext } from '../src/ui/context';
import { freshRepository, makeMind, signedBytes } from './helpers';

interface FakeStage {
  options: Record<string, any>;
  attach: ReturnType<typeof vi.fn>;
  setView: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}
const stages: FakeStage[] = [];
let webgl = true;

vi.mock('../src/ui/previewStage', () => ({
  createPreviewStage: (options: Record<string, any>) => {
    if (!webgl) return null;
    const stage: FakeStage = { options, attach: vi.fn(), setView: vi.fn(), dispose: vi.fn() };
    stages.push(stage);
    return stage;
  },
}));

const fakeController = (): ItemController => ({
  object: new THREE.Group(),
  blocked: false,
  needsLights: false,
  async setActive() {},
  async resume() {},
  update() {},
  setOpacity() {},
  dispose() {},
});
vi.mock('../src/scene/loaders', () => ({
  browserLoaders: {
    image: async () => fakeController(),
    gif: async () => fakeController(),
    video: async () => fakeController(),
    model: async () => fakeController(),
    audio: async () => ({ ...fakeController(), object: null }),
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

async function chooseFiles(root: HTMLElement, files: File[]): Promise<void> {
  const input = root.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
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
  stages.length = 0;
  toasts.length = 0;
  webgl = true;
  document.body.replaceChildren();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('abrir o editor', () => {
  it('sem projeto escolhido, explica e leva a "Meus projetos"', async () => {
    const repo = await freshRepository();
    const { root, navigations } = await mount(repo, null);
    expect(root.textContent).toMatch(/Nenhum projeto escolhido/);
    button(root, 'Meus projetos').click();
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

  it('projeto vazio: convida a adicionar, mostra os formatos e o aviso do YouTube', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo);
    const { root } = await mount(repo, project.id);
    await ready(root);
    expect(root.textContent).toMatch(/Adicione arquivos para começar/);
    expect(root.textContent).toMatch(/0\/100 itens/);
    expect(root.textContent).toMatch(/GLB/);
    expect(root.querySelector('#youtube-note')?.textContent).toMatch(/YouTube.*não são suportados/);
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

describe('adicionar arquivos', () => {
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
    await vi.waitFor(() => {
      if (root.querySelectorAll('.item-row').length !== 2) throw new Error('lista ainda não atualizou');
    });
    expect(root.querySelectorAll('.item-row')[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toMatch(/Modelo 3D · bicho.glb/);
    expect(root.textContent).toMatch(/2\/100 itens/);
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
    expect([...root.querySelectorAll('output')].some((o) => o.textContent === '2,50 ×')).toBe(true);
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
    expect(root.querySelector('.editor-panel')?.textContent).toMatch(/Toque num item/);
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
    button(root, 'Duplicar').click();
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
    expect(root.querySelector('.editor-panel')?.textContent).toMatch(/Adicione arquivos/);
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
    expect(button(root, 'De frente').getAttribute('aria-pressed')).toBe('true');
    button(root, 'Inclinada').click();
    expect(stages[0]!.setView).toHaveBeenLastCalledWith('tilted');
    expect(button(root, 'Inclinada').getAttribute('aria-pressed')).toBe('true');
    expect(button(root, 'De frente').getAttribute('aria-pressed')).toBe('false');
  });

  it('"Reproduzir mídia" alterna o rótulo', async () => {
    const repo = await freshRepository();
    const { project } = await newProject(repo, true);
    const { root } = await mount(repo, project.id);
    await ready(root);
    button(root, 'Reproduzir mídia').click();
    expect(button(root, 'Pausar mídia')).toBeDefined();
  });
});
