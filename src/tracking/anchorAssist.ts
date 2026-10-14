import type { Matrix4 } from 'three';
import type { GyroSource } from './gyro';
import { PoseStabilizer, type StabilizedFrame, type StabilizerOptions } from './poseStabilizer';

/**
 * Cola entre a âncora do MindAR e o estabilizador por giroscópio. Sem o
 * giroscópio ligado, repassa "achou" e "perdeu" do MindAR como chegam. Com ele:
 *  - a pose é misturada com a previsão do giroscópio a cada leitura;
 *  - a pose é girada com o giroscópio a cada quadro de desenho;
 *  - ao perder a tatuagem, a pose é mantida por um tempo curto, e só depois o
 *    "perdeu" é informado (e o grupo é escondido).
 */

export interface AnchorLike {
  visible: boolean;
  group: { matrix: Matrix4; visible: boolean };
}

export interface AssistCallbacks {
  found(): void;
  lost(): void;
  /** O giroscópio discordou da câmera e foi suspenso (chamado uma vez). */
  suspended?(): void;
}

export class AnchorAssist {
  private stabilizer: PoseStabilizer | null = null;
  private source: GyroSource | null = null;
  private reported = false;
  private announcedSuspension = false;

  constructor(
    private readonly anchor: AnchorLike,
    private readonly callbacks: AssistCallbacks,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get active(): boolean {
    return this.stabilizer !== null;
  }

  /** O giroscópio foi suspenso por discordar da câmera. */
  get suspended(): boolean {
    return this.stabilizer?.suspended ?? false;
  }

  /** Liga a estabilização com a fonte dada (a próxima leitura do rastreador semeia a pose). */
  enable(source: GyroSource, options: Partial<StabilizerOptions> = {}): void {
    this.disable();
    this.source = source;
    this.stabilizer = new PoseStabilizer(options);
    this.announcedSuspension = false;
  }

  /** Desliga. Se estava segurando a pose, a perda é informada agora. */
  disable(): void {
    const wasHolding = this.stabilizer?.holding ?? false;
    this.stabilizer = null;
    this.source?.stop();
    this.source = null;
    if (wasHolding) {
      this.anchor.group.visible = false;
      this.reportLost();
    }
  }

  /** Encerra a sessão: solta o sensor sem informar nada. */
  dispose(): void {
    this.stabilizer = null;
    this.source?.stop();
    this.source = null;
  }

  // ------------------------------------------------------------ ganchos do MindAR

  handleFound(): void {
    if (this.reported) return;
    this.reported = true;
    this.callbacks.found();
  }

  handleLost(): void {
    const stabilizer = this.stabilizer;
    // Com pose em mãos, quem decide a perda é o estabilizador (veja handleUpdate / handleFrame).
    if (stabilizer && stabilizer.hasPose && !stabilizer.suspended) return;
    this.reportLost();
  }

  /** Depois de cada leitura do rastreador (a âncora já foi atualizada pelo MindAR). */
  handleUpdate(): void {
    const stabilizer = this.stabilizer;
    if (!stabilizer) return;
    const measured = this.anchor.visible ? this.anchor.group.matrix.clone() : null;
    this.apply(stabilizer.measure(measured, this.now()));
    this.checkSuspension();
  }

  /** A cada quadro de desenho. */
  handleFrame(): void {
    const stabilizer = this.stabilizer;
    if (!stabilizer || !this.source) return;
    stabilizer.rotate(this.source.takeRotation());
    if (!stabilizer.hasPose) return;
    this.apply(stabilizer.frame(this.now()));
  }

  // ------------------------------------------------------------ interno

  private apply(frame: StabilizedFrame): void {
    if (frame.matrix) {
      // Sempre uma matriz nova: o MindAR usa uma matriz compartilhada para "invisível".
      this.anchor.group.matrix = frame.matrix;
      this.anchor.group.visible = true;
      if (!this.reported) this.handleFound();
    } else if (frame.expired) {
      this.anchor.group.visible = false;
      this.reportLost();
    }
  }

  private checkSuspension(): void {
    if (this.announcedSuspension || !this.stabilizer?.suspended) return;
    this.announcedSuspension = true;
    this.callbacks.suspended?.();
  }

  private reportLost(): void {
    if (!this.reported) return;
    this.reported = false;
    this.callbacks.lost();
  }
}
