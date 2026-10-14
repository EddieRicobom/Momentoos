/**
 * Substitui `mind-ar/src/image-target/input-loader.js` (ver o plugin em
 * vite.config.ts): alterna quadros normalizados em contraste local e crus
 * (ver ../frameNormalize) enquanto PROCURA a tatuagem; depois de achá-la usa só
 * quadros crus (ver ../frameMode). Cada quadro serve ao detector e ao rastreador.
 */
// O caminho "de pacote" não é trocado pelo plugin (só importações relativas são), então isto é o original.
import { InputLoader as OriginalInputLoader } from 'mind-ar/src/image-target/input-loader.js';
import type { Tensor2D } from '@tensorflow/tfjs';
import { FrameAlternator, normalizeLocalContrast } from '../frameNormalize';
import { isSearchingFrames } from '../frameMode';

export class InputLoader extends OriginalInputLoader {
  private readonly alternator = new FrameAlternator();

  override loadInput(input: unknown): Tensor2D {
    const raw = super.loadInput(input);
    // Rastreando: só quadros crus (a pose não pode pular entre tipos de quadro).
    if (!isSearchingFrames() || !this.alternator.next()) return raw;
    try {
      const normalized = normalizeLocalContrast(raw);
      raw.dispose();
      return normalized;
    } catch {
      // Sem a normalização o app continua funcionando como o MindAR original.
      return raw;
    }
  }
}
