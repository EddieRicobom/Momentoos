import { describe, expect, it } from 'vitest';
import {
  initialTrackingState,
  isCameraStatus,
  statusLabel,
  statusTone,
  trackingReducer,
  type TrackingEvent,
  type TrackingState,
  type TrackingStatus,
} from '../src/tracking/state';

function run(events: TrackingEvent[], from: TrackingState = initialTrackingState): TrackingState {
  return events.reduce(trackingReducer, from);
}

const READY: TrackingEvent[] = [{ type: 'PREPARE_START' }, { type: 'PREPARE_DONE' }];
const SEARCHING: TrackingEvent[] = [...READY, { type: 'CAMERA_START' }, { type: 'AR_READY' }];

const ALL_STATUSES: TrackingStatus[] = [
  'idle',
  'preparing-target',
  'target-ready',
  'starting-camera',
  'searching',
  'tracking',
  'lost',
  'camera-unavailable',
  'permission-denied',
  'error',
];

describe('preparo do alvo', () => {
  it('começa em idle, sem alvo', () => {
    expect(initialTrackingState.status).toBe('idle');
    expect(initialTrackingState.hasTarget).toBe(false);
  });

  it('PREPARE_START → progresso → PREPARE_DONE deixa o alvo pronto', () => {
    const preparing = run([{ type: 'PREPARE_START' }, { type: 'PREPARE_PROGRESS', percent: 42 }]);
    expect(preparing.status).toBe('preparing-target');
    expect(preparing.progress).toBe(42);

    const done = run([{ type: 'PREPARE_DONE' }], preparing);
    expect(done.status).toBe('target-ready');
    expect(done.hasTarget).toBe(true);
    expect(done.progress).toBe(100);
  });

  it('limita o progresso entre 0 e 100 e ignora valores inválidos', () => {
    const base = run([{ type: 'PREPARE_START' }]);
    expect(run([{ type: 'PREPARE_PROGRESS', percent: 250 }], base).progress).toBe(100);
    expect(run([{ type: 'PREPARE_PROGRESS', percent: -5 }], base).progress).toBe(0);
    expect(run([{ type: 'PREPARE_PROGRESS', percent: Number.NaN }], base).progress).toBe(0);
  });

  it('ignora progresso fora da preparação', () => {
    const state = run([{ type: 'PREPARE_PROGRESS', percent: 50 }]);
    expect(state).toBe(initialTrackingState);
  });

  it('PREPARE_FAILED vira estado de erro com a mensagem', () => {
    const state = run([{ type: 'PREPARE_START' }, { type: 'PREPARE_FAILED', message: 'imagem pequena' }]);
    expect(state.status).toBe('error');
    expect(state.message).toBe('imagem pequena');
    expect(state.hasTarget).toBe(false);
  });

  it('falha ao compilar não apaga um alvo anterior que continua válido', () => {
    const state = run([
      ...READY,
      { type: 'PREPARE_START' },
      { type: 'PREPARE_FAILED', message: 'falhou' },
    ]);
    expect(state.status).toBe('error');
    expect(state.hasTarget).toBe(true);
    expect(run([{ type: 'RESET' }], state).status).toBe('target-ready');
  });

  it('carregar um .mind válido deixa o alvo pronto; inválido gera erro', () => {
    const loaded = run([{ type: 'TARGET_LOADED' }]);
    expect(loaded.status).toBe('target-ready');
    expect(loaded.hasTarget).toBe(true);

    const failed = run([{ type: 'TARGET_LOAD_FAILED', message: 'versão antiga' }]);
    expect(failed.status).toBe('error');
    expect(failed.message).toBe('versão antiga');
    expect(failed.hasTarget).toBe(false);
  });

  it('RESET volta para idle sem alvo e limpa a mensagem de erro', () => {
    const state = run([{ type: 'TARGET_LOAD_FAILED', message: 'x' }, { type: 'RESET' }]);
    expect(state.status).toBe('idle');
    expect(state.message).toBeNull();
  });
});

describe('câmera e rastreamento', () => {
  it('não abre a câmera sem alvo', () => {
    expect(run([{ type: 'CAMERA_START' }])).toBe(initialTrackingState);
  });

  it('não abre a câmera no meio da compilação', () => {
    const state = run([{ type: 'PREPARE_START' }, { type: 'CAMERA_START' }]);
    expect(state.status).toBe('preparing-target');
  });

  it('fluxo completo: procurando → reconhecida → perdida → recuperada', () => {
    let state = run(SEARCHING);
    expect(state.status).toBe('searching');

    state = run([{ type: 'TARGET_FOUND' }], state);
    expect(state.status).toBe('tracking');
    expect(state.lossCount).toBe(0);

    state = run([{ type: 'TARGET_LOST' }], state);
    expect(state.status).toBe('lost');
    expect(state.lossCount).toBe(1);

    state = run([{ type: 'TARGET_FOUND' }], state);
    expect(state.status).toBe('tracking');
    expect(state.recoveryCount).toBe(1);
  });

  it('conta várias perdas e recuperações', () => {
    const state = run([
      ...SEARCHING,
      { type: 'TARGET_FOUND' },
      { type: 'TARGET_LOST' },
      { type: 'TARGET_FOUND' },
      { type: 'TARGET_LOST' },
      { type: 'TARGET_FOUND' },
      { type: 'TARGET_LOST' },
    ]);
    expect(state.lossCount).toBe(3);
    expect(state.recoveryCount).toBe(2);
    expect(state.status).toBe('lost');
  });

  it('"perdido" só existe depois de reconhecida: perda sem nunca ter achado é ignorada', () => {
    const state = run([...SEARCHING, { type: 'TARGET_LOST' }]);
    expect(state.status).toBe('searching');
    expect(state.lossCount).toBe(0);
  });

  it('TARGET_FOUND repetido não conta como recuperação', () => {
    const state = run([...SEARCHING, { type: 'TARGET_FOUND' }, { type: 'TARGET_FOUND' }]);
    expect(state.status).toBe('tracking');
    expect(state.recoveryCount).toBe(0);
  });

  it('eventos do rastreador fora de uma sessão de câmera não mudam nada', () => {
    const ready = run(READY);
    expect(run([{ type: 'TARGET_FOUND' }], ready)).toBe(ready);
    expect(run([{ type: 'TARGET_LOST' }], ready)).toBe(ready);
    expect(run([{ type: 'AR_READY' }], ready)).toBe(ready);
  });

  it('abrir a câmera de novo zera os contadores da sessão', () => {
    const afterSession = run([
      ...SEARCHING,
      { type: 'TARGET_FOUND' },
      { type: 'TARGET_LOST' },
      { type: 'CAMERA_STOP' },
      { type: 'CAMERA_START' },
    ]);
    expect(afterSession.status).toBe('starting-camera');
    expect(afterSession.lossCount).toBe(0);
    expect(afterSession.recoveryCount).toBe(0);
  });

  it('permissão negada e câmera indisponível só valem enquanto a câmera abre', () => {
    const starting = run([...READY, { type: 'CAMERA_START' }]);
    const denied = run([{ type: 'CAMERA_DENIED', message: 'negada' }], starting);
    expect(denied.status).toBe('permission-denied');
    expect(denied.message).toBe('negada');

    const unavailable = run([{ type: 'CAMERA_UNAVAILABLE' }], starting);
    expect(unavailable.status).toBe('camera-unavailable');

    expect(run([{ type: 'CAMERA_DENIED' }], run(READY)).status).toBe('target-ready');
  });

  it('dá para tentar de novo depois de permissão negada ou erro', () => {
    const denied = run([...READY, { type: 'CAMERA_START' }, { type: 'CAMERA_DENIED' }]);
    expect(run([{ type: 'CAMERA_START' }], denied).status).toBe('starting-camera');

    const failed = run([...SEARCHING, { type: 'AR_FAILED', message: 'x' }]);
    expect(failed.status).toBe('error');
    expect(run([{ type: 'CAMERA_START' }], failed).status).toBe('starting-camera');
  });

  it('CAMERA_STOP volta para alvo pronto mantendo o alvo', () => {
    const state = run([...SEARCHING, { type: 'TARGET_FOUND' }, { type: 'CAMERA_STOP' }]);
    expect(state.status).toBe('target-ready');
    expect(state.hasTarget).toBe(true);
  });

  it('AR_FAILED em sessão de câmera vira erro com mensagem', () => {
    const state = run([...READY, { type: 'CAMERA_START' }, { type: 'AR_FAILED', message: 'webgl' }]);
    expect(state.status).toBe('error');
    expect(state.message).toBe('webgl');
  });
});

describe('rótulos e tons', () => {
  it('todo estado tem rótulo em português não vazio e um tom', () => {
    for (const status of ALL_STATUSES) {
      const label = statusLabel({ ...initialTrackingState, status });
      expect(label.length).toBeGreaterThan(0);
      expect(['neutral', 'busy', 'ok', 'warn', 'bad']).toContain(statusTone(status));
    }
  });

  it('usa exatamente os textos exigidos para os estados principais', () => {
    const label = (status: TrackingStatus) => statusLabel({ ...initialTrackingState, status });
    expect(label('target-ready')).toBe('Alvo pronto');
    expect(label('tracking')).toBe('Tatuagem reconhecida');
    expect(label('lost')).toBe('Rastreamento perdido');
    expect(label('camera-unavailable')).toBe('Câmera indisponível');
    expect(label('error')).toBe('Erro ao compilar ou carregar o alvo');
    expect(label('searching')).toContain('Procurando tatuagem');
    expect(statusLabel({ ...initialTrackingState, status: 'preparing-target', progress: 37.4 })).toBe(
      'Preparando imagem-alvo… 37%',
    );
  });

  it('perdido é aviso e reconhecido é positivo (nunca o mesmo tom)', () => {
    expect(statusTone('lost')).toBe('warn');
    expect(statusTone('tracking')).toBe('ok');
  });

  it('isCameraStatus identifica os estados de câmera', () => {
    expect(isCameraStatus('searching')).toBe(true);
    expect(isCameraStatus('permission-denied')).toBe(true);
    expect(isCameraStatus('target-ready')).toBe(false);
    expect(isCameraStatus('preparing-target')).toBe(false);
  });
});
