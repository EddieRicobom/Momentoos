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

/** Caixa de um item no plano da pele (larguras do alvo). */
export interface SnapBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface BoxSnap extends SnapResult {
  /** Linha vertical onde a caixa grudou (para desenhar a guia), ou null. */
  guideX: number | null;
  /** Linha horizontal onde a caixa grudou, ou null. */
  guideY: number | null;
}

interface Candidate {
  center: number;
  guide: number;
}

function nearestCandidate(value: number, candidates: readonly Candidate[], distance: number): Candidate | null {
  let best: Candidate | null = null;
  let bestGap = distance;
  for (const candidate of candidates) {
    const gap = Math.abs(value - candidate.center);
    if (gap < bestGap - 1e-12 || (best === null && gap <= bestGap)) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

function axisCandidates(half: number, limit: number, others: ReadonlyArray<{ min: number; max: number }>): Candidate[] {
  const candidates: Candidate[] = [
    { center: 0, guide: 0 },
    { center: -limit + half, guide: -limit },
    { center: limit - half, guide: limit },
  ];
  for (const other of others) {
    const middle = (other.min + other.max) / 2;
    candidates.push(
      { center: middle, guide: middle },
      { center: other.min + half, guide: other.min },
      { center: other.max - half, guide: other.max },
      { center: other.max + half, guide: other.max },
      { center: other.min - half, guide: other.min },
    );
  }
  return candidates;
}

/**
 * Ímãs para a caixa inteira do item (centro `cx`/`cy`, meias medidas `hx`/`hy`):
 * o centro gruda no centro do alvo, as bordas grudam nas bordas do alvo e o
 * item se alinha aos outros (centros iguais, bordas iguais ou encostadas).
 */
export function snapBox(cx: number, cy: number, hx: number, hy: number, aspect: number, others: readonly SnapBox[] = [], distance = SNAP_DISTANCE, grid = false): BoxSnap {
  const half = (Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75) / 2;
  const bx = nearestCandidate(cx, axisCandidates(Math.max(0, hx), 0.5, others.map((o) => ({ min: o.minX, max: o.maxX }))), distance);
  const by = nearestCandidate(cy, axisCandidates(Math.max(0, hy), half, others.map((o) => ({ min: o.minY, max: o.maxY }))), distance);
  const step = 0.05;
  const gridX = grid && bx === null ? Number((Math.round(cx / step) * step).toFixed(2)) : cx;
  const gridY = grid && by === null ? Number((Math.round(cy / step) * step).toFixed(2)) : cy;
  return {
    x: bx?.center ?? gridX,
    y: by?.center ?? gridY,
    snappedX: bx !== null || gridX !== cx,
    snappedY: by !== null || gridY !== cy,
    guideX: bx?.guide ?? null,
    guideY: by?.guide ?? null,
  };
}

export type TargetSpot = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export const TARGET_SPOTS: ReadonlyArray<{ id: TargetSpot; label: string; col: -1 | 0 | 1; row: -1 | 0 | 1 }> = [
  { id: 'top-left', label: 'Canto superior esquerdo', col: -1, row: 1 },
  { id: 'top', label: 'No alto, ao centro', col: 0, row: 1 },
  { id: 'top-right', label: 'Canto superior direito', col: 1, row: 1 },
  { id: 'left', label: 'À esquerda, ao centro', col: -1, row: 0 },
  { id: 'center', label: 'No centro', col: 0, row: 0 },
  { id: 'right', label: 'À direita, ao centro', col: 1, row: 0 },
  { id: 'bottom-left', label: 'Canto inferior esquerdo', col: -1, row: -1 },
  { id: 'bottom', label: 'Embaixo, ao centro', col: 0, row: -1 },
  { id: 'bottom-right', label: 'Canto inferior direito', col: 1, row: -1 },
];

/**
 * Posição (do ponto de origem do item) que encosta a caixa dele num dos nove
 * pontos do alvo, com uma pequena margem. `box` é a caixa do item relativa à
 * origem; se o item for maior que o alvo naquele eixo, ele fica centralizado.
 */
export function spotPosition(spot: TargetSpot, box: SnapBox, aspect: number, margin = 0.02): [number, number] {
  const info = TARGET_SPOTS.find((entry) => entry.id === spot) ?? TARGET_SPOTS[4]!;
  const half = (Number.isFinite(aspect) && aspect > 0 ? aspect : 0.75) / 2;
  const axis = (where: -1 | 0 | 1, min: number, max: number, limit: number): number => {
    const middle = -(min + max) / 2;
    if (where === 0 || max - min >= 2 * (limit - margin)) return middle;
    return where < 0 ? -limit + margin - min : limit - margin - max;
  };
  const x = axis(info.col, box.minX, box.maxX, 0.5);
  const y = axis(info.row, box.minY, box.maxY, half);
  return [Number(x.toFixed(4)) + 0, Number(y.toFixed(4)) + 0];
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
