import {
  initialTrackingState,
  trackingReducer,
  type TrackingEvent,
  type TrackingState,
} from './state';

export type Listener = (state: TrackingState) => void;

export interface TrackingStore {
  getState(): TrackingState;
  dispatch(event: TrackingEvent): void;
  /** Registra um ouvinte e já o chama uma vez com o estado atual. */
  subscribe(listener: Listener): () => void;
}

export function createTrackingStore(
  initial: TrackingState = initialTrackingState,
): TrackingStore {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    dispatch(event) {
      const next = trackingReducer(state, event);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
