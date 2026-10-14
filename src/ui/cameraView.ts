import { probeCamera } from '../tracking/camera';
import { ArSession } from '../tracking/arSession';
import { gyroNeedsGesture, gyroSupported, startGyro } from '../tracking/gyro';
import type { RuntimeSummary } from '../scene/runtime';
import { describeProblems, describeSummary } from '../scene/summaryText';
import type { SceneItem } from '../storage/model';
import { openItemFile, openSlideFile } from '../storage/scene';
import type { TrackingState } from '../tracking/state';
import { statusChip } from './components';
import type { View } from './context';
import { h } from './dom';

const HINTS: Partial<Record<TrackingState['status'], string>> = {
  'starting-camera':
    'Abrindo a câmera e preparando o rastreador. Na primeira vez pode levar alguns segundos.',
  searching: 'Enquadre a tatuagem inteira, com boa luz e sem tremer.',
  lost: 'Aponte de novo para a tatuagem. O app tenta recuperar sozinho.',
};

const GYRO_PREFERENCE_KEY = 'momentoos:gyro';

function readGyroPreference(): boolean {
  try {
    return localStorage.getItem(GYRO_PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeGyroPreference(on: boolean): void {
  try {
    localStorage.setItem(GYRO_PREFERENCE_KEY, on ? '1' : '0');
  } catch {
    /* preferência é só conveniência */
  }
}

const PROBLEM_TITLES: Partial<Record<TrackingState['status'], string>> = {
  'permission-denied': 'Permissão da câmera negada',
  'camera-unavailable': 'Câmera indisponível',
  error: 'Não foi possível iniciar o rastreamento',
};

export const cameraView: View = (context, root) => {
  const { store } = context;
  const target = context.getTarget();

  if (!target) {
    root.append(
      h(
        'main',
        { class: 'screen' },
        h('p', { class: 'muted' }, 'Nenhum alvo em memória. Crie uma âncora antes de abrir a câmera.'),
        h(
          'button',
          { class: 'btn btn-primary', type: 'button', onclick: () => context.navigate('create') },
          'Criar âncora',
        ),
      ),
    );
    return () => {};
  }

  const chip = statusChip(store);
  const stage = h('div', { class: 'ar-stage' });
  const counters = h('p', { class: 'hud-counters' });
  const hint = h('p', { class: 'hud-hint' });
  const itemsLine = h('p', { class: 'hud-counters' });
  itemsLine.hidden = true;
  const problemsList = h('ul', { class: 'hud-problems' });
  problemsList.hidden = true;
  const mediaButton = h(
    'button',
    { class: 'btn btn-primary', type: 'button', onclick: () => void session?.resumeMedia() },
    'Tocar áudio e vídeo',
  );
  mediaButton.hidden = true;
  const frameButton = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => {
        frameVisible = !frameVisible;
        frameButton.setAttribute('aria-pressed', String(frameVisible));
        session?.setTestObjectVisible(frameVisible);
      },
    },
    'Moldura de teste',
  );
  frameButton.hidden = true;
  const gyroNote = h('p', { class: 'hud-hint', role: 'status' });
  gyroNote.hidden = true;
  const gyroButton = h(
    'button',
    { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => void toggleGyro() },
    'Giroscópio: desligado',
  );
  gyroButton.hidden = !gyroSupported();
  gyroButton.disabled = true;
  const problemTitle = h('h2', { class: 'overlay-title' });
  const problemMessage = h('p', { class: 'overlay-message' });
  const overlay = h(
    'div',
    { class: 'overlay', role: 'alert' },
    problemTitle,
    problemMessage,
    h(
      'div',
      { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void start() }, 'Tentar de novo'),
      h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('home') }, 'Voltar'),
    ),
  );
  overlay.hidden = true;

  let session: ArSession | null = null;
  let disposed = false;
  let updatesPerSecond = 0;
  let frameVisible = true;
  let gyroOn = false;
  let gyroBusy = false;

  function render(state: TrackingState): void {
    hint.textContent = HINTS[state.status] ?? '';
    hint.hidden = !hint.textContent;

    const isProblem = state.status in PROBLEM_TITLES;
    overlay.hidden = !isProblem;
    if (isProblem) {
      problemTitle.textContent = PROBLEM_TITLES[state.status] ?? '';
      problemMessage.textContent = state.message ?? '';
    }

    const parts = [`Perdas: ${state.lossCount}`, `Recuperações: ${state.recoveryCount}`];
    if (state.status === 'tracking') parts.push(`${updatesPerSecond} atualizações/s`);
    counters.textContent = parts.join(' · ');
    counters.hidden = !['searching', 'tracking', 'lost'].includes(state.status);
  }

  function showGyro(on: boolean, note: string | null = null): void {
    gyroOn = on;
    gyroButton.setAttribute('aria-pressed', String(on));
    gyroButton.textContent = on ? 'Giroscópio: ligado' : 'Giroscópio: desligado';
    gyroNote.textContent = note ?? '';
    gyroNote.hidden = note === null;
  }

  /** Liga o giroscópio na sessão atual. Em iOS precisa vir de um toque (pede permissão). */
  async function enableGyro(): Promise<void> {
    const active = session;
    if (!active || gyroBusy) return;
    gyroBusy = true;
    gyroButton.disabled = true;
    try {
      const result = await startGyro();
      if (disposed || session !== active) {
        if (result.ok) result.source.stop();
        return;
      }
      if (!result.ok) {
        writeGyroPreference(false);
        showGyro(false, result.message);
        return;
      }
      if (!active.setGyro(result.source)) {
        showGyro(false, 'A câmera ainda não está pronta para usar o giroscópio.');
        return;
      }
      writeGyroPreference(true);
      showGyro(true, null);
    } finally {
      gyroBusy = false;
      if (!disposed) gyroButton.disabled = false;
    }
  }

  async function toggleGyro(): Promise<void> {
    if (gyroOn) {
      session?.setGyro(null);
      writeGyroPreference(false);
      showGyro(false);
      return;
    }
    await enableGyro();
  }

  function showScene(summary: RuntimeSummary): void {
    const line = describeSummary(summary);
    itemsLine.textContent = line;
    itemsLine.hidden = line === '';
    const problems = describeProblems(summary);
    problemsList.replaceChildren(...problems.map((text) => h('li', {}, text)));
    problemsList.hidden = problems.length === 0;
    mediaButton.hidden = !summary.blocked;
  }

  interface LoadedScene {
    items: SceneItem[];
    open?: (itemId: string) => Promise<ArrayBuffer>;
    openSlide?: (itemId: string, slot: number) => Promise<ArrayBuffer>;
    note: string | null;
  }

  /** Lê a cena do projeto salvo. Sem projeto salvo (ou sem itens) sobra só a moldura de teste. */
  async function readScene(): Promise<LoadedScene> {
    const projectId = target!.projectId;
    if (!projectId) return { items: [], note: null };
    try {
      const repo = await context.getRepository();
      const entry = await repo.getEntry(projectId);
      if (entry?.kind !== 'project') return { items: [], note: null };
      const missing = new Set(entry.missingItems);
      const items = entry.record.scene.items.filter((item) => item.visible && !missing.has(item.id));
      const note =
        entry.missingItems.length > 0
          ? `${entry.missingItems.length} item(ns) sem arquivo no armazenamento foram ignorados.`
          : null;
      return {
        items,
        note,
        open: async (itemId) => (await openItemFile(repo, projectId, itemId)).data,
        openSlide: async (itemId, slot) => (await openSlideFile(repo, projectId, itemId, slot)).data,
      };
    } catch (error) {
      return {
        items: [],
        note: error instanceof Error ? `Os itens não puderam ser lidos: ${error.message}` : 'Os itens não puderam ser lidos.',
      };
    }
  }

  function endSession(): void {
    session?.stop();
    session = null;
  }

  async function start(): Promise<void> {
    endSession();
    updatesPerSecond = 0;
    store.dispatch({ type: 'CAMERA_START' });

    // Câmera só é pedida agora, por ação explícita de quem abriu esta tela.
    const probe = await probeCamera();
    if (disposed) return;
    if (!probe.ok) {
      store.dispatch(
        probe.problem === 'permission-denied'
          ? { type: 'CAMERA_DENIED', message: probe.message }
          : { type: 'CAMERA_UNAVAILABLE', message: probe.message },
      );
      return;
    }

    const scene = await readScene();
    if (disposed) return;
    frameVisible = scene.items.length === 0;
    frameButton.setAttribute('aria-pressed', String(frameVisible));
    frameButton.hidden = scene.items.length === 0;
    mediaButton.hidden = true;
    showGyro(false);
    gyroButton.disabled = true;
    problemsList.replaceChildren(...(scene.note ? [h('li', {}, scene.note)] : []));
    problemsList.hidden = scene.note === null;
    itemsLine.hidden = true;

    const current = new ArSession({
      container: stage,
      sceneItems: scene.items,
      ...(scene.open ? { openItemFile: scene.open } : {}),
      ...(scene.openSlide ? { openSlideFile: scene.openSlide } : {}),
      showTestObject: frameVisible,
      onSceneChange: showScene,
      targetBuffer: target!.buffer,
      targetSize: { width: target!.width, height: target!.height },
      onReady: () => {
        store.dispatch({ type: 'AR_READY' });
        gyroButton.disabled = false;
        // Lembra a escolha; em iOS a permissão só pode ser pedida num toque.
        if (readGyroPreference() && !gyroOn) {
          if (gyroNeedsGesture()) showGyro(false, 'Toque em "Giroscópio" para religar (o iOS pede permissão a cada vez).');
          else void enableGyro();
        }
      },
      onGyroSuspended: () => {
        session?.setGyro(null);
        writeGyroPreference(false);
        showGyro(false, 'O giroscópio deste aparelho não concordou com a câmera e foi desligado. O rastreamento segue só pela câmera.');
      },
      onFound: () => store.dispatch({ type: 'TARGET_FOUND' }),
      onLost: () => store.dispatch({ type: 'TARGET_LOST' }),
      onTrackingRate: (rate) => {
        updatesPerSecond = rate;
        render(store.getState());
      },
    });
    session = current;

    try {
      await current.start();
    } catch (error) {
      if (disposed || session !== current) return;
      endSession();
      store.dispatch({
        type: 'AR_FAILED',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'O rastreador não conseguiu iniciar.',
      });
    }
  }

  const unsubscribe = store.subscribe(render);

  root.append(
    h(
      'main',
      { class: 'camera-view' },
      stage,
      h(
        'div',
        { class: 'hud' },
        chip.element,
        counters,
        itemsLine,
        problemsList,
        hint,
        gyroNote,
      ),
      overlay,
      h(
        'div',
        { class: 'camera-bar' },
        mediaButton,
        frameButton,
        gyroButton,
        h(
          'button',
          { class: 'btn', type: 'button', onclick: () => context.navigate('home') },
          'Parar e voltar',
        ),
      ),
    ),
  );

  void start();

  return () => {
    disposed = true;
    unsubscribe();
    chip.destroy();
    endSession();
    store.dispatch({ type: 'CAMERA_STOP' });
  };
};
