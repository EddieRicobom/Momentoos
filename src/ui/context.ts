import type { ProjectRepository } from '../storage/repository';
import type { TrackingStore } from '../tracking/store';

/** Imagem de referência ainda em memória (recém-preparada), para salvar junto do projeto. */
export interface PendingReferenceImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Alvo mantido em memória enquanto o app está aberto. */
export interface AppTarget {
  buffer: Uint8Array;
  width: number;
  height: number;
  /** De onde veio: compilado agora, carregado de um .mind ou aberto de um projeto salvo. */
  origin: 'compiled' | 'file' | 'project';
  label: string;
  /** Miniatura da imagem usada (só quando foi compilada nesta sessão). */
  previewUrl: string | null;
  compileMs: number | null;
  /** Id do projeto salvo correspondente, ou null se ainda não foi salvo. */
  projectId: string | null;
  /** Foto usada na compilação, disponível até salvar (ou trocar de alvo). */
  referenceImage: PendingReferenceImage | null;
  /** Resumo do preparo (recorte e contraste) para mostrar na tela, quando houver. */
  note?: string | null;
}

export type ViewName = 'home' | 'create' | 'camera' | 'settings' | 'projects' | 'import' | 'export';

export interface AppContext {
  store: TrackingStore;
  getTarget(): AppTarget | null;
  /** Troca o alvo em memória; a miniatura do alvo anterior é liberada aqui. */
  setTarget(target: AppTarget | null): void;
  /** Abre o banco local na primeira chamada e reaproveita a conexão depois. */
  getRepository(): Promise<ProjectRepository>;
  navigate(view: ViewName): void;
  toast(message: string): void;
}

/** Uma tela recebe o contexto, desenha em `root` e devolve a função de limpeza. */
export type View = (context: AppContext, root: HTMLElement) => () => void;
