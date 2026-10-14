import { Quaternion, Vector3 } from 'three';

/**
 * Giroscópio do aparelho (evento `devicemotion`) como fonte de rotação da
 * câmera. Nada aqui foi exercitado em aparelho real: os testes usam eventos
 * simulados. Convenções assumidas (ver docs/RASTREAMENTO.md):
 *  - `rotationRate` em graus por segundo, `alpha` em torno de z (para fora da
 *    tela), `beta` em torno de x (direita) e `gamma` em torno de y (cima),
 *    regra da mão direita;
 *  - a câmera traseira olha para -z do aparelho, e a imagem na tela segue a
 *    orientação da página (`screen.orientation.angle`).
 */

export interface RotationRate {
  alpha: number;
  beta: number;
  gamma: number;
}

/** Amostras mais espaçadas que isto (aba em segundo plano, travada) são descartadas. */
const MAX_SAMPLE_GAP_S = 0.1;

const IDENTITY = (): Quaternion => new Quaternion();

/**
 * Rotação feita pela câmera durante `dtSeconds` com a velocidade angular dada,
 * no quadro da PÁGINA (x direita, y cima, z para fora da tela).
 */
export function rotationFromRate(rate: RotationRate, dtSeconds: number, screenAngleDeg = 0): Quaternion {
  const toRad = Math.PI / 180;
  // quadro do aparelho (x direita, y topo, z para fora): beta=x, gamma=y, alpha=z
  const dx = rate.beta * toRad;
  const dy = rate.gamma * toRad;
  const dz = rate.alpha * toRad;
  // a página gira junto com a tela: roda o vetor em z pelo ângulo da tela
  const angle = screenAngleDeg * toRad;
  const px = dx * Math.cos(angle) - dy * Math.sin(angle);
  const py = dx * Math.sin(angle) + dy * Math.cos(angle);
  const axis = new Vector3(px, py, dz);
  const speed = axis.length();
  if (!(speed > 0) || !(dtSeconds > 0) || !Number.isFinite(speed * dtSeconds)) return IDENTITY();
  return new Quaternion().setFromAxisAngle(axis.divideScalar(speed), speed * dtSeconds);
}

export interface GyroSource {
  /** Rotação acumulada da câmera desde a chamada anterior (e zera o acumulado). */
  takeRotation(): Quaternion;
  stop(): void;
}

export type GyroStart =
  | { ok: true; source: GyroSource }
  | { ok: false; problem: 'unsupported' | 'denied' | 'no-data'; message: string };

export interface MotionSample {
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null } | null;
}

export interface GyroEnvironment {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** Relógio em ms (padrão: performance.now). */
  now(): number;
  /** Ângulo da tela em graus (padrão: screen.orientation.angle). */
  screenAngle(): number;
  /** Pede permissão (iOS 13+). Ausente = não precisa pedir. */
  requestPermission?: () => Promise<string>;
  /** Existe suporte ao evento. */
  supported: boolean;
  /** Quanto esperar pela primeira amostra válida (ms). */
  firstSampleTimeoutMs?: number;
}

function browserEnvironment(): GyroEnvironment {
  const Motion = (typeof DeviceMotionEvent !== 'undefined' ? DeviceMotionEvent : undefined) as
    | (typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> })
    | undefined;
  return {
    target: window,
    now: () => performance.now(),
    screenAngle: () => screen.orientation?.angle ?? 0,
    supported: Motion !== undefined,
    ...(Motion?.requestPermission ? { requestPermission: () => Motion.requestPermission!() } : {}),
  };
}

/** O aparelho exige permissão explícita (iOS): então o início precisa acontecer num toque. */
export function gyroNeedsGesture(environment: GyroEnvironment = browserEnvironment()): boolean {
  return environment.supported && environment.requestPermission !== undefined;
}

export function gyroSupported(environment: GyroEnvironment = browserEnvironment()): boolean {
  return environment.supported;
}

/**
 * Liga o giroscópio. Em iOS precisa ser chamado de dentro de um toque. Só
 * devolve `ok` depois de receber uma amostra com velocidade angular: alguns
 * computadores disparam o evento sem dados.
 */
export async function startGyro(environment: GyroEnvironment = browserEnvironment()): Promise<GyroStart> {
  if (!environment.supported) {
    return { ok: false, problem: 'unsupported', message: 'Este navegador não expõe o giroscópio.' };
  }
  if (environment.requestPermission) {
    let answer: string;
    try {
      answer = await environment.requestPermission();
    } catch {
      return { ok: false, problem: 'denied', message: 'Não foi possível pedir permissão ao giroscópio.' };
    }
    if (answer !== 'granted') {
      return { ok: false, problem: 'denied', message: 'A permissão do giroscópio foi negada.' };
    }
  }

  let accumulated = IDENTITY();
  let last: number | null = null;
  let stopped = false;
  let sawData = false;
  let onFirstData: (() => void) | null = null;

  const listener = (event: Event): void => {
    const rate = (event as unknown as MotionSample).rotationRate;
    const now = environment.now();
    const previous = last;
    last = now;
    if (!rate || rate.alpha == null || rate.beta == null || rate.gamma == null) return;
    if (!sawData) {
      sawData = true;
      onFirstData?.();
    }
    if (previous === null) return;
    const dt = (now - previous) / 1000;
    if (!(dt > 0) || dt > MAX_SAMPLE_GAP_S) return;
    const step = rotationFromRate(
      { alpha: rate.alpha, beta: rate.beta, gamma: rate.gamma },
      dt,
      environment.screenAngle(),
    );
    // rotação do corpo: o passo novo entra à direita do acumulado
    accumulated = accumulated.multiply(step).normalize();
  };

  environment.target.addEventListener('devicemotion', listener);
  const stop = (): void => {
    stopped = true;
    environment.target.removeEventListener('devicemotion', listener);
  };

  const first = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(sawData), environment.firstSampleTimeoutMs ?? 1500);
    onFirstData = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });
  if (!first) {
    stop();
    return {
      ok: false,
      problem: 'no-data',
      message: 'O aparelho não enviou dados do giroscópio (sensor ausente ou bloqueado).',
    };
  }

  return {
    ok: true,
    source: {
      takeRotation: () => {
        const rotation = accumulated;
        accumulated = IDENTITY();
        return stopped ? IDENTITY() : rotation;
      },
      stop,
    },
  };
}
