import { describe, expect, it } from 'vitest';
import {
  chooseTransform,
  estimateFlex,
  isSane,
  project,
  stretchRatio,
  transformFromHomography,
  trimmedRms,
  type Pt,
  type Transform3x4,
} from '../src/tracking/flexPose';
import { K, gridPairs, truePose } from './poseHelpers';


describe('estimateFlex', () => {
  it('sem esticar: reproduz a projeção e a razão entre colunas é 1', () => {
    const pose = truePose(1, 1);
    const { world, screen } = gridPairs(pose);
    const est = estimateFlex(screen, world, K)!;
    expect(trimmedRms(est, K, world, screen)).toBeLessThan(0.01);
    expect(stretchRatio(est)).toBeCloseTo(1, 3);
  });

  it.each([
    [1.6, 1],
    [2.5, 1],
    [1, 0.4],
    [0.6, 1.5],
  ])('esticar %f x %f: reproduz a projeção e preserva a razão', (sx, sy) => {
    const pose = truePose(sx, sy);
    const { world, screen } = gridPairs(pose);
    const est = estimateFlex(screen, world, K)!;
    expect(trimmedRms(est, K, world, screen)).toBeLessThan(0.01);
    expect(stretchRatio(est)).toBeCloseTo(sx / sy, 2);
    expect(isSane(est)).toBe(true);
  });

  it('ignora outliers (2 de 36 correspondências erradas)', () => {
    const pose = truePose(1.8, 1);
    const { world, screen } = gridPairs(pose);
    screen[3] = { x: screen[3]!.x + 90, y: screen[3]!.y - 70 };
    screen[20] = { x: screen[20]!.x - 60, y: screen[20]!.y + 40 };
    const est = estimateFlex(screen, world, K)!;
    expect(trimmedRms(est, K, world, screen, 0.9)).toBeLessThan(0.5);
  });

  it('com pontos de menos devolve null', () => {
    const { world, screen } = gridPairs(truePose(1, 1));
    expect(estimateFlex(screen.slice(0, 5), world.slice(0, 5), K)).toBeNull();
  });

  it('pontos colineares (homografia degenerada) não viram uma pose absurda', () => {
    const world: Pt[] = Array.from({ length: 8 }, (_, i) => ({ x: i * 50, y: 0 }));
    const screen: Pt[] = world.map((w) => ({ x: 300 + w.x * 0.3, y: 240 }));
    const est = estimateFlex(screen, world, K);
    expect(est === null || !isSane(est) || trimmedRms(est, K, world, screen) < 1).toBe(true);
  });
});

describe('transformFromHomography', () => {
  it('H e -H dão a mesma pose, sempre com profundidade positiva', () => {
    const pose = truePose(1.3, 1);
    const KH = K;
    // H = K · [c1 c2 t]
    const H = [0, 1, 2].map((r) => [0, 1, 3].map((c) => KH[r]![0]! * pose[0]![c]! + KH[r]![1]! * pose[1]![c]! + KH[r]![2]! * pose[2]![c]!)).flat();
    const a = transformFromHomography(H, K)!;
    const b = transformFromHomography(H.map((v) => -v), K)!;
    expect(a[2]![3]).toBeGreaterThan(0);
    expect(b[2]![3]).toBeGreaterThan(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) expect(a[r]![c]).toBeCloseTo(b[r]![c]!, 9);
  });
});

describe('isSane', () => {
  it('aceita poses normais e esticadas, rejeita colapsadas e atrás da câmera', () => {
    expect(isSane(truePose(1, 1))).toBe(true);
    expect(isSane(truePose(3, 1))).toBe(true);
    expect(isSane(truePose(20, 1))).toBe(false); // razão absurda
    const behind = truePose(1, 1).map((row) => [...row]);
    behind[2]![3] = -5;
    expect(isSane(behind)).toBe(false);
    const collapsed: Transform3x4 = [
      [1, 1, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 1, 500],
    ];
    expect(isSane(collapsed)).toBe(false);
  });
});

describe('chooseTransform', () => {
  const rigid = truePose(1, 1);
  const { world, screen } = gridPairs(rigid);

  it('prefere a pose rígida quando ela se ajusta', () => {
    const flex = estimateFlex(screen, world, K)!;
    const r = chooseTransform(rigid, flex, K, world, screen);
    expect(r.mode).toBe('rigid');
    expect(r.transform).toBe(rigid);
  });

  it('usa a flexível quando a rígida não se ajusta (pele esticada)', () => {
    const stretched = truePose(2, 1);
    const pairs = gridPairs(stretched);
    // o que o MindAR devolveria: colunas normalizadas (sem esticar)
    const upstream = stretched.map((row) => [...row]);
    for (const col of [0, 1]) {
      const n = Math.hypot(upstream[0]![col]!, upstream[1]![col]!, upstream[2]![col]!);
      for (let r = 0; r < 3; r++) upstream[r]![col] = upstream[r]![col]! / n;
    }
    const flex = estimateFlex(pairs.screen, pairs.world, K)!;
    expect(trimmedRms(upstream, K, pairs.world, pairs.screen)).toBeGreaterThan(5);
    const r = chooseTransform(upstream, flex, K, pairs.world, pairs.screen);
    expect(r.mode).toBe('flex');
    expect(trimmedRms(r.transform!, K, pairs.world, pairs.screen)).toBeLessThan(0.01);
  });

  it('flexível ruim ou insana não substitui a rígida', () => {
    const badFlex = truePose(20, 1);
    const r = chooseTransform(rigid, badFlex, K, world, screen);
    expect(r.mode).toBe('rigid');
  });

  it('sem rígida usa a flexível; sem nenhuma devolve none', () => {
    const flex = estimateFlex(screen, world, K)!;
    expect(chooseTransform(null, flex, K, world, screen).mode).toBe('flex');
    expect(chooseTransform(null, null, K, world, screen)).toEqual({ transform: null, mode: 'none' });
  });
});

describe('project / trimmedRms', () => {
  it('ponto atrás da câmera não projeta', () => {
    const behind: Transform3x4 = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, -10],
    ];
    expect(project(behind, K, 0, 0)).toBeNull();
  });

  it('o erro trimado ignora os 20% piores pares', () => {
    const pose = truePose(1, 1);
    const { world, screen } = gridPairs(pose);
    const noisy = screen.map((p, i) => (i % 5 === 0 ? { x: p.x + 200, y: p.y } : p));
    expect(trimmedRms(pose, K, world, noisy, 0.7)).toBeLessThan(0.01);
    expect(trimmedRms(pose, K, world, noisy, 1)).toBeGreaterThan(50);
  });
});
