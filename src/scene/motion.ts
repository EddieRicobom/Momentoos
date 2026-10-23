import type { ItemOptions } from '../storage/model';

export type SceneMotion = NonNullable<ItemOptions['motion']>;
export const SCENE_MOTIONS: ReadonlyArray<{ id: SceneMotion; label: string; description: string }> = [
  { id: 'none', label: 'Parado', description: 'Cada lembrança fica onde você colocou.' },
  { id: 'float', label: 'Flutuar', description: 'Sobe e desce devagar, sem atravessar a tatuagem.' },
  { id: 'orbit', label: 'Passeio em 3D', description: 'Um pequeno percurso circular com profundidade.' },
  { id: 'sway', label: 'Balanço suave', description: 'Desliza de um lado para o outro, como uma onda.' },
];

/** Deslocamento relativo: sempre começa em zero e nunca desce da posição salva. */
export function motionOffset(motion: SceneMotion, time: number, scale: number, speed = 1, phase = 0): [number, number, number] {
  if (!Number.isFinite(time) || time <= 0) return [0, 0, 0];
  const t = Math.max(0, Number.isFinite(time) ? time : 0) * Math.min(2, Math.max(0.25, speed)) * 0.6;
  const entrance = Math.min(1, Math.max(0, time));
  const radius = Math.min(0.08, Math.max(0, scale) * 0.1) * entrance * entrance * (3 - 2 * entrance);
  const angle = t + phase;
  if (motion === 'float') return [0, 0, radius * (1 - Math.cos(angle)) * 0.5];
  if (motion === 'orbit') return [radius * Math.cos(angle) * 0.5, radius * Math.sin(angle) * 0.5, radius * (1 - Math.cos(angle)) * 0.35];
  if (motion === 'sway') return [radius * Math.sin(angle), 0, radius * (1 - Math.cos(angle * 2)) * 0.2];
  return [0, 0, 0];
}
