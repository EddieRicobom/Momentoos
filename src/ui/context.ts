import type { TrackingStore } from '../tracking/store';

/** Alvo compilado mantido em memória enquanto o app está aberto (Etapa B). */
export interface AppTarget {
  buffer: Uint8Array;
  width: number;
  height: number;
  /** De onde veio: compilado agora ou carregado de um .mind. */
  origin: 'compiled' | 'file';
  label: string;
  /** Miniatura da imagem usada (só quando foi compilada nesta sessão). */
  previewUrl: string | null;
  compileMs: number | null;
}

export type ViewName = 'home' | 'create' | 'camera' | 'settings';

export interface AppContext {
  store: TrackingStore;
  getTarget(): AppTarget | null;
  setTarget(target: AppTarget | null): void;
  navigate(view: ViewName): void;
  toast(message: string): void;
}

/** Uma tela recebe o contexto, desenha em `root` e devolve a função de limpeza. */
export type View = (context: AppContext, root: HTMLElement) => () => void;
