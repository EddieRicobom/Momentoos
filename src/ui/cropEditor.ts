import {
  FULL_RECT,
  clampRect,
  dragRect,
  type DragHandle,
  type NormalizedRect,
} from '../tracking/cropGeometry';
import { h } from './dom';

export interface CropEditor {
  element: HTMLElement;
  getRect(): NormalizedRect;
  /** Define o retângulo (null = foto inteira) sem disparar onChange. */
  setRect(rect: NormalizedRect | null): void;
  /** Troca a foto exibida (e as proporções do quadro). */
  setImage(url: string, width: number, height: number): void;
  destroy(): void;
}

const HANDLES: DragHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Quadro com a foto e um retângulo arrastável (mover, bordas e cantos), por
 * toque ou mouse. A foto fora do retângulo aparece escurecida. As coordenadas
 * são normalizadas (0–1) em relação à foto inteira.
 */
export function createCropEditor(onChange: (rect: NormalizedRect) => void): CropEditor {
  let rect: NormalizedRect = FULL_RECT;
  let drag: { handle: DragHandle; startRect: NormalizedRect; x: number; y: number; pointerId: number } | null = null;

  const image = h('img', { class: 'crop-image', alt: 'Foto escolhida, com a área da tatuagem marcada', draggable: 'false' });
  const box = h(
    'div',
    { class: 'crop-box', 'data-handle': 'move', role: 'group', 'aria-label': 'Área da tatuagem' },
    ...HANDLES.map((handle) => h('span', { class: `crop-handle crop-handle-${handle}`, 'data-handle': handle })),
  );
  const stage = h('div', { class: 'crop-stage' }, image, box);

  function paint(): void {
    box.style.left = `${rect.x * 100}%`;
    box.style.top = `${rect.y * 100}%`;
    box.style.width = `${rect.w * 100}%`;
    box.style.height = `${rect.h * 100}%`;
  }

  function onDown(event: PointerEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-handle]');
    if (!target || drag) return;
    event.preventDefault();
    drag = {
      handle: target.dataset.handle as DragHandle,
      startRect: rect,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    stage.setPointerCapture?.(event.pointerId);
  }

  function onMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const bounds = stage.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const dx = (event.clientX - drag.x) / bounds.width;
    const dy = (event.clientY - drag.y) / bounds.height;
    rect = dragRect(drag.startRect, drag.handle, dx, dy);
    paint();
    onChange(rect);
  }

  function onUp(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    stage.releasePointerCapture?.(event.pointerId);
    drag = null;
  }

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  paint();

  return {
    element: stage,
    getRect: () => rect,
    setRect(next) {
      rect = next ? clampRect(next) : FULL_RECT;
      paint();
    },
    setImage(url, width, height) {
      image.src = url;
      const aspect = width / height;
      stage.style.aspectRatio = `${width} / ${height}`;
      // No máximo 60% da altura da tela; a altura segue da proporção (quadro = foto).
      stage.style.maxWidth = `calc(60vh * ${aspect})`;
    },
    destroy() {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      drag = null;
    },
  };
}
