/**
 * Reconhecimento contra o alvo base e, se falhar, contra as variantes
 * deformadas (ver targetVariants.ts). Roda dentro do worker do MindAR (por
 * isso não toca em DOM) e é testável em Node.
 *
 * Compatível com .mind antigos: sem keyframes de variante, o comportamento é
 * o do `Matcher` original do mind-ar@1.2.5.
 */
import type { Affine } from './targetVariants';

export interface Keypoint {
  x: number;
  y: number;
}

export interface MatchRecord {
  querypoint: { x: number; y: number };
  keypoint: Keypoint;
}

export interface VariantInfo {
  group: number;
  /** Pixel do keyframe (+0,5) -> pixel do alvo original. */
  toTarget: Affine;
}

export interface MatchKeyframe {
  scale: number;
  variant?: VariantInfo;
}

export interface MatchOutcome {
  H?: unknown;
  matches?: MatchRecord[];
  debugExtra?: unknown;
}

export type MatchFn<K extends MatchKeyframe> = (keyframe: K) => MatchOutcome;

export interface DetectionResult {
  keyframeIndex: number;
  screenCoords?: Array<{ x: number; y: number }>;
  worldCoords?: Array<{ x: number; y: number; z: number }>;
  debugExtra: { frames: unknown[] };
}

export interface VariantMatcherOptions {
  /** Quantos grupos de variantes tentar por chamada quando o alvo base falha. */
  groupsPerCall?: number;
}

/** Pixel do alvo original correspondente a um ponto-chave do keyframe. */
export function targetPoint(keyframe: MatchKeyframe, keypoint: Keypoint): { x: number; y: number } {
  const px = keypoint.x + 0.5;
  const py = keypoint.y + 0.5;
  const v = keyframe.variant;
  if (!v) return { x: px / keyframe.scale, y: py / keyframe.scale };
  const m = v.toTarget;
  return { x: m[0] * px + m[1] * py + m[2], y: m[3] * px + m[4] * py + m[5] };
}

export class VariantMatcher<K extends MatchKeyframe> {
  private cursor = 0;

  constructor(private readonly options: VariantMatcherOptions = {}) {}

  matchDetection(keyframes: readonly K[], run: MatchFn<K>): DetectionResult {
    const debugExtra: { frames: unknown[] } = { frames: [] };
    const baseIdx: number[] = [];
    const groups = new Map<number, number[]>();
    keyframes.forEach((k, i) => {
      if (!k.variant) baseIdx.push(i);
      else {
        const list = groups.get(k.variant.group);
        if (list) list.push(i);
        else groups.set(k.variant.group, [i]);
      }
    });

    let best = this.bestOf(keyframes, baseIdx, run, debugExtra);
    if (best === null && groups.size > 0) {
      const ids = [...groups.keys()].sort((a, b) => a - b);
      const per = Math.max(1, Math.min(ids.length, this.options.groupsPerCall ?? ids.length));
      const picked: number[] = [];
      for (let n = 0; n < per; n++) {
        const id = ids[(this.cursor + n) % ids.length]!;
        picked.push(...groups.get(id)!);
      }
      this.cursor = (this.cursor + per) % ids.length;
      best = this.bestOf(keyframes, picked, run, debugExtra);
    }

    if (best === null) return { keyframeIndex: -1, debugExtra };

    const keyframe = keyframes[best.index]!;
    const screenCoords: Array<{ x: number; y: number }> = [];
    const worldCoords: Array<{ x: number; y: number; z: number }> = [];
    for (const m of best.matches) {
      screenCoords.push({ x: m.querypoint.x, y: m.querypoint.y });
      const p = targetPoint(keyframe, m.keypoint);
      worldCoords.push({ x: p.x, y: p.y, z: 0 });
    }
    return { screenCoords, worldCoords, keyframeIndex: best.index, debugExtra };
  }

  private bestOf(
    keyframes: readonly K[],
    indexes: readonly number[],
    run: MatchFn<K>,
    debugExtra: { frames: unknown[] },
  ): { index: number; matches: MatchRecord[] } | null {
    let best: { index: number; matches: MatchRecord[] } | null = null;
    for (const i of indexes) {
      const r = run(keyframes[i]!);
      debugExtra.frames.push(r.debugExtra);
      if (r.H && r.matches && (best === null || best.matches.length < r.matches.length)) {
        best = { index: i, matches: r.matches };
      }
    }
    return best;
  }
}
