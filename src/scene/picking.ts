/**
 * Contas puras do editor (sem DOM nem WebGL): onde um raio da câmera toca o
 * plano do item, e de onde a câmera da prévia olha.
 */

type Vec3 = [number, number, number];

/**
 * Ponto (x, y) em que o raio cruza o plano z = `planeZ` da âncora, ou null se o
 * raio é paralelo ao plano ou aponta para longe dele.
 */
export function rayHitsPlane(origin: Vec3, direction: Vec3, planeZ: number): [number, number] | null {
  const dz = direction[2];
  if (Math.abs(dz) < 1e-9) return null;
  const t = (planeZ - origin[2]) / dz;
  if (!Number.isFinite(t) || t < 0) return null;
  return [origin[0] + direction[0] * t, origin[1] + direction[1] * t];
}

export type PreviewView = 'front' | 'tilted';

/** Inclinação da vista "inclinada", em graus a partir da vista de frente. */
export const TILT_DEGREES = 50;

export interface CameraPose {
  position: Vec3;
  /** Sempre olha para a origem (centro do alvo). */
  fov: number;
}

/**
 * Posição da câmera da prévia. A distância é a menor em que o alvo inteiro
 * (largura 1 × altura `aspect`) cabe na tela com uma folga, para qualquer
 * proporção da área de prévia (`viewAspect` = largura/altura da tela).
 */
export function cameraPose(view: PreviewView, targetAspect: number, viewAspect: number, fov = 40): CameraPose {
  const safeTarget = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 1;
  const safeView = Number.isFinite(viewAspect) && viewAspect > 0 ? viewAspect : 1;
  const margin = 1.35;
  const halfHeight = Math.tan((fov * Math.PI) / 360);
  const neededForHeight = (safeTarget * margin) / 2 / halfHeight;
  const neededForWidth = (1 * margin) / 2 / (halfHeight * safeView);
  const distance = Math.max(neededForHeight, neededForWidth);
  const tilt = view === 'tilted' ? (TILT_DEGREES * Math.PI) / 180 : 0;
  return { position: [0, -Math.sin(tilt) * distance, Math.cos(tilt) * distance], fov };
}
