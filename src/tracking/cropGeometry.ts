/**
 * Geometria do recorte da tatuagem. Funções puras (sem DOM), em coordenadas
 * NORMALIZADAS (0 a 1) relativas à foto inteira, para valerem em qualquer
 * tamanho de tela ou de imagem.
 */

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_RECT: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };

/** Menor lado permitido para o recorte, como fração da foto. */
export const MIN_CROP_FRACTION = 0.1;

export type DragHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Garante um retângulo dentro da foto e com o tamanho mínimo. */
export function clampRect(rect: NormalizedRect, min: number = MIN_CROP_FRACTION): NormalizedRect {
  const w = clamp(Number.isFinite(rect.w) ? rect.w : 1, min, 1);
  const h = clamp(Number.isFinite(rect.h) ? rect.h : 1, min, 1);
  const x = clamp(Number.isFinite(rect.x) ? rect.x : 0, 0, 1 - w);
  const y = clamp(Number.isFinite(rect.y) ? rect.y : 0, 0, 1 - h);
  return { x, y, w, h };
}

/**
 * Aplica um arrasto de (dx, dy) — também normalizados — a partir do retângulo
 * inicial. O resultado nunca sai da foto nem fica menor que `min`.
 */
export function dragRect(
  start: NormalizedRect,
  handle: DragHandle,
  dx: number,
  dy: number,
  min: number = MIN_CROP_FRACTION,
): NormalizedRect {
  const safe = clampRect(start, min);
  if (handle === 'move') {
    return {
      x: clamp(safe.x + dx, 0, 1 - safe.w),
      y: clamp(safe.y + dy, 0, 1 - safe.h),
      w: safe.w,
      h: safe.h,
    };
  }

  let left = safe.x;
  let right = safe.x + safe.w;
  let top = safe.y;
  let bottom = safe.y + safe.h;

  if (handle.includes('w')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('e')) right = clamp(right + dx, left + min, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, 1);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function isFullRect(rect: NormalizedRect | null, epsilon = 0.005): boolean {
  if (rect === null) return true;
  return rect.x <= epsilon && rect.y <= epsilon && rect.w >= 1 - epsilon && rect.h >= 1 - epsilon;
}

/** Aumenta o retângulo em `fraction` do seu tamanho em cada lado, sem sair da foto. */
export function padRect(rect: NormalizedRect, fraction: number): NormalizedRect {
  const padX = rect.w * fraction;
  const padY = rect.h * fraction;
  const left = clamp(rect.x - padX, 0, 1);
  const top = clamp(rect.y - padY, 0, 1);
  const right = clamp(rect.x + rect.w + padX, 0, 1);
  const bottom = clamp(rect.y + rect.h + padY, 0, 1);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Converte para pixels inteiros dentro de uma imagem width×height (mínimo 1 px). */
export function rectToPixels(rect: NormalizedRect | null, width: number, height: number): PixelBox {
  const r = rect ?? FULL_RECT;
  const x = clamp(Math.round(r.x * width), 0, width - 1);
  const y = clamp(Math.round(r.y * height), 0, height - 1);
  const w = clamp(Math.round(r.w * width), 1, width - x);
  const h = clamp(Math.round(r.h * height), 1, height - y);
  return { x, y, w, h };
}
