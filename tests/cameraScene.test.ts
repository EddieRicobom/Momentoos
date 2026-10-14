// @vitest-environment happy-dom
//
// A tela da câmera lendo a cena do projeto salvo. O ArSession (MindAR + WebGL) é
// SUBSTITUÍDO por um falso que só guarda as opções recebidas: aqui se confere o
// que a tela entrega a ele e como reage; câmera, rastreio e desenho não rodam.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { RuntimeSummary } from '../src/scene/runtime';
import { createProject } from '../src/storage/projects';
import { addCarousel, addItem, updateItem } from '../src/storage/scene';
import type { ProjectRepository } from '../src/storage/repository';
import { createTrackingStore } from '../src/tracking/store';
import type { AppContext, AppTarget } from '../src/ui/context';
import { freshRepository, makeMind, signedBytes } from './helpers';

interface FakeSession {
  options: Record<string, any>;
  setTestObjectVisible: Mock<(visible: boolean) => void>;
  resumeMedia: Mock<() => Promise<void>>;
  stop: Mock<() => void>;
}
const sessions: FakeSession[] = [];

vi.mock('../src/tracking/camera', () => ({ probeCamera: vi.fn(async () => ({ ok: true })) }));
vi.mock('../src/tracking/arSession', () => ({
  ArSession: class {
    fake: FakeSession;
    constructor(options: Record<string, any>) {
      this.fake = { options, setTestObjectVisible: vi.fn(), resumeMedia: vi.fn(async () => {}), stop: vi.fn() };
      sessions.push(this.fake);
    }
    async start() {}
    stop() {
      this.fake.stop();
    }
    setTestObjectVisible(v: boolean) {
      this.fake.setTestObjectVisible(v);
    }
    resumeMedia() {
      return this.fake.resumeMedia();
    }
  },
}));

const { cameraView } = await import('../src/ui/cameraView');

function target(projectId: string | null): AppTarget {
  return {
    buffer: makeMind(),
    width: 640,
    height: 480,
    origin: 'project',
    label: 'Teste',
    previewUrl: null,
    compileMs: null,
    projectId,
    referenceImage: null,
  };
}

async function mount(appTarget: AppTarget, getRepository: () => Promise<ProjectRepository>) {
  const context: AppContext = {
    store: createTrackingStore(),
    getTarget: () => appTarget,
    setTarget: () => {},
    getRepository,
    getEditingProject: () => null,
    setEditingProject: () => {},
    navigate: () => {},
    toast: () => {},
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const cleanup = cameraView(context, root);
  await vi.waitFor(() => {
    if (sessions.length === 0) throw new Error('sessão ainda não criada');
  });
  return { root, cleanup };
}

const button = (root: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`Botão não encontrado: ${label}`);
  return found as HTMLButtonElement;
};

beforeEach(() => {
  sessions.length = 0;
  document.body.replaceChildren();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('câmera com a cena do projeto', () => {
  it('sem projeto salvo: nenhum item e só a moldura de teste', async () => {
    const repo = await freshRepository();
    const { root, cleanup } = await mount(target(null), async () => repo);
    const options = sessions[0]!.options;
    expect(options.sceneItems).toEqual([]);
    expect(options.showTestObject).toBe(true);
    expect(options.openItemFile).toBeUndefined();
    expect(button(root, 'Moldura de teste').hidden).toBe(true);
    cleanup();
  });

  it('projeto sem itens: também só a moldura', async () => {
    const repo = await freshRepository();
    const project = await createProject(repo, { name: 'Vazio', anchor: makeMind() });
    const { cleanup } = await mount(target(project.id), async () => repo);
    expect(sessions[0]!.options.sceneItems).toEqual([]);
    expect(sessions[0]!.options.showTestObject).toBe(true);
    cleanup();
  });

  it('entrega só os itens visíveis e com arquivo, abre os bytes pelo armazenamento e esconde a moldura', async () => {
    const repo = await freshRepository();
    const project = await createProject(repo, { name: 'Cena', anchor: makeMind() });
    const a = await addItem(repo, project.id, { file: { data: signedBytes('image/png', 80, 1), fileName: 'a.png' } });
    const b = await addItem(repo, project.id, { file: { data: signedBytes('image/png', 80, 2), fileName: 'b.png' } });
    const c = await addItem(repo, project.id, { file: { data: signedBytes('image/png', 80, 3), fileName: 'c.png' } });
    await updateItem(repo, project.id, b.item.id, { visible: false });
    await repo.save((await repo.getEntry(project.id) as any).record, { [`item:${c.item.id}`]: null });

    const { root, cleanup } = await mount(target(project.id), async () => repo);
    const options = sessions[0]!.options;
    expect(options.sceneItems.map((i: { id: string }) => i.id)).toEqual([a.item.id]);
    expect(options.showTestObject).toBe(false);
    const bytes = new Uint8Array(await options.openItemFile(a.item.id));
    expect(bytes).toEqual(new Uint8Array(signedBytes('image/png', 80, 1)));
    expect(root.textContent).toMatch(/1 item\(ns\) sem arquivo/);
    cleanup();
  });

  it('carrossel: entrega o item e abre cada imagem pelo slot; carrossel com imagem faltando é ignorado', async () => {
    const repo = await freshRepository();
    const project = await createProject(repo, { name: 'Cena', anchor: makeMind() });
    const good = await addCarousel(repo, project.id, {
      files: [
        { data: signedBytes('image/png', 80, 1), fileName: 'a.png' },
        { data: signedBytes('image/png', 80, 2), fileName: 'b.png' },
      ],
    });
    const broken = await addCarousel(repo, project.id, {
      files: [
        { data: signedBytes('image/png', 80, 3), fileName: 'c.png' },
        { data: signedBytes('image/png', 80, 4), fileName: 'd.png' },
      ],
    });
    await repo.save((await repo.getEntry(project.id) as any).record, { [`item:${broken.item.id}~1`]: null });

    const { root, cleanup } = await mount(target(project.id), async () => repo);
    const options = sessions[0]!.options;
    expect(options.sceneItems.map((i: { id: string }) => i.id)).toEqual([good.item.id]);
    expect(new Uint8Array(await options.openSlideFile(good.item.id, 1))).toEqual(new Uint8Array(signedBytes('image/png', 80, 2)));
    expect(new Uint8Array(await options.openItemFile(good.item.id))).toEqual(new Uint8Array(signedBytes('image/png', 80, 1)));
    expect(root.textContent).toMatch(/1 item\(ns\) sem arquivo/);
    cleanup();
  });

  it('o botão "Moldura de teste" liga e desliga a moldura na sessão', async () => {
    const repo = await freshRepository();
    const project = await createProject(repo, { name: 'Cena', anchor: makeMind() });
    await addItem(repo, project.id, { file: { data: signedBytes('image/png'), fileName: 'a.png' } });
    const { root, cleanup } = await mount(target(project.id), async () => repo);
    const frame = button(root, 'Moldura de teste');
    expect(frame.hidden).toBe(false);
    expect(frame.getAttribute('aria-pressed')).toBe('false');
    frame.click();
    expect(sessions[0]!.setTestObjectVisible).toHaveBeenLastCalledWith(true);
    expect(frame.getAttribute('aria-pressed')).toBe('true');
    frame.click();
    expect(sessions[0]!.setTestObjectVisible).toHaveBeenLastCalledWith(false);
    cleanup();
  });

  it('mostra o andamento e os problemas e só oferece "Tocar áudio e vídeo" quando há bloqueio', async () => {
    const repo = await freshRepository();
    const project = await createProject(repo, { name: 'Cena', anchor: makeMind() });
    await addItem(repo, project.id, { file: { data: signedBytes('image/png'), fileName: 'a.png' } });
    const { root, cleanup } = await mount(target(project.id), async () => repo);
    const media = button(root, 'Tocar áudio e vídeo');
    expect(media.hidden).toBe(true);

    const summary: RuntimeSummary = {
      total: 3,
      loading: 1,
      ready: 1,
      skipped: 0,
      failed: [{ id: 'x', name: 'Rosa', message: 'não abriu' }],
      blocked: true,
      notes: [],
    };
    sessions[0]!.options.onSceneChange(summary);
    expect(root.textContent).toMatch(/Carregando itens: 2\/3 · 1 com erro/);
    expect(root.textContent).toMatch(/Rosa: não abriu/);
    expect(media.hidden).toBe(false);

    media.click();
    expect(sessions[0]!.resumeMedia).toHaveBeenCalledTimes(1);

    sessions[0]!.options.onSceneChange({ ...summary, loading: 0, ready: 2, blocked: false, failed: [] });
    expect(media.hidden).toBe(true);
    cleanup();
  });

  it('falha ao ler o armazenamento não impede a câmera: segue só com a moldura e avisa', async () => {
    const { root, cleanup } = await mount(target('qualquer'), async () => {
      throw new Error('banco indisponível');
    });
    expect(sessions[0]!.options.sceneItems).toEqual([]);
    expect(sessions[0]!.options.showTestObject).toBe(true);
    expect(root.textContent).toMatch(/Os itens não puderam ser lidos: banco indisponível/);
    cleanup();
  });

  it('sair da tela encerra a sessão', async () => {
    const repo = await freshRepository();
    const { cleanup } = await mount(target(null), async () => repo);
    cleanup();
    expect(sessions[0]!.stop).toHaveBeenCalled();
  });
});
