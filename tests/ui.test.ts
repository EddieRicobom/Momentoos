// @vitest-environment happy-dom
//
// Testes das telas da Etapa C em um DOM SIMULADO (happy-dom) com IndexedDB falso.
// Isto confere a lógica e a ligação das telas (listar, abrir, renomear, excluir,
// recompilar, importar, exportar). NÃO substitui teste em navegador/celular real:
// câmera, Web Worker de compilação e layout não são exercitados aqui.
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBackup } from '../src/storage/backup';
import { createProject, openProjectAnchor } from '../src/storage/projects';
import type { ProjectRepository } from '../src/storage/repository';
import { createTrackingStore } from '../src/tracking/store';
import type { AppContext, AppTarget, ViewName } from '../src/ui/context';
import { fakeImage, freshRepository, makeMind, makeRecord, toBuffer } from './helpers';

const downloads: Array<{ bytes: Uint8Array; fileName: string; mimeType: string }> = [];

vi.mock('../src/ui/dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/dom')>()),
  downloadBytes: (bytes: Uint8Array, fileName: string, mimeType: string) => {
    downloads.push({ bytes, fileName, mimeType });
  },
}));

vi.mock('../src/tracking/targetCompiler', async () => {
  const { readMindHeader } = await import('../src/tracking/mindFormat');
  return {
    MIND_FORMAT_VERSION: 2,
    inspectTargetBuffer: (buffer: Uint8Array) => {
      const result = readMindHeader(buffer);
      if (!result.ok) throw new Error(result.message);
      return { width: result.header.width, height: result.header.height };
    },
    compileTarget: vi.fn(async () => ({
      buffer: (await import('./helpers')).makeMind({ seed: 42, width: 800, height: 600, filler: 64 }),
      width: 800,
      height: 600,
      compileMs: 12,
    })),
  };
});

vi.mock('../src/tracking/imagePrep', () => ({
  MAX_TARGET_SIDE: 1024,
  prepareTargetImage: vi.fn(async () => ({
    image: {},
    blob: new Blob(),
    objectUrl: 'blob:preparada',
    width: 640,
    height: 480,
    dispose: vi.fn(),
  })),
}));

const { projectsView } = await import('../src/ui/projectsView');
const { exportView } = await import('../src/ui/exportView');
const { importView } = await import('../src/ui/importView');
const { createView } = await import('../src/ui/createView');
const { compileTarget } = await import('../src/tracking/targetCompiler');

interface Harness {
  context: AppContext;
  root: HTMLElement;
  repo: ProjectRepository;
  navigations: ViewName[];
  targets: Array<AppTarget | null>;
  cleanup: () => void;
}

const revoked: string[] = [];
let urlCounter = 0;

beforeEach(() => {
  downloads.length = 0;
  revoked.length = 0;
  urlCounter = 0;
  URL.createObjectURL = () => `blob:fake-${++urlCounter}`;
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  document.body.replaceChildren();
  vi.mocked(compileTarget).mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
});

async function mount(
  view: typeof projectsView,
  repo?: ProjectRepository,
  initialTarget: AppTarget | null = null,
): Promise<Harness> {
  const repository = repo ?? (await freshRepository());
  const navigations: ViewName[] = [];
  const targets: Array<AppTarget | null> = [];
  let target = initialTarget;
  const context: AppContext = {
    store: createTrackingStore(),
    getTarget: () => target,
    setTarget: (next) => {
      target = next;
      targets.push(next);
    },
    getRepository: async () => repository,
    navigate: (name) => {
      navigations.push(name);
    },
    toast: () => {},
  };
  const root = document.createElement('div');
  document.body.appendChild(root);
  const cleanup = view(context, root);
  return { context, root, repo: repository, navigations, targets, cleanup };
}

function button(root: HTMLElement, label: string | RegExp): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) =>
    typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? ''),
  );
  if (!found) throw new Error(`Botão não encontrado: ${String(label)}\n${root.textContent}`);
  return found as HTMLButtonElement;
}

const hasButton = (root: HTMLElement, label: string): boolean =>
  [...root.querySelectorAll('button')].some((b) => b.textContent === label);

async function until(check: () => boolean | void): Promise<void> {
  await vi.waitFor(() => {
    if (check() === false) throw new Error('ainda não');
  });
}

async function addProject(repo: ProjectRepository, name: string, seed = 1) {
  return createProject(repo, {
    name,
    anchor: makeMind({ seed, filler: 200 }),
    referenceImage: { data: fakeImage(seed, 128), mimeType: 'image/png', width: 640, height: 480 },
    now: new Date(`2026-10-0${seed}T10:00:00.000Z`),
  });
}

describe('Meus projetos', () => {
  it('sem projetos, mostra o estado vazio com caminhos para criar ou importar', async () => {
    const { root } = await mount(projectsView);
    await until(() => root.textContent?.includes('Nenhum projeto salvo'));
    expect(hasButton(root, 'Criar âncora')).toBe(true);
    expect(hasButton(root, 'Importar backup')).toBe(true);
  });

  it('lista os projetos do mais recente para o mais antigo, com a situação de cada um', async () => {
    const repo = await freshRepository();
    await addProject(repo, 'Braço', 1);
    await addProject(repo, 'Perna', 2);
    const { root } = await mount(projectsView, repo);
    await until(() => root.querySelectorAll('.project-card').length === 2);

    const names = [...root.querySelectorAll('.project-name')].map((n) => n.textContent);
    expect(names).toEqual(['Perna', 'Braço']);
    expect([...root.querySelectorAll('.badge')].map((b) => b.textContent)).toEqual(['Pronto', 'Pronto']);
    expect(root.querySelectorAll('img.project-thumb')).toHaveLength(2);
  });

  it('abre o projeto salvo SEM recompilar: usa os bytes guardados e vai para a câmera', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Braço', 1);
    const h = await mount(projectsView, repo);
    await until(() => hasButton(h.root, 'Abrir câmera'));

    button(h.root, 'Abrir câmera').click();
    await until(() => h.navigations.includes('camera'));

    expect(vi.mocked(compileTarget)).not.toHaveBeenCalled();
    const target = h.targets.at(-1)!;
    expect(target.buffer).toEqual(makeMind({ seed: 1, filler: 200 }));
    expect(target).toMatchObject({ origin: 'project', projectId: record.id, label: 'Braço', width: 640, height: 480 });
    expect(h.context.store.getState().status).toBe('target-ready');
  });

  it('alvo corrompido: avisa, NÃO abre a câmera e oferece recompilar a partir da foto', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Braço', 1);
    // Mesmo tamanho, conteúdo diferente: só o hash denuncia.
    await repo.save(record, { anchor: { mimeType: 'application/octet-stream', data: toBuffer(makeMind({ seed: 9, filler: 200 })) } });
    const h = await mount(projectsView, repo);
    await until(() => hasButton(h.root, 'Abrir câmera'));

    button(h.root, 'Abrir câmera').click();
    await until(() => h.root.textContent?.includes('corrompido'));
    expect(h.navigations).toEqual([]);
    expect(h.targets).toEqual([]);
    expect(hasButton(h.root, 'Recompilar')).toBe(true);
  });

  it('recompila a partir da foto guardada e o projeto volta a abrir', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Braço', 1);
    await repo.save(record, { anchor: { mimeType: 'application/octet-stream', data: toBuffer(makeMind({ seed: 9, filler: 200 })) } });
    const h = await mount(projectsView, repo);
    await until(() => hasButton(h.root, 'Abrir câmera'));
    button(h.root, 'Abrir câmera').click();
    await until(() => hasButton(h.root, 'Recompilar'));

    button(h.root, 'Recompilar').click();
    await until(() => vi.mocked(compileTarget).mock.calls.length === 1);
    await until(() => !h.root.textContent?.includes('corrompido') && hasButton(h.root, 'Abrir câmera'));

    const reopened = await openProjectAnchor(repo, record.id);
    expect(reopened.record.anchor).toMatchObject({ width: 800, height: 600 });
  });

  it('foto de referência corrompida: recusa recompilar e não toca no alvo existente', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Braço', 1);
    // Mesmo tamanho, bytes diferentes na foto; e o alvo também adulterado para aparecer "Recompilar".
    await repo.save(record, {
      referenceImage: { mimeType: 'image/png', data: fakeImage(99, 128) },
      anchor: { mimeType: 'application/octet-stream', data: toBuffer(makeMind({ seed: 9, filler: 200 })) },
    });
    const h = await mount(projectsView, repo);
    await until(() => hasButton(h.root, 'Abrir câmera'));
    button(h.root, 'Abrir câmera').click();
    await until(() => hasButton(h.root, 'Recompilar'));
    button(h.root, 'Recompilar').click();
    await until(() => h.root.textContent?.includes('foto de referência está corrompida'));
    expect(vi.mocked(compileTarget)).not.toHaveBeenCalled();
  });

  it('projeto que precisa recompilar mostra o motivo e o botão certo (sem "Abrir câmera")', async () => {
    const repo = await freshRepository();
    const old = makeMind({ version: 1 });
    const image = fakeImage(3, 100);
    const base = await makeRecord({ id: 'velho', name: 'Antigo' }, { anchor: old, image });
    await repo.save({ ...base, anchor: { ...base.anchor!, mindFormat: 1 } }, {
      anchor: { mimeType: 'application/octet-stream', data: toBuffer(old) },
      referenceImage: { mimeType: 'image/png', data: image },
    });
    const { root } = await mount(projectsView, repo);
    await until(() => root.querySelectorAll('.project-card').length === 1);

    expect(root.querySelector('.badge')?.textContent).toBe('Precisa recompilar');
    expect(root.textContent).toContain('formato incompatível');
    expect(hasButton(root, 'Abrir câmera')).toBe(false);
    expect(hasButton(root, 'Recompilar')).toBe(true);
  });

  it('renomeia e a lista mostra o novo nome; nome vazio é recusado', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Braço', 1);
    const { root } = await mount(projectsView, repo);
    await until(() => hasButton(root, 'Renomear'));

    button(root, 'Renomear').click();
    const input = root.querySelector('input.text-input') as HTMLInputElement;
    input.value = '   ';
    button(root, 'Salvar nome').click();
    await until(() => root.textContent?.includes('não pode ficar vazio'));
    expect(await repo.getEntry(record.id)).toMatchObject({ record: { name: 'Braço' } });

    button(root, 'Renomear').click();
    const input2 = root.querySelector('input.text-input') as HTMLInputElement;
    input2.value = '  Costela   esquerda ';
    button(root, 'Salvar nome').click();
    await until(() => root.querySelector('.project-name')?.textContent === 'Costela esquerda');
    expect(await repo.getEntry(record.id)).toMatchObject({ record: { name: 'Costela esquerda' } });
  });

  it('excluir pede confirmação; cancelar não apaga, confirmar apaga', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Braço', 1);
    const { root } = await mount(projectsView, repo);
    await until(() => hasButton(root, 'Excluir'));

    button(root, 'Excluir').click();
    expect(root.textContent).toContain('não dá para desfazer');
    expect(await repo.getEntry(record.id)).not.toBeNull();

    button(root, 'Cancelar').click();
    expect(hasButton(root, 'Excluir definitivamente')).toBe(false);
    expect(await repo.getEntry(record.id)).not.toBeNull();

    button(root, 'Excluir').click();
    button(root, 'Excluir definitivamente').click();
    await until(() => root.textContent?.includes('Nenhum projeto salvo'));
    expect(await repo.getEntry(record.id)).toBeNull();
    expect(await repo.getFile(record.id, 'anchor')).toBeNull();
    expect(await repo.getFile(record.id, 'referenceImage')).toBeNull();
  });

  it('excluir o projeto aberto em memória desvincula o alvo (não finge que ainda está salvo)', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Braço', 1);
    const initial: AppTarget = {
      buffer: makeMind(), width: 640, height: 480, origin: 'project', label: 'Braço',
      previewUrl: null, compileMs: null, projectId: record.id, referenceImage: null,
    };
    const h = await mount(projectsView, repo, initial);
    await until(() => hasButton(h.root, 'Excluir'));
    button(h.root, 'Excluir').click();
    button(h.root, 'Excluir definitivamente').click();
    await until(() => h.targets.length === 1);
    expect(h.targets[0]?.projectId).toBeNull();
  });

  it('registro de versão mais nova aparece identificado, sem ser alterado', async () => {
    const repo = await freshRepository();
    const future = { ...(await makeRecord({ id: 'futuro1' })), formatVersion: 99 };
    await repo.save(future as never);
    const { root } = await mount(projectsView, repo);
    await until(() => root.querySelectorAll('.project-card').length === 1);
    expect(root.querySelector('.badge')?.textContent).toBe('Versão mais nova');
    expect(root.textContent).toContain('atualize o app');
    expect(hasButton(root, 'Abrir câmera')).toBe(false);
  });

  it('exportar um projeto gera um ZIP com o manifesto e os arquivos dele', async () => {
    const repo = await freshRepository();
    const record = await addProject(repo, 'Braço', 1);
    const { root } = await mount(projectsView, repo);
    await until(() => hasButton(root, 'Exportar'));
    button(root, 'Exportar').click();
    await until(() => downloads.length === 1);

    expect(downloads[0]!.fileName).toMatch(/\.tattoo-ar\.zip$/);
    const files = unzipSync(downloads[0]!.bytes);
    expect(Object.keys(files).sort()).toEqual([
      'manifest.json',
      `projects/${record.id}/anchor.mind`,
      `projects/${record.id}/project.json`,
      `projects/${record.id}/reference-image.png`,
    ]);
    expect(JSON.parse(strFromU8(files['manifest.json']!)).projects[0].id).toBe(record.id);
  });

  it('libera as miniaturas (URLs de objeto) ao sair da tela', async () => {
    const repo = await freshRepository();
    await addProject(repo, 'A', 1);
    await addProject(repo, 'B', 2);
    const h = await mount(projectsView, repo);
    await until(() => h.root.querySelectorAll('img.project-thumb').length === 2);
    expect(revoked).toEqual([]);
    h.cleanup();
    expect(revoked.sort()).toEqual(['blob:fake-1', 'blob:fake-2']);
  });

  it('falha ao abrir o banco: mostra o erro e deixa tentar de novo', async () => {
    const h = await mount(projectsView);
    h.root.replaceChildren();
    const failing = await mountWithFailingRepo();
    await until(() => failing.root.textContent?.includes('sem banco'));
    expect(hasButton(failing.root, 'Tentar de novo')).toBe(true);
    h.cleanup();
  });
});

async function mountWithFailingRepo(): Promise<Harness> {
  const h = await mount(projectsView);
  h.cleanup();
  const root = document.createElement('div');
  const context: AppContext = {
    ...h.context,
    getRepository: async () => {
      throw new Error('sem banco');
    },
  };
  projectsView(context, root);
  return { ...h, root };
}

describe('Exportar backup', () => {
  it('lista os projetos marcados, gera o ZIP só com os escolhidos e mostra o resultado', async () => {
    const repo = await freshRepository();
    const a = await addProject(repo, 'Braço', 1);
    await addProject(repo, 'Perna', 2);
    const { root } = await mount(exportView, repo);
    await until(() => root.querySelectorAll('input[type=checkbox]').length === 2);

    const boxes = [...root.querySelectorAll('label.pick-row')];
    const braco = boxes.find((l) => l.textContent?.includes('Braço'))!;
    const perna = boxes.find((l) => l.textContent?.includes('Perna'))!;
    (perna.querySelector('input') as HTMLInputElement).checked = false;
    expect((braco.querySelector('input') as HTMLInputElement).checked).toBe(true);

    button(root, 'Gerar backup').click();
    await until(() => downloads.length === 1);
    const manifest = JSON.parse(strFromU8(unzipSync(downloads[0]!.bytes)['manifest.json']!));
    expect(manifest.projects.map((p: { id: string }) => p.id)).toEqual([a.id]);
    await until(() => root.textContent?.includes('Backup gerado'));
    expect(root.textContent).toContain('sem criptografia');
  });

  it('nenhum marcado: pede para marcar e não baixa nada', async () => {
    const repo = await freshRepository();
    await addProject(repo, 'Braço', 1);
    const { root } = await mount(exportView, repo);
    await until(() => hasButton(root, 'Desmarcar todos'));
    button(root, 'Desmarcar todos').click();
    button(root, 'Gerar backup').click();
    await until(() => root.textContent?.includes('Marque pelo menos um projeto'));
    expect(downloads).toEqual([]);
  });

  it('sem projetos íntegros, diz que não há o que exportar', async () => {
    const { root } = await mount(exportView);
    await until(() => root.textContent?.includes('Nada para exportar'));
  });
});

describe('Importar backup', () => {
  async function pickFile(root: HTMLElement, file: File): Promise<void> {
    const input = root.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  it('importa um backup válido e mostra o relatório; o projeto fica utilizável', async () => {
    const origem = await freshRepository('origem');
    const original = await addProject(origem, 'Braço', 1);
    const { bytes } = await exportBackup(origem, 'all', { appVersion: 'teste' });

    const h = await mount(importView);
    await pickFile(h.root, new File([bytes.slice()], 'backup.tattoo-ar.zip', { type: 'application/zip' }));
    await until(() => h.root.textContent?.includes('1 importado(s), 0 não importado(s)'));

    expect(h.root.textContent).toContain('✓ Braço');
    expect((await openProjectAnchor(h.repo, original.id)).buffer).toEqual(makeMind({ seed: 1, filler: 200 }));
    button(h.root, 'Ver meus projetos').click();
    expect(h.navigations).toEqual(['projects']);
  });

  it('arquivo que não é um backup: mostra o erro e não grava nada', async () => {
    const h = await mount(importView);
    await pickFile(h.root, new File([new Uint8Array([1, 2, 3, 4])], 'foto.zip'));
    await until(() => h.root.querySelector('.form-error:not([hidden])')?.textContent?.includes('ZIP'));
    expect(await h.repo.list()).toEqual([]);
  });

  it('importar o mesmo backup de novo informa que já existe, sem duplicar', async () => {
    const origem = await freshRepository('origem');
    await addProject(origem, 'Braço', 1);
    const { bytes } = await exportBackup(origem, 'all', { appVersion: 'teste' });
    const h = await mount(importView);

    await pickFile(h.root, new File([bytes.slice()], 'b.zip'));
    await until(() => h.root.textContent?.includes('1 importado(s)'));
    await pickFile(h.root, new File([bytes.slice()], 'b.zip'));
    await until(() => h.root.textContent?.includes('0 importado(s), 1 não importado(s)'));
    expect(h.root.textContent).toContain('já existe');
    expect(await h.repo.list()).toHaveLength(1);
  });
});

describe('Criar âncora: salvar projeto', () => {
  async function loadMind(root: HTMLElement, file: File): Promise<void> {
    const input = root.querySelectorAll('input[type=file]')[2] as HTMLInputElement; // galeria, câmera, .mind
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  it('um .mind carregado pode ser salvo como projeto (sem foto, avisando que não recompila)', async () => {
    const h = await mount(createView);
    const mind = makeMind({ seed: 5, width: 700, height: 500, filler: 80 });
    await loadMind(h.root, new File([mind.slice()], 'braco.mind'));
    await until(() => hasButton(h.root, 'Salvar projeto'));

    expect(h.root.textContent).toContain('não para recompilar');
    const name = h.root.querySelector('input.text-input') as HTMLInputElement;
    expect(name.value).toBe('braco');
    name.value = 'Meu braço';
    button(h.root, 'Salvar projeto').click();
    await until(() => h.root.textContent?.includes('Salvo neste aparelho'));

    const [entry] = await h.repo.list();
    expect(entry).toMatchObject({ kind: 'project', record: { name: 'Meu braço', referenceImage: null }, health: { status: 'ready' } });
    expect(h.targets.at(-1)?.projectId).toBe(entry?.kind === 'project' ? entry.record.id : null);
  });

  it('nome vazio: mostra o erro e não salva', async () => {
    const h = await mount(createView);
    await loadMind(h.root, new File([makeMind().slice()], 'x.mind'));
    await until(() => hasButton(h.root, 'Salvar projeto'));
    (h.root.querySelector('input.text-input') as HTMLInputElement).value = '   ';
    button(h.root, 'Salvar projeto').click();
    await until(() => h.root.textContent?.includes('Dê um nome'));
    expect(await h.repo.list()).toEqual([]);
    expect(hasButton(h.root, 'Salvar projeto')).toBe(true);
  });

  it('arquivo .mind de versão incompatível é recusado antes de qualquer salvamento', async () => {
    const h = await mount(createView);
    await loadMind(h.root, new File([makeMind({ version: 1 }).slice()], 'velho.mind'));
    await until(() => h.context.store.getState().status === 'error');
    expect(hasButton(h.root, 'Salvar projeto')).toBe(false);
    expect(await h.repo.list()).toEqual([]);
  });
});
