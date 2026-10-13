import type * as THREE from 'three';
import type { SceneItem } from '../storage/model';

/**
 * Um item da cena já carregado. O runtime só fala com esta interface, o que
 * deixa a montagem da cena testável sem navegador (os carregadores reais, que
 * dependem de imagem, vídeo, áudio e WebGL, ficam em loaders.ts).
 */
export interface ItemController {
  /** Objeto 3D do item (null para áudio). */
  readonly object: THREE.Object3D | null;
  /** Aviso a mostrar ao usuário (ex.: GIF sem animação neste navegador). */
  readonly note?: string;
  /** Nomes das animações do modelo (só modelos 3D). */
  readonly clips?: readonly string[];
  /** Precisa de um toque do usuário para tocar (política de autoplay do navegador). */
  readonly blocked: boolean;
  /** Tatuagem reconhecida (true) ou perdida (false): toca ou pausa a mídia. */
  setActive(active: boolean): Promise<void>;
  /** Chamado dentro de um toque do usuário para liberar mídia bloqueada. */
  resume(): Promise<void>;
  update(deltaSeconds: number): void;
  setOpacity(opacity: number): void;
  /** O item usa materiais com iluminação (modelos 3D). */
  readonly needsLights: boolean;
  dispose(): void;
}

export type ItemLoader = (item: SceneItem, data: ArrayBuffer) => Promise<ItemController>;
export type ItemLoaders = Record<SceneItem['type'], ItemLoader>;
