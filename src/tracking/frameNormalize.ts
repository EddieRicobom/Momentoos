/**
 * Normalização local de contraste do quadro da câmera.
 *
 * Por que: o detector do MindAR usa limiares absolutos de contraste. Com
 * sombra (a mão, o celular), contra-luz ou um lado do quadro bem mais escuro,
 * os pontos de interesse da parte sombreada somem e o alvo não é reconhecido
 * (medido no laboratório: 8 de 16 casos de luz difícil falhavam).
 *
 * O que faz: em cada pixel, tira a média local e escala para um desvio-padrão
 * local alvo, limitando o ganho (ganho alto amplificaria o ruído da pele lisa
 * em pouca luz). Janela de caixa separável (duas passadas 1-D): custo baixo.
 */
import * as tf from '@tensorflow/tfjs';

export interface NormalizeOptions {
  /** Lado da janela local, em pixels do quadro. */
  window: number;
  /** Desvio-padrão local desejado, em níveis de cinza (0-255). */
  targetStd: number;
  /** Ganho máximo (evita transformar ruído de pele lisa em "textura"). */
  maxGain: number;
}

export const DEFAULT_NORMALIZE: NormalizeOptions = { window: 33, targetStd: 35, maxGain: 3 };

/**
 * `gray`: tensor [altura, largura] com valores 0-255. Devolve um tensor NOVO
 * (a entrada não é alterada nem liberada). Quem chama libera os dois.
 */
export function normalizeLocalContrast(gray: tf.Tensor2D, options: NormalizeOptions = DEFAULT_NORMALIZE): tf.Tensor2D {
  const { window, targetStd, maxGain } = options;
  return tf.tidy(() => {
    // Trabalha em 0..1: aparelhos com textura de 16 bits perderiam precisão com x² até 65025.
    const x = gray.div(255).expandDims(0).expandDims(-1) as tf.Tensor4D;
    const box = (t: tf.Tensor4D): tf.Tensor4D =>
      tf.avgPool(tf.avgPool(t, [window, 1], 1, 'same'), [1, window], 1, 'same');
    const mean = box(x);
    const dev = x.sub(mean) as tf.Tensor4D;
    const std = box(dev.square() as tf.Tensor4D).add(1e-6).sqrt();
    const gain = tf.scalar(targetStd / 255).div(std).minimum(maxGain);
    const out = dev.mul(gain).mul(255).add(128).clipByValue(0, 255);
    return out.squeeze([0, 3]) as tf.Tensor2D;
  });
}

/**
 * Alterna quadros normalizados e crus. Cada um cobre o que o outro perde:
 * normalizado ganha em sombra/contra-luz, cru ganha em pouca luz com ruído.
 * Como basta UM quadro bom para reconhecer, a alternância fica com o melhor
 * dos dois sem precisar decidir qual é qual.
 */
export class FrameAlternator {
  private count = 0;

  /** true = normalizar este quadro. */
  next(): boolean {
    this.count += 1;
    return this.count % 2 === 1;
  }
}
