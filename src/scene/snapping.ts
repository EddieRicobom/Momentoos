/**
 * Ímãs de posicionamento (contas puras): ao arrastar um item perto do centro ou
 * das bordas do alvo, a posição "gruda" na linha, e a prévia mostra a guia.
 * Unidades da âncora: 1 = largura do alvo; origem no centro.
 */

/** Distância (larguras do alvo) em que a posição gruda. */
export const SNAP_DISTANCE = 0.02;

export interface SnapResult {
  x: number;
  y: number;
  /** Colou numa linha vertical (x = 0 ou borda esquerda/direita). */
  snappedX: boolean;
  /** Colou numa linha horizontal (y = 0 ou borda de cima/baixo). */
  snappedY: boolean;
}

function nearest(value: number, lines: readonly number[], distance: number): number | null {
  let best: number | null = null;
  let bestGap = distance;
  for (const line of lines) {
    const gap = Math.abs(value - line);
    if (gap <= bestGap) {
      best = line;
      bestGap = gap;
    }
  }
  return best;
}

/** `aspect` = altura / largura do alvo. */
export function snapPosition(x: number, y: number, aspect: number, distance = SNAP_DISTANCE, grid = false): SnapResult {
  const half = (Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75) / 2;
  const sx = nearest(x, [0, -0.5, 0.5], distance);
  const sy = nearest(y, [0, -half, half], distance);
  const step = 0.05;
  const gridX = grid && sx === null ? Number((Math.round(x / step) * step).toFixed(2)) : x;
  const gridY = grid && sy === null ? Number((Math.round(y / step) * step).toFixed(2)) : y;
  return { x: sx ?? gridX, y: sy ?? gridY, snappedX: sx !== null || (grid && sx === null && gridX !== x), snappedY: sy !== null || (grid && sy === null && gridY !== y) };
}

/** Ângulos "bonitos" onde o giro gruda. */
const ANGLE_STOPS: readonly number[] = [-180, -135, -90, -45, 0, 45, 90, 135, 180];

export const SNAP_ANGLE_DEGREES = 3;

export interface AngleSnap {
  degrees: number;
  snapped: boolean;
}

export function snapAngle(degrees: number, tolerance = SNAP_ANGLE_DEGREES): AngleSnap {
  const stop = nearest(degrees, ANGLE_STOPS, tolerance);
  if (stop === null) return { degrees, snapped: false };
  return { degrees: stop === -180 ? 180 : stop, snapped: true };
}
