import { describe, expect, it, vi } from 'vitest';
import { VariantMatcher, targetPoint, type MatchKeyframe, type MatchOutcome } from '../src/tracking/variantMatcher';

const pair = (qx: number, qy: number, kx: number, ky: number) => ({
  querypoint: { x: qx, y: qy },
  keypoint: { x: kx, y: ky },
});

const base = (scale: number): MatchKeyframe => ({ scale });
const variant = (group: number, toTarget: [number, number, number, number, number, number]): MatchKeyframe => ({
  scale: 1,
  variant: { group, toTarget },
});

const ok = (n: number): MatchOutcome => ({
  H: [1],
  matches: Array.from({ length: n }, (_, i) => pair(i, i, i, i)),
});
const fail: MatchOutcome = { debugExtra: {} };

describe('targetPoint', () => {
  it('keyframe comum: (x+0,5)/escala, igual ao Matcher original', () => {
    expect(targetPoint(base(0.5), { x: 9.5, y: 19.5 })).toEqual({ x: 20, y: 40 });
  });

  it('keyframe de variante: aplica o mapa afim ao centro do pixel', () => {
    const p = targetPoint(variant(0, [2, 0, 10, 0, 3, 5]), { x: 4.5, y: 1.5 });
    expect(p).toEqual({ x: 2 * 5 + 10, y: 3 * 2 + 5 });
  });
});

describe('VariantMatcher', () => {
  it('sem variantes comporta-se como o Matcher original: o keyframe com mais casamentos vence', () => {
    const kfs = [base(1), base(0.5), base(0.25)];
    const results = [ok(7), ok(12), fail];
    const m = new VariantMatcher<MatchKeyframe>();
    const r = m.matchDetection(kfs, (k) => results[kfs.indexOf(k)]!);
    expect(r.keyframeIndex).toBe(1);
    expect(r.screenCoords).toHaveLength(12);
    expect(r.worldCoords![3]).toEqual({ x: 3.5 / 0.5, y: 3.5 / 0.5, z: 0 });
  });

  it('se o alvo de frente casa, as variantes nem são tentadas', () => {
    const kfs = [base(1), variant(0, [1, 0, 0, 0, 1, 0]), variant(1, [1, 0, 0, 0, 1, 0])];
    const run = vi.fn((k: MatchKeyframe) => (k === kfs[0] ? ok(8) : ok(50)));
    const r = new VariantMatcher<MatchKeyframe>().matchDetection(kfs, run);
    expect(r.keyframeIndex).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('se o de frente falha, usa a variante e devolve coordenadas do ALVO ORIGINAL', () => {
    const kfs = [base(1), variant(0, [2, 0, 100, 0, 2, 50])];
    const r = new VariantMatcher<MatchKeyframe>().matchDetection(kfs, (k) => (k === kfs[0] ? fail : ok(9)));
    expect(r.keyframeIndex).toBe(1);
    // keypoint (i, i) -> (2*(i+0,5)+100, 2*(i+0,5)+50)
    expect(r.worldCoords![2]).toEqual({ x: 2 * 2.5 + 100, y: 2 * 2.5 + 50, z: 0 });
    expect(r.screenCoords![2]).toEqual({ x: 2, y: 2 });
  });

  it('as escalas de uma mesma variante competem entre si; a com mais casamentos vence', () => {
    const kfs = [base(1), variant(3, [1, 0, 0, 0, 1, 0]), variant(3, [1, 0, 1, 0, 1, 1]), variant(5, [1, 0, 0, 0, 1, 0])];
    const results = [fail, ok(8), ok(15), ok(10)];
    const r = new VariantMatcher<MatchKeyframe>().matchDetection(kfs, (k) => results[kfs.indexOf(k)]!);
    expect(r.keyframeIndex).toBe(2);
  });

  it('groupsPerCall limita o custo por chamada e revezando cobre todos os grupos', () => {
    const kfs = [base(1), ...[0, 1, 2, 3].map((g) => variant(g, [1, 0, 0, 0, 1, 0]))];
    const tried: number[][] = [];
    const m = new VariantMatcher<MatchKeyframe>({ groupsPerCall: 2 });
    for (let call = 0; call < 3; call++) {
      const seen: number[] = [];
      m.matchDetection(kfs, (k) => {
        if (k.variant) seen.push(k.variant.group);
        return fail;
      });
      tried.push(seen);
    }
    expect(tried).toEqual([
      [0, 1],
      [2, 3],
      [0, 1],
    ]);
  });

  it('nada casa: keyframeIndex -1 (o worker trata como "não achou")', () => {
    const kfs = [base(1), variant(0, [1, 0, 0, 0, 1, 0])];
    const r = new VariantMatcher<MatchKeyframe>().matchDetection(kfs, () => fail);
    expect(r.keyframeIndex).toBe(-1);
    expect(r.screenCoords).toBeUndefined();
  });

  it('H sem casamentos não conta como achado', () => {
    const kfs = [base(1)];
    const r = new VariantMatcher<MatchKeyframe>().matchDetection(kfs, () => ({ H: [1] }));
    expect(r.keyframeIndex).toBe(-1);
  });
});
