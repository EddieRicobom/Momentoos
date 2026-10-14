/**
 * Substitui `mind-ar/src/image-target/matching/matcher.js` (ver o plugin em
 * vite.config.ts). Mesmo contrato do original, mais as variantes do alvo.
 */
import { match } from 'mind-ar/src/image-target/matching/matching.js';
import { VariantMatcher, type MatchKeyframe, type MatchOutcome } from '../variantMatcher';

interface Query {
  x: number;
  y: number;
}

export class Matcher {
  private readonly variants = new VariantMatcher<MatchKeyframe>();

  constructor(
    private readonly queryWidth: number,
    private readonly queryHeight: number,
    private readonly debugMode = false,
  ) {}

  matchDetection(keyframes: MatchKeyframe[], featurePoints: Query[]) {
    return this.variants.matchDetection(keyframes, (keyframe) =>
      match({
        keyframe,
        querypoints: featurePoints,
        querywidth: this.queryWidth,
        queryheight: this.queryHeight,
        debugMode: this.debugMode,
      }) as MatchOutcome,
    );
  }
}
