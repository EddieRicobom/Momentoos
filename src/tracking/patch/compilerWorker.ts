/**
 * Substitui `mind-ar/src/image-target/compiler.worker.js` (ver o plugin em
 * vite.config.ts): compila os pontos de rastreamento do alvo, mas escolhendo a
 * resolução (ver ../trackingScales) em vez de fixar 256 e 128 px.
 *
 * Mesmo protocolo do original. O Tracker do MindAR usa o elemento [1] da lista;
 * ele recebe o conjunto escolhido, e o [0] guarda o conjunto mais barato.
 */
import { extract } from 'mind-ar/src/image-target/tracker/extract.js';
import { resize } from 'mind-ar/src/image-target/utils/images.js';
import { TRACKING_POINTS_GOOD, pickTrackingSet, smoothGray, trackingRatios } from '../trackingScales';

interface GrayTarget {
  data: Uint8Array;
  width: number;
  height: number;
}
interface FeatureSet {
  data: Uint8Array;
  scale: number;
  width: number;
  height: number;
  points: Array<{ x: number; y: number }>;
}
interface WorkerScope {
  onmessage: ((msg: { data: { type: string; targetImages: GrayTarget[] } }) => void) | null;
  postMessage(message: unknown): void;
}
const scope = self as unknown as WorkerScope;

/** 2 passadas ≈ sigma 1 px. Medido no laboratório (0, 1, 2, 3, 4): 2 foi a melhor (ver docs/DETECCAO.md). */
const TEMPLATE_BLUR_PASSES = 2;

function featureSetAt(target: GrayTarget, ratio: number): FeatureSet {
  const image = resize({ image: target, ratio });
  const scaled = { ...image, scale: ratio };
  const points = extract(scaled);
  // Os pontos são escolhidos na imagem nítida; os modelos de comparação usam uma
  // versão levemente suavizada, que casa melhor com quadros reais (foco, ruído, serrilhado).
  const data = smoothGray(image.data, image.width, image.height, TEMPLATE_BLUR_PASSES);
  return { data, scale: ratio, width: image.width, height: image.height, points };
}

scope.onmessage = ({ data }) => {
  if (data.type !== 'compile') return;
  const { targetImages } = data;
  const list: FeatureSet[][] = [];
  targetImages.forEach((target, index) => {
    const ratios = trackingRatios(target.width, target.height);
    const candidates: FeatureSet[] = [];
    for (const ratio of ratios) {
      const set = featureSetAt(target, ratio);
      candidates.push(set);
      if (set.points.length >= TRACKING_POINTS_GOOD) break; // não precisa subir mais
    }
    const chosen = pickTrackingSet(candidates);
    list.push([candidates[0]!, chosen]);
    scope.postMessage({ type: 'progress', percent: ((index + 1) / targetImages.length) * 100 });
  });
  scope.postMessage({ type: 'compileDone', list });
};
