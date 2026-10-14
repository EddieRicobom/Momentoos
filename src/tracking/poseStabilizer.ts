import { Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Estabilizador de pose com giroscópio (contas puras, sem sensores nem DOM).
 *
 * Ideia: entre duas leituras do rastreador, a câmera quase só GIRA (a mão
 * balança mais do que se desloca). O giroscópio mede essa rotação muito mais
 * rápido (60+ Hz) do que o MindAR entrega poses (dezenas por segundo). Então:
 *
 *  1. a cada quadro de desenho, a última pose é girada ao contrário da rotação
 *     que a câmera fez (um ponto fixo no mundo "anda" ao contrário na imagem);
 *  2. quando o rastreador entrega uma pose nova, ela é MISTURADA com a pose
 *     prevista pelo giroscópio (suaviza o tremor; se as duas discordam muito,
 *     vale a medida do rastreador);
 *  3. se o rastreador perde a tatuagem, a pose segue a rotação do giroscópio
 *     por um tempo curto (`holdMs`) antes de sumir.
 *
 * Limites assumidos (não validados em aparelho real):
 *  - só rotação é compensada; deslocar o celular não é medido pelo giroscópio;
 *  - o giroscópio acumula erro (viés), por isso o "segurar" é curto;
 *  - se o giroscópio do aparelho discordar da câmera de forma consistente
 *    (sinal/eixos invertidos, por exemplo), o estabilizador se SUSPENDE sozinho
 *    e passa a repassar as poses do rastreador sem alterá-las.
 */

export interface StabilizerOptions {
  /** Peso (0 a 1) da medida do rastreador ao misturar com a previsão. 1 = ignora a previsão. */
  blend: number;
  /** Quanto tempo a pose segue só o giroscópio depois que o rastreador perde a tatuagem (ms). */
  holdMs: number;
  /** Acima desta diferença de ângulo (graus) entre previsão e medida, vale só a medida. */
  maxAngleDeg: number;
  /** Acima desta diferença de posição (em larguras do alvo), vale só a medida. */
  maxShift: number;
}

export const DEFAULT_STABILIZER: StabilizerOptions = {
  blend: 0.6,
  holdMs: 800,
  maxAngleDeg: 8,
  maxShift: 0.25,
};

/** Giro mínimo (graus) entre duas medidas para a comparação com o giroscópio valer. */
const MIN_MOTION_DEG = 1.5;
/** Quantas comparações recentes entram na decisão de suspender. */
const AGREEMENT_WINDOW = 16;
const AGREEMENT_MIN_SAMPLES = 10;
/** Fração de comparações "piores com giroscópio" a partir da qual se suspende. */
const DISAGREE_RATIO = 0.7;

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;

export interface StabilizedFrame {
  /** Pose a desenhar (nova a cada chamada); null = não desenhar. */
  matrix: Matrix4 | null;
  /** A pose vem só do giroscópio (rastreador sem a tatuagem). */
  held: boolean;
  /** O tempo de "segurar" acabou agora: a tatuagem deve ser dada como perdida. */
  expired: boolean;
}

type Mode = 'idle' | 'tracking' | 'holding';

export class PoseStabilizer {
  private readonly options: StabilizerOptions;
  private mode: Mode = 'idle';
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  /** Orientação logo depois da última medida, antes de girar com o giroscópio. */
  private readonly anchorQuaternion = new Quaternion();
  private heldSince = 0;
  private samples: boolean[] = [];
  private suspendedFlag = false;

  constructor(options: Partial<StabilizerOptions> = {}) {
    this.options = { ...DEFAULT_STABILIZER, ...options };
  }

  /** Há uma pose para desenhar (rastreando ou segurando). */
  get hasPose(): boolean {
    return this.mode !== 'idle';
  }

  get holding(): boolean {
    return this.mode === 'holding';
  }

  /** O giroscópio discordou da câmera e foi desligado; as poses passam sem alteração. */
  get suspended(): boolean {
    return this.suspendedFlag;
  }

  /** Rotação que a CÂMERA fez desde a chamada anterior (no quadro da câmera). */
  rotate(cameraRotation: Quaternion): void {
    if (this.mode === 'idle' || this.suspendedFlag) return;
    const inverse = cameraRotation.clone().invert();
    this.position.applyQuaternion(inverse);
    this.quaternion.premultiply(inverse).normalize();
  }

  /** O rastreador entregou uma pose (matriz) ou informou que perdeu a tatuagem (null). */
  measure(matrix: Matrix4 | null, nowMs: number): StabilizedFrame {
    if (matrix === null) return this.measureLoss(nowMs);

    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    matrix.decompose(position, quaternion, scale);

    if (this.mode === 'idle' || this.suspendedFlag) {
      if (this.mode === 'idle') this.samples = [];
      this.set(position, quaternion, scale);
    } else {
      this.fuse(position, quaternion, scale);
    }
    this.mode = 'tracking';
    return this.current(false);
  }

  /** A cada quadro de desenho (depois de `rotate`). */
  frame(nowMs: number): StabilizedFrame {
    if (this.mode === 'holding') {
      if (nowMs - this.heldSince >= this.options.holdMs) {
        this.mode = 'idle';
        return { matrix: null, held: false, expired: true };
      }
      return this.current(true);
    }
    if (this.mode === 'tracking') return this.current(false);
    return { matrix: null, held: false, expired: false };
  }

  /** Esquece a pose (câmera reiniciada, giroscópio desligado). */
  reset(): void {
    this.mode = 'idle';
    this.samples = [];
  }

  private measureLoss(nowMs: number): StabilizedFrame {
    if (this.mode === 'holding') return this.frame(nowMs);
    if (this.mode === 'idle') return { matrix: null, held: false, expired: false };
    if (this.options.holdMs > 0 && !this.suspendedFlag) {
      this.mode = 'holding';
      this.heldSince = nowMs;
      return this.current(true);
    }
    this.mode = 'idle';
    return { matrix: null, held: false, expired: true };
  }

  private fuse(position: Vector3, quaternion: Quaternion, scale: Vector3): void {
    const predictedAngle = this.quaternion.angleTo(quaternion);
    const shift = this.position.distanceTo(position) / Math.max(scale.x, 1e-6);

    this.observeAgreement(quaternion);
    if (this.suspendedFlag) {
      this.set(position, quaternion, scale);
      return;
    }

    const trustMeasurement =
      predictedAngle > toRad(this.options.maxAngleDeg) || shift > this.options.maxShift;
    const weight = trustMeasurement ? 1 : this.options.blend;
    this.position.lerp(position, weight);
    this.quaternion.slerp(quaternion, weight).normalize();
    this.scale.copy(scale);
    this.anchorQuaternion.copy(this.quaternion);
  }

  /**
   * Compara, a cada medida com giro suficiente, a previsão do giroscópio com a
   * pose anterior sem previsão. Se o giroscópio quase sempre PIORA o resultado,
   * ele está discordando da câmera: suspende.
   */
  private observeAgreement(measured: Quaternion): void {
    if (this.mode !== 'tracking') {
      this.samples = [];
      return;
    }
    const gyroAngle = this.anchorQuaternion.angleTo(this.quaternion);
    if (gyroAngle < toRad(MIN_MOTION_DEG)) return;
    const errorWithGyro = this.quaternion.angleTo(measured);
    const errorWithout = this.anchorQuaternion.angleTo(measured);
    this.samples.push(errorWithGyro > errorWithout);
    if (this.samples.length > AGREEMENT_WINDOW) this.samples.shift();
    if (this.samples.length >= AGREEMENT_MIN_SAMPLES) {
      const worse = this.samples.filter(Boolean).length;
      if (worse / this.samples.length >= DISAGREE_RATIO) this.suspendedFlag = true;
    }
  }

  private set(position: Vector3, quaternion: Quaternion, scale: Vector3): void {
    this.position.copy(position);
    this.quaternion.copy(quaternion);
    this.scale.copy(scale);
    this.anchorQuaternion.copy(quaternion);
  }

  private current(held: boolean): StabilizedFrame {
    return {
      matrix: new Matrix4().compose(this.position, this.quaternion, this.scale),
      held,
      expired: false,
    };
  }
}
