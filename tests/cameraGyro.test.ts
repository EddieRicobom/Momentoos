// @vitest-environment happy-dom
//
// Botão do giroscópio na tela da câmera. ArSession e o módulo do sensor são
// SUBSTITUÍDOS por falsos: confere a lógica da tela (ligar, desligar, negar,
// lembrar a escolha, suspensão), não o sensor nem a estabilização em aparelho real.
import { Quaternion } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTrackingStore } from '../src/tracking/store';
import type { AppContext, AppTarget } from '../src/ui/context';
import { freshRepository, makeMind } from './helpers';

interface FakeSession {
  options: Record<string, any>;
  setGyro: Mock<(source: unknown) => boolean>;
  stop: Mock<() => void>;
}
const sessions: FakeSession[] = [];
let accepts = true;

vi.mock('../src/tracking/camera', () => ({ probeCamera: vi.fn(async () => ({ ok: true })) }));
vi.mock('../src/tracking/arSession', () => ({
  ArSession: class {
    fake: FakeSession;
    constructor(options: Record<string, any>) {
      this.fake = { options, setGyro: vi.fn(() => accepts), stop: vi.fn() };
      sessions.push(this.fake);
    }
    async start() {}
    stop() {
      this.fake.stop();
    }
    setTestObjectVisible() {}
    async resumeMedia() {}
    setGyro(source: unknown) {
      return this.fake.setGyro(source);
    }
  },
}));

const gyro = vi.hoisted(() => ({
  supported: true,
  needsGesture: false,
  startGyro: vi.fn(),
}));
vi.mock('../src/tracking/gyro', () => ({
  gyroSupported: () => gyro.supported,
  gyroNeedsGesture: () => gyro.needsGesture,
  startGyro: gyro.startGyro,
}));

const { cameraView } = await import('../src/ui/cameraView');

const KEY = 'momentoos:gyro';
const fakeSource = () => ({ takeRotation: () => new Quaternion(), stop: vi.fn() });

function target(): AppTarget {
  return { buffer: makeMind(), width: 640, height: 480, origin: 'project', label: 'T', previewUrl: null, compileMs: null, projectId: null, referenceImage: null };
}

async function mount() {
  const repo = await freshRepository();
  const context: AppContext = {
    store: createTrackingStore(),
    getTarget: () => target(),
    setTarget: () => {},
    getRepository: async () => repo,
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

const gyroButton = (root: HTMLElement): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => /^Giroscópio/.test(b.textContent ?? ''));
  if (!found) throw new Error('botão do giroscópio não existe');
  return found as HTMLButtonElement;
};
const note = (root: HTMLElement): string => root.querySelector('.hud-hint[role=status]')?.textContent ?? '';
const ready = (): void => sessions.at(-1)!.options.onReady();

beforeEach(() => {
  sessions.length = 0;
  accepts = true;
  gyro.supported = true;
  gyro.needsGesture = false;
  gyro.startGyro.mockReset();
  localStorage.clear();
  document.body.replaceChildren();
});
afterEach(() => {
  document.body.replaceChildren();
});

describe('botão do giroscópio na câmera', () => {
  it('fica escondido quando o aparelho não expõe o giroscópio', async () => {
    gyro.supported = false;
    const { root } = await mount();
    expect(gyroButton(root).hidden).toBe(true);
  });

  it('começa desativado e desligado; só habilita quando a câmera está pronta', async () => {
    const { root } = await mount();
    const button = gyroButton(root);
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Giroscópio: desligado');
    ready();
    expect(button.disabled).toBe(false);
  });

  it('ligar: pede ao sensor, entrega a fonte à sessão, marca como ligado e lembra a escolha', async () => {
    const source = fakeSource();
    gyro.startGyro.mockResolvedValue({ ok: true, source });
    const { root } = await mount();
    ready();
    gyroButton(root).click();
    await vi.waitFor(() => {
      if (gyroButton(root).getAttribute('aria-pressed') !== 'true') throw new Error('ainda não ligou');
    });
    expect(sessions[0]!.setGyro).toHaveBeenCalledWith(source);
    expect(gyroButton(root).textContent).toBe('Giroscópio: ligado');
    expect(localStorage.getItem(KEY)).toBe('1');
    expect(gyroButton(root).disabled).toBe(false);
  });

  it('desligar: tira a fonte da sessão e esquece a escolha', async () => {
    gyro.startGyro.mockResolvedValue({ ok: true, source: fakeSource() });
    const { root } = await mount();
    ready();
    gyroButton(root).click();
    await vi.waitFor(() => {
      if (gyroButton(root).getAttribute('aria-pressed') !== 'true') throw new Error('ainda não ligou');
    });
    gyroButton(root).click();
    expect(sessions[0]!.setGyro).toHaveBeenLastCalledWith(null);
    expect(gyroButton(root).getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it.each([
    ['denied', 'A permissão do giroscópio foi negada.'],
    ['no-data', 'O aparelho não enviou dados do giroscópio.'],
  ])('falha (%s): mostra a mensagem, não liga e não lembra', async (problem, message) => {
    gyro.startGyro.mockResolvedValue({ ok: false, problem, message });
    const { root } = await mount();
    ready();
    gyroButton(root).click();
    await vi.waitFor(() => {
      if (note(root) === '') throw new Error('sem mensagem');
    });
    expect(note(root)).toBe(message);
    expect(sessions[0]!.setGyro).not.toHaveBeenCalled();
    expect(gyroButton(root).getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('sessão que ainda não aceita o giroscópio: avisa e não marca como ligado', async () => {
    accepts = false;
    gyro.startGyro.mockResolvedValue({ ok: true, source: fakeSource() });
    const { root } = await mount();
    ready();
    gyroButton(root).click();
    await vi.waitFor(() => {
      if (note(root) === '') throw new Error('sem aviso');
    });
    expect(gyroButton(root).getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('escolha lembrada liga sozinha quando a câmera fica pronta (aparelho sem permissão explícita)', async () => {
    localStorage.setItem(KEY, '1');
    gyro.startGyro.mockResolvedValue({ ok: true, source: fakeSource() });
    const { root } = await mount();
    expect(gyro.startGyro).not.toHaveBeenCalled(); // antes de estar pronta, nada
    ready();
    await vi.waitFor(() => {
      if (gyroButton(root).getAttribute('aria-pressed') !== 'true') throw new Error('ainda não ligou');
    });
    expect(gyro.startGyro).toHaveBeenCalledTimes(1);
  });

  it('iOS (exige toque): a escolha lembrada só avisa, não liga sozinha', async () => {
    gyro.needsGesture = true;
    localStorage.setItem(KEY, '1');
    const { root } = await mount();
    ready();
    expect(gyro.startGyro).not.toHaveBeenCalled();
    expect(note(root)).toMatch(/Toque em "Giroscópio"/);
    expect(gyroButton(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('sem escolha lembrada não liga sozinho', async () => {
    const { root } = await mount();
    ready();
    expect(gyro.startGyro).not.toHaveBeenCalled();
    expect(gyroButton(root).getAttribute('aria-pressed')).toBe('false');
  });

  it('suspensão por discordar da câmera: desliga, avisa e esquece a escolha', async () => {
    gyro.startGyro.mockResolvedValue({ ok: true, source: fakeSource() });
    const { root } = await mount();
    ready();
    gyroButton(root).click();
    await vi.waitFor(() => {
      if (gyroButton(root).getAttribute('aria-pressed') !== 'true') throw new Error('ainda não ligou');
    });
    sessions[0]!.options.onGyroSuspended();
    expect(sessions[0]!.setGyro).toHaveBeenLastCalledWith(null);
    expect(gyroButton(root).getAttribute('aria-pressed')).toBe('false');
    expect(note(root)).toMatch(/não concordou com a câmera/);
    expect(localStorage.getItem(KEY)).toBe('0');
  });

  it('sair da tela enquanto o sensor ainda inicia solta o sensor sem ligar nada', async () => {
    const source = fakeSource();
    let release!: (value: unknown) => void;
    gyro.startGyro.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { root, cleanup } = await mount();
    ready();
    gyroButton(root).click();
    cleanup();
    release({ ok: true, source });
    await vi.waitFor(() => {
      if (source.stop.mock.calls.length === 0) throw new Error('sensor não foi solto');
    });
    expect(sessions[0]!.setGyro).not.toHaveBeenCalled();
  });

  it('dois toques rápidos não pedem o sensor duas vezes', async () => {
    let release!: (value: unknown) => void;
    gyro.startGyro.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { root } = await mount();
    ready();
    gyroButton(root).click();
    gyroButton(root).click();
    expect(gyro.startGyro).toHaveBeenCalledTimes(1);
    release({ ok: true, source: fakeSource() });
  });
});
