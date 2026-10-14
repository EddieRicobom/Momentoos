// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateFlex, stretchRatio, trimmedRms, type Pt, type Transform3x4 } from '../src/tracking/flexPose';
import { K, gridPairs, truePose } from './poseHelpers';

const matchDetection = vi.fn();
vi.mock('../src/tracking/patch/matcher', () => ({
  Matcher: class {
    matchDetection = matchDetection;
  },
}));

type Posted = { type: string; modelViewTransform?: Transform3x4 | null; targetIndex?: number };
let posted: Posted[];
let closed: boolean;

async function load(): Promise<(data: unknown) => void> {
  vi.resetModules();
  posted = [];
  closed = false;
  const scope = self as unknown as { postMessage: unknown; close: unknown; onmessage: ((m: { data: unknown }) => void) | null };
  scope.postMessage = (m: Posted) => posted.push(m);
  scope.close = () => {
    closed = true;
  };
  await import('../src/tracking/patch/controllerWorker');
  const send = (data: unknown) => scope.onmessage!({ data });
  send({
    type: 'setup',
    projectionTransform: K,
    matchingDataList: [[]],
    debugMode: false,
    inputWidth: 640,
    inputHeight: 480,
  });
  return send;
}

function unitColumns(t: Transform3x4): Transform3x4 {
  const out = t.map((row) => [...row]);
  for (const col of [0, 1]) {
    const n = Math.hypot(out[0]![col]!, out[1]![col]!, out[2]![col]!);
    for (let r = 0; r < 3; r++) out[r]![col] = out[r]![col]! / n;
  }
  return out;
}

describe('worker do controlador (patch)', () => {
  beforeEach(() => {
    matchDetection.mockReset();
  });

  it('match: alvo não encontrado -> targetIndex -1 e sem pose', async () => {
    const send = await load();
    matchDetection.mockReturnValue({ keyframeIndex: -1, debugExtra: { frames: [] } });
    send({ type: 'match', featurePoints: [], targetIndexes: [0] });
    expect(posted.at(-1)).toMatchObject({ type: 'matchDone', targetIndex: -1, modelViewTransform: null });
  });

  it('match: pele sem esticar -> pose rígida (colunas unitárias, como o MindAR)', async () => {
    const send = await load();
    const { world, screen } = gridPairs(truePose(1, 1));
    matchDetection.mockReturnValue({ keyframeIndex: 0, screenCoords: screen, worldCoords: world.map((w) => ({ ...w, z: 0 })), debugExtra: {} });
    send({ type: 'match', featurePoints: [], targetIndexes: [0] });
    const msg = posted.at(-1)!;
    expect(msg.targetIndex).toBe(0);
    expect(stretchRatio(msg.modelViewTransform!)).toBeCloseTo(1, 3);
    expect(trimmedRms(msg.modelViewTransform!, K, world, screen)).toBeLessThan(0.5);
  });

  it('match: pele esticada -> pose flexível (preserva a razão e reprojeta bem)', async () => {
    const send = await load();
    const { world, screen } = gridPairs(truePose(2.2, 1));
    matchDetection.mockReturnValue({ keyframeIndex: 0, screenCoords: screen, worldCoords: world.map((w) => ({ ...w, z: 0 })), debugExtra: {} });
    send({ type: 'match', featurePoints: [], targetIndexes: [0] });
    const t = posted.at(-1)!.modelViewTransform!;
    expect(stretchRatio(t)).toBeCloseTo(2.2, 1);
    expect(trimmedRms(t, K, world, screen)).toBeLessThan(0.1);
  });

  it('match: tenta os alvos na ordem e para no primeiro que casa', async () => {
    const send = await load();
    const { world, screen } = gridPairs(truePose(1, 1));
    matchDetection
      .mockReturnValueOnce({ keyframeIndex: -1, debugExtra: {} })
      .mockReturnValueOnce({ keyframeIndex: 2, screenCoords: screen, worldCoords: world.map((w) => ({ ...w, z: 0 })), debugExtra: {} });
    send({ type: 'match', featurePoints: [], targetIndexes: [0, 1, 2] });
    expect(posted.at(-1)).toMatchObject({ type: 'matchDone', targetIndex: 1 });
    expect(matchDetection).toHaveBeenCalledTimes(2);
  });

  it('trackUpdate: movimento rígido normal -> mantém o refinamento rígido do MindAR', async () => {
    const send = await load();
    const pose = truePose(1, 1);
    const { world, screen } = gridPairs(pose);
    const slightlyOff = truePose(1, 1, 21, 31, 16);
    send({ type: 'trackUpdate', modelViewTransform: slightlyOff, worldCoords: world, screenCoords: screen });
    const t = posted.at(-1)!.modelViewTransform!;
    expect(posted.at(-1)!.type).toBe('trackUpdateDone');
    expect(stretchRatio(t)).toBeCloseTo(1, 2);
    expect(trimmedRms(t, K, world, screen)).toBeLessThan(1);
  });

  it('trackUpdate: pele esticada (a rígida não fecha) -> pose flexível em vez de perder o rastreio', async () => {
    const send = await load();
    const stretched = truePose(1.9, 1);
    const { world, screen } = gridPairs(stretched);
    send({ type: 'trackUpdate', modelViewTransform: unitColumns(stretched), worldCoords: world, screenCoords: screen });
    const t = posted.at(-1)!.modelViewTransform;
    expect(t).not.toBeNull();
    expect(stretchRatio(t!)).toBeCloseTo(1.9, 1);
    expect(trimmedRms(t!, K, world, screen)).toBeLessThan(0.5);
  });

  it('trackUpdate: já em modo flexível e passo seguinte continua flexível (sem vai-e-vem)', async () => {
    const send = await load();
    const stretched = truePose(1.9, 1);
    const { world, screen } = gridPairs(stretched);
    const flexPrev = estimateFlex(screen, world, K)!;
    send({ type: 'trackUpdate', modelViewTransform: flexPrev, worldCoords: world, screenCoords: screen });
    const t = posted.at(-1)!.modelViewTransform!;
    expect(stretchRatio(t)).toBeCloseTo(1.9, 1);
  });

  it('trackUpdate: pares ruins/insuficientes -> null (rastreio perdido, como no MindAR)', async () => {
    const send = await load();
    const pose = truePose(1, 1);
    const world: Pt[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }];
    const screen: Pt[] = [{ x: 10, y: 10 }, { x: 600, y: 400 }, { x: 5, y: 300 }, { x: 330, y: 20 }];
    send({ type: 'trackUpdate', modelViewTransform: pose, worldCoords: world, screenCoords: screen });
    expect(posted.at(-1)!.modelViewTransform).toBeNull();
  });

  it('dispose fecha o worker', async () => {
    const send = await load();
    send({ type: 'dispose' });
    expect(closed).toBe(true);
  });
});
