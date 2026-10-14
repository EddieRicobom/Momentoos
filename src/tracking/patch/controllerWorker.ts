/**
 * Substitui `mind-ar/src/image-target/controller.worker.js` (ver o plugin em
 * vite.config.ts). Mesmo protocolo de mensagens do original; as diferenças:
 *  - o casamento usa também as variantes deformadas do alvo (ver ./matcher);
 *  - a pose pode ser "flexível" (ver ../flexPose) quando a pele estica/achata
 *    e a pose rígida não se ajusta.
 */
import { Estimator } from 'mind-ar/src/image-target/estimation/estimator.js';
import { Matcher } from './matcher';
import { chooseTransform, estimateFlex, trimmedRms, type Intrinsics, type Pt, type Transform3x4 } from '../flexPose';

interface SetupMessage {
  type: 'setup';
  projectionTransform: Intrinsics;
  matchingDataList: unknown[][];
  debugMode: boolean;
  inputWidth: number;
  inputHeight: number;
}
interface MatchMessage {
  type: 'match';
  featurePoints: Pt[];
  targetIndexes: number[];
}
interface TrackUpdateMessage {
  type: 'trackUpdate';
  modelViewTransform: Transform3x4;
  worldCoords: Pt[];
  screenCoords: Pt[];
}
type Message = SetupMessage | MatchMessage | TrackUpdateMessage | { type: 'dispose' };

interface WorkerScope {
  onmessage: ((msg: { data: Message }) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}
const scope = self as unknown as WorkerScope;

let projectionTransform: Intrinsics | null = null;
let matchingDataList: unknown[][] | null = null;
let matcher: Matcher | null = null;
let estimator: InstanceType<typeof Estimator> | null = null;

/** Uma coluna da matriz já não ser unitária indica que o estado está no modo flexível. */
function isFlexState(t: Transform3x4): boolean {
  const n1 = Math.hypot(t[0]![0]!, t[1]![0]!, t[2]![0]!);
  const n2 = Math.hypot(t[0]![1]!, t[1]![1]!, t[2]![1]!);
  return Math.abs(n1 - n2) > 0.02 || Math.abs(n1 - 1) > 0.02;
}

scope.onmessage = (msg) => {
  const data = msg.data;
  switch (data.type) {
    case 'setup':
      projectionTransform = data.projectionTransform;
      matchingDataList = data.matchingDataList;
      matcher = new Matcher(data.inputWidth, data.inputHeight, data.debugMode);
      estimator = new Estimator(data.projectionTransform);
      break;

    case 'match': {
      let matchedTargetIndex = -1;
      let matchedModelViewTransform: Transform3x4 | null = null;
      let matchedDebugExtra: unknown = null;

      for (const matchingIndex of data.targetIndexes) {
        const result = matcher!.matchDetection(matchingDataList![matchingIndex] as never, data.featurePoints);
        matchedDebugExtra = result.debugExtra;
        if (result.keyframeIndex !== -1) {
          const screenCoords = result.screenCoords!;
          const worldCoords = result.worldCoords!;
          let rigid: Transform3x4 | null = null;
          try {
            rigid = estimator!.estimate({ screenCoords, worldCoords }) as Transform3x4 | null;
          } catch {
            rigid = null;
          }
          const flex = estimateFlex(screenCoords, worldCoords, projectionTransform!);
          const chosen = chooseTransform(rigid, flex, projectionTransform!, worldCoords, screenCoords);
          if (chosen.transform) {
            matchedTargetIndex = matchingIndex;
            matchedModelViewTransform = chosen.transform;
          }
          break;
        }
      }

      scope.postMessage({
        type: 'matchDone',
        targetIndex: matchedTargetIndex,
        modelViewTransform: matchedModelViewTransform,
        debugExtra: matchedDebugExtra,
      });
      break;
    }

    case 'trackUpdate': {
      const { modelViewTransform, worldCoords, screenCoords } = data;
      let refined: Transform3x4 | null = null;
      try {
        refined = estimator!.refineEstimate({
          initialModelViewTransform: modelViewTransform,
          worldCoords,
          screenCoords,
        }) as Transform3x4 | null;
      } catch {
        refined = null;
      }
      const flex = estimateFlex(screenCoords, worldCoords, projectionTransform!);
      // Já em modo flexível: a rígida só volta se ficar claramente melhor (evita vai-e-vem).
      let chosen = chooseTransform(refined, flex, projectionTransform!, worldCoords, screenCoords);
      if (isFlexState(modelViewTransform) && chosen.mode === 'rigid' && refined && flex) {
        const r = trimmedRms(refined, projectionTransform!, worldCoords, screenCoords);
        const f = trimmedRms(flex, projectionTransform!, worldCoords, screenCoords);
        if (r > 1.2 && f < r) chosen = { transform: flex, mode: 'flex' };
      }
      scope.postMessage({ type: 'trackUpdateDone', modelViewTransform: chosen.transform });
      break;
    }

    case 'dispose':
      scope.close();
      break;
  }
};
