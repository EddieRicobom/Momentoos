import type { ItemTransform } from '../storage/model';

/**
 * Contas puras (sem DOM) de posicionamento dos itens na cena ancorada.
 *
 * Espaço da âncora (MindARThree 1.2.5): origem no CENTRO do alvo, 1 unidade =
 * LARGURA do alvo, +x para a direita, +y para cima na imagem, +z para FORA da
 * pele. Rotações são em graus (ordem X, Y, Z).
 */

/** Largura de um item visual com escala 1: metade da largura do alvo. */
export const BASE_ITEM_WIDTH = 0.5;

export const degToRad = (degrees: number): number => (degrees * Math.PI) / 180;

export interface PlaneSize {
  width: number;
  height: number;
}

/** Tamanho do plano de uma imagem/GIF/vídeo com escala 1, mantendo a proporção. */
export function fitPlane(naturalWidth: number, naturalHeight: number): PlaneSize {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return { width: BASE_ITEM_WIDTH, height: BASE_ITEM_WIDTH };
  return { width: BASE_ITEM_WIDTH, height: (BASE_ITEM_WIDTH * naturalHeight) / naturalWidth };
}

type Vec3 = [number, number, number];

export interface ModelFit {
  /** Escala uniforme para o maior lado do modelo ficar com BASE_ITEM_WIDTH. */
  scale: number;
  /**
   * Deslocamento no espaço do próprio modelo (antes de girar e escalar) para
   * centralizá-lo em X/Z e apoiar a base (menor Y) na origem.
   */
  translation: Vec3;
}

/**
 * Ajuste de um modelo GLB. glTF usa Y para cima; o app gira o modelo 90° em X
 * para que o "alto" dele aponte para fora da pele (+z da âncora) e ele fique
 * em pé sobre a tatuagem. Por isso a base é o menor Y e o centro é em X/Z.
 */
export function modelFit(min: Vec3, max: Vec3): ModelFit {
  if (![...min, ...max].every(Number.isFinite)) return { scale: 1, translation: [0, 0, 0] };
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const largest = Math.max(size[0], size[1], size[2]);
  if (!Number.isFinite(largest) || largest <= 0) return { scale: 1, translation: [0, 0, 0] };
  return {
    scale: BASE_ITEM_WIDTH / largest,
    translation: [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2],
  };
}

/**
 * Índice do quadro de um GIF no instante `timeMs` (com repetição). Durações
 * inválidas (≤ 0) valem 100 ms, como a maioria dos navegadores faz com GIFs
 * que declaram 0.
 */
export function gifFrameIndex(timeMs: number, durationsMs: readonly number[]): number {
  if (durationsMs.length === 0) return 0;
  const durations = durationsMs.map((d) => (Number.isFinite(d) && d > 0 ? d : 100));
  const total = durations.reduce((sum, d) => sum + d, 0);
  let t = ((timeMs % total) + total) % total;
  for (const [index, duration] of durations.entries()) {
    if (t < duration) return index;
    t -= duration;
  }
  return durations.length - 1;
}

export interface CarouselFrame {
  /** Posição (na lista de slides ativos) do slide mostrado por inteiro. */
  index: number;
  /** Slide que está aparecendo por cima; null fora da transição. */
  next: number | null;
  /** Quanto do próximo já apareceu (0 a 1). */
  mix: number;
}

/** Duração máxima da transição suave entre slides. */
export const CAROUSEL_FADE_MS = 600;

/**
 * Qual slide mostrar no instante `timeMs` (contado só enquanto a tatuagem é
 * vista). Cada slide fica `intervalMs`; com `fade`, a transição para o próximo
 * ocupa o fim desse tempo (no máximo CAROUSEL_FADE_MS e nunca mais que metade
 * do intervalo), então o ciclo total continua sendo count × intervalMs.
 */
export function carouselFrame(timeMs: number, count: number, intervalMs: number, fade: boolean): CarouselFrame {
  if (count <= 0 || !(intervalMs > 0)) return { index: 0, next: null, mix: 0 };
  const cycle = count * intervalMs;
  const t = Number.isFinite(timeMs) ? ((timeMs % cycle) + cycle) % cycle : 0;
  const index = Math.min(count - 1, Math.floor(t / intervalMs));
  if (!fade || count < 2) return { index, next: null, mix: 0 };
  const fadeMs = Math.min(CAROUSEL_FADE_MS, intervalMs / 2);
  const into = t - index * intervalMs;
  const start = intervalMs - fadeMs;
  if (into <= start) return { index, next: null, mix: 0 };
  return { index, next: (index + 1) % count, mix: Math.min(1, (into - start) / fadeMs) };
}

export interface Placement {
  position: Vec3;
  rotation: Vec3;
  scale: number;
  offset: Vec3;
}

/** Converte o `transform` salvo para os números que a cena usa (rotação em radianos). */
export function placementOf(transform: ItemTransform): Placement {
  return {
    position: [...transform.position],
    rotation: [degToRad(transform.rotation[0]), degToRad(transform.rotation[1]), degToRad(transform.rotation[2])],
    scale: transform.scale,
    offset: [...transform.offset],
  };
}
