import { describe, expect, it, vi } from 'vitest';
import { createTrackingStore } from '../src/tracking/store';

describe('store', () => {
  it('chama o ouvinte na assinatura e a cada mudança real de estado', () => {
    const store = createTrackingStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    store.dispatch({ type: 'PREPARE_START' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe('preparing-target');
  });

  it('não notifica quando o evento não muda o estado', () => {
    const store = createTrackingStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'TARGET_LOST' });
    store.dispatch({ type: 'CAMERA_START' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cancelar a assinatura interrompe as notificações', () => {
    const store = createTrackingStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.dispatch({ type: 'PREPARE_START' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('um ouvinte que cancela durante a notificação não quebra os demais', () => {
    const store = createTrackingStore();
    const second = vi.fn();
    let unsubscribeFirst = () => {};
    unsubscribeFirst = store.subscribe(() => unsubscribeFirst());
    store.subscribe(second);
    store.dispatch({ type: 'PREPARE_START' });
    expect(second).toHaveBeenCalledTimes(2);
  });
});
