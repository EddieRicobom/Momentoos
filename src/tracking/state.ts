/**
 * Máquina de estados do rastreamento. É uma função pura (reducer), sem DOM e
 * sem MindAR, justamente para poder ser testada sem câmera.
 *
 * Diferença importante entre dois estados parecidos:
 *  - `searching`: a câmera está aberta e a tatuagem AINDA NÃO foi vista nesta sessão.
 *  - `lost`: a tatuagem JÁ foi reconhecida e deixou de ser detectada.
 */

export type TrackingStatus =
  | 'idle' // nenhum alvo em memória
  | 'preparing-target' // compilando a imagem-alvo
  | 'target-ready' // alvo compilado (ou carregado de .mind), câmera fechada
  | 'starting-camera' // pedindo permissão / abrindo câmera / aquecendo o rastreador
  | 'searching' // câmera aberta, procurando a tatuagem
  | 'tracking' // tatuagem reconhecida
  | 'lost' // tatuagem reconhecida antes, agora perdida
  | 'camera-unavailable'
  | 'permission-denied'
  | 'error'; // erro ao compilar, carregar o alvo ou iniciar o rastreador

export interface TrackingState {
  status: TrackingStatus;
  /** Existe um alvo válido em memória (compilado agora ou carregado de .mind). */
  hasTarget: boolean;
  /** 0..100, válido durante `preparing-target`. */
  progress: number;
  /** Detalhe legível para erros e problemas de câmera. */
  message: string | null;
  /** Quantas vezes o rastreamento foi perdido na sessão de câmera atual. */
  lossCount: number;
  /** Quantas vezes foi recuperado depois de perdido, na sessão atual. */
  recoveryCount: number;
}

export type TrackingEvent =
  | { type: 'PREPARE_START' }
  | { type: 'PREPARE_PROGRESS'; percent: number }
  | { type: 'PREPARE_DONE' }
  | { type: 'PREPARE_FAILED'; message: string }
  | { type: 'TARGET_LOADED' }
  | { type: 'TARGET_LOAD_FAILED'; message: string }
  | { type: 'CAMERA_START' }
  | { type: 'CAMERA_DENIED'; message?: string }
  | { type: 'CAMERA_UNAVAILABLE'; message?: string }
  | { type: 'AR_READY' }
  | { type: 'AR_FAILED'; message: string }
  | { type: 'TARGET_FOUND' }
  | { type: 'TARGET_LOST' }
  | { type: 'CAMERA_STOP' }
  | { type: 'RESET' };

export const initialTrackingState: TrackingState = {
  status: 'idle',
  hasTarget: false,
  progress: 0,
  message: null,
  lossCount: 0,
  recoveryCount: 0,
};

/** Estados em que a câmera está (ou deveria estar) em uso. */
const CAMERA_STATUSES: ReadonlySet<TrackingStatus> = new Set([
  'starting-camera',
  'searching',
  'tracking',
  'lost',
  'camera-unavailable',
  'permission-denied',
]);

export function isCameraStatus(status: TrackingStatus): boolean {
  return CAMERA_STATUSES.has(status);
}

function restingStatus(state: TrackingState): TrackingStatus {
  return state.hasTarget ? 'target-ready' : 'idle';
}

export function trackingReducer(
  state: TrackingState,
  event: TrackingEvent,
): TrackingState {
  switch (event.type) {
    case 'PREPARE_START':
      if (isCameraStatus(state.status)) return state;
      return { ...state, status: 'preparing-target', progress: 0, message: null };

    case 'PREPARE_PROGRESS':
      if (state.status !== 'preparing-target') return state;
      return { ...state, progress: clampPercent(event.percent) };

    case 'PREPARE_DONE':
      if (state.status !== 'preparing-target') return state;
      return { ...state, status: 'target-ready', hasTarget: true, progress: 100, message: null };

    case 'PREPARE_FAILED':
      // hasTarget NÃO muda: um alvo anterior ainda válido continua em memória.
      if (state.status !== 'preparing-target') return state;
      return { ...state, status: 'error', message: event.message };

    case 'TARGET_LOADED':
      if (isCameraStatus(state.status)) return state;
      return { ...state, status: 'target-ready', hasTarget: true, progress: 100, message: null };

    case 'TARGET_LOAD_FAILED':
      // Como em PREPARE_FAILED, um alvo anterior válido continua em memória.
      if (isCameraStatus(state.status)) return state;
      return { ...state, status: 'error', message: event.message };

    case 'CAMERA_START':
      if (!state.hasTarget) return state;
      if (state.status === 'preparing-target') return state;
      return {
        ...state,
        status: 'starting-camera',
        message: null,
        lossCount: 0,
        recoveryCount: 0,
      };

    case 'CAMERA_DENIED':
      if (state.status !== 'starting-camera') return state;
      return { ...state, status: 'permission-denied', message: event.message ?? null };

    case 'CAMERA_UNAVAILABLE':
      if (state.status !== 'starting-camera') return state;
      return { ...state, status: 'camera-unavailable', message: event.message ?? null };

    case 'AR_READY':
      if (state.status !== 'starting-camera') return state;
      return { ...state, status: 'searching' };

    case 'AR_FAILED':
      if (!isCameraStatus(state.status)) return state;
      return { ...state, status: 'error', message: event.message };

    case 'TARGET_FOUND':
      if (state.status === 'searching') return { ...state, status: 'tracking' };
      if (state.status === 'lost') {
        return { ...state, status: 'tracking', recoveryCount: state.recoveryCount + 1 };
      }
      return state;

    case 'TARGET_LOST':
      if (state.status !== 'tracking') return state;
      return { ...state, status: 'lost', lossCount: state.lossCount + 1 };

    case 'CAMERA_STOP':
      if (!isCameraStatus(state.status) && state.status !== 'error') return state;
      return { ...state, status: restingStatus(state), message: null };

    case 'RESET':
      return {
        ...state,
        status: restingStatus(state),
        progress: state.hasTarget ? 100 : 0,
        message: null,
      };
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Rótulo curto em português para o indicador de estado. */
export function statusLabel(state: TrackingState): string {
  switch (state.status) {
    case 'idle':
      return 'Nenhum alvo carregado';
    case 'preparing-target':
      return `Preparando imagem-alvo… ${Math.round(state.progress)}%`;
    case 'target-ready':
      return 'Alvo pronto';
    case 'starting-camera':
      return 'Iniciando câmera e rastreador…';
    case 'searching':
      return 'Procurando tatuagem…';
    case 'tracking':
      return 'Tatuagem reconhecida';
    case 'lost':
      return 'Rastreamento perdido';
    case 'camera-unavailable':
      return 'Câmera indisponível';
    case 'permission-denied':
      return 'Permissão da câmera negada';
    case 'error':
      return 'Erro ao compilar ou carregar o alvo';
  }
}

/** Tom visual do indicador. */
export type StatusTone = 'neutral' | 'busy' | 'ok' | 'warn' | 'bad';

export function statusTone(status: TrackingStatus): StatusTone {
  switch (status) {
    case 'idle':
    case 'target-ready':
      return 'neutral';
    case 'preparing-target':
    case 'starting-camera':
    case 'searching':
      return 'busy';
    case 'tracking':
      return 'ok';
    case 'lost':
      return 'warn';
    case 'camera-unavailable':
    case 'permission-denied':
    case 'error':
      return 'bad';
  }
}
