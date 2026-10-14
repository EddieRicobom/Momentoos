import type { Matrix4 } from 'three';
import type { GyroSource } from './gyro';
import { PoseSmoother } from './poseSmoother';
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

export interface AssistConfig {
  /** Suaviza a pose do rastreador (tira o tremor). Informe a proporção altura/largura do alvo. */
  smoothing?: { aspect: number };
  /**
   * Sem giroscópio: ao perder a tatuagem, mantém a última pose por este tempo (ms)
   * antes de informar a perda. Evita que o conteúdo pisque quando o rastreador
   * falha por um ou dois quadros.
   */
  graceMs?: number;
}

export class AnchorAssist {
  private stabilizer: PoseStabilizer | null = null;
  private source: GyroSource | null = null;
  private reported = false;
  private announcedSuspension = false;
  private readonly smoother: PoseSmoother | null;
  private readonly graceMs: number;
  /** Última pose mostrada (para segurar durante a graça). */
  private lastPose: Matrix4 | null = null;
  private graceUntil: number | null = null;

  constructor(
    private readonly anchor: AnchorLike,
    private readonly callbacks: AssistCallbacks,
    private readonly now: () => number = () => performance.now(),
    config: AssistConfig = {},
  ) {
    this.smoother = config.smoothing ? new PoseSmoother(config.smoothing.aspect) : null;
    this.graceMs = Math.max(0, config.graceMs ?? 0);
  }

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
    this.graceUntil = null;
    if (this.reported) return;
    this.reported = true;
    this.callbacks.found();
  }

  handleLost(): void {
    const stabilizer = this.stabilizer;
    // Com pose em mãos, quem decide a perda é o estabilizador (veja handleUpdate / handleFrame).
    if (stabilizer && stabilizer.hasPose && !stabilizer.suspended) return;
    if (this.graceMs > 0 && this.reported && this.lastPose) {
      // O MindAR já escondeu o grupo e trocou a matriz; devolvemos a última pose até a graça acabar.
      this.graceUntil = this.now() + this.graceMs;
      this.anchor.group.matrix = this.lastPose.clone();
      this.anchor.group.visible = true;
      return;
    }
    this.reportLost();
  }

  /** Depois de cada leitura do rastreador (a âncora já foi atualizada pelo MindAR). */
  handleUpdate(): void {
    const now = this.now();
    let measured: Matrix4 | null = null;
    if (this.anchor.visible) {
      measured = this.anchor.group.matrix.clone();
      if (this.smoother) measured = this.smoother.filter(measured, now);
    }
    const stabilizer = this.stabilizer;
    if (stabilizer) {
      this.apply(stabilizer.measure(measured, now));
      this.checkSuspension();
      return;
    }
    if (measured) {
      this.graceUntil = null;
      // Sempre uma matriz nova: o MindAR usa uma matriz compartilhada para "invisível".
      if (this.smoother) this.anchor.group.matrix = measured;
      this.lastPose = measured;
    }
  }

  /** A cada quadro de desenho. */
  handleFrame(): void {
    if (this.graceUntil !== null && this.now() >= this.graceUntil) {
      this.graceUntil = null;
      this.anchor.group.visible = false;
      this.lastPose = null;
      this.smoother?.reset();
      this.reportLost();
    }
    const stabilizer = this.stabilizer;
    if (!stabilizer || !this.source) return;
    stabilizer.rotate(this.source.takeRotation());
    if (!stabilizer.hasPose) return;
    this.apply(stabilizer.frame(this.now()));
  }

  // ------------------------------------------------------------ interno

  private apply(frame: StabilizedFrame): void {
    if (frame.matrix) {
      this.lastPose = frame.matrix;
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
