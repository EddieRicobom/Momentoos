import { probeCamera } from '../tracking/camera';
import { ArSession } from '../tracking/arSession';
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

    const current = new ArSession({
      container: stage,
      targetBuffer: target!.buffer,
      targetSize: { width: target!.width, height: target!.height },
      onReady: () => store.dispatch({ type: 'AR_READY' }),
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
        hint,
      ),
      overlay,
      h(
        'div',
        { class: 'camera-bar' },
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
