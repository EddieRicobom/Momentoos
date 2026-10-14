/**
 * Gera os keyframes de reconhecimento das variantes do alvo (usa o detector do
 * MindAR, que depende de TensorFlow.js/WebGL: não roda em Node; o teste de
 * verdade é tools/detect-lab).
 *
 * Reaproveita as peças do próprio mind-ar (pirâmide de escalas, detector e
 * agrupamento hierárquico) exatamente como `_extractMatchingFeatures` do
 * compiler-base.js, só que sobre a imagem deformada.
 */
import * as tf from '@tensorflow/tfjs';
import { Detector } from 'mind-ar/src/image-target/detector/detector.js';
import { buildImageList } from 'mind-ar/src/image-target/image-list.js';
import { build as buildCluster } from 'mind-ar/src/image-target/matching/hierarchical-clustering.js';
import {
  DEFAULT_VARIANT_CONFIG,
  applyAffine,
  keyframeToTarget,
  pickScaleIndexes,
  variantSpecs,
  warpCompressed,
  type GrayImage,
  type VariantConfig,
} from './targetVariants';

interface RawPoint {
  x: number;
  y: number;
  maxima: boolean;
}

export interface VariantKeyframe {
  maximaPoints: RawPoint[];
  minimaPoints: RawPoint[];
  maximaPointsCluster: unknown;
  minimaPointsCluster: unknown;
  width: number;
  height: number;
  scale: number;
  variant: { group: number; toTarget: number[] };
}

/** Margem (px do alvo) tolerada para um ponto da variante cair fora do retângulo original. */
const EDGE_MARGIN = 2;

export async function buildVariantKeyframes(
  target: GrayImage,
  config: VariantConfig = DEFAULT_VARIANT_CONFIG,
  onProgress: (fraction: number) => void = () => {},
): Promise<VariantKeyframe[]> {
  const specs = variantSpecs(config);
  const out: VariantKeyframe[] = [];
  for (let s = 0; s < specs.length; s++) {
    const spec = specs[s]!;
    const warped = warpCompressed(target, spec.tilt, spec.direction);
    const list = buildImageList({ data: warped.data, width: warped.width, height: warped.height }) as Array<{
      data: Uint8Array;
      width: number;
      height: number;
      scale: number;
    }>;
    const picks = pickScaleIndexes(list.length, config.scaleStride);
    for (const idx of picks) {
      const image = list[idx]!;
      const toTarget = keyframeToTarget(warped.toSource, image.scale);
      const detector = new Detector(image.width, image.height);
      await tf.nextFrame();
      tf.tidy(() => {
        const input = tf.tensor(image.data, [image.data.length], 'float32').reshape([image.height, image.width]);
        const { featurePoints } = detector.detect(input) as { featurePoints: RawPoint[] };
        const inside = featurePoints.filter((p) => {
          const [tx, ty] = applyAffine(toTarget, p.x + 0.5, p.y + 0.5);
          return (
            tx >= -EDGE_MARGIN && ty >= -EDGE_MARGIN && tx <= target.width + EDGE_MARGIN && ty <= target.height + EDGE_MARGIN
          );
        });
        const maximaPoints = inside.filter((p) => p.maxima);
        const minimaPoints = inside.filter((p) => !p.maxima);
        out.push({
          maximaPoints,
          minimaPoints,
          maximaPointsCluster: buildCluster({ points: maximaPoints }),
          minimaPointsCluster: buildCluster({ points: minimaPoints }),
          width: image.width,
          height: image.height,
          scale: image.scale,
          variant: { group: spec.group, toTarget },
        });
      });
    }
    onProgress((s + 1) / specs.length);
  }
  return out;
}
