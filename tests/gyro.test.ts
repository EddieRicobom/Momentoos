import { Quaternion, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gyroNeedsGesture, gyroSupported, rotationFromRate, startGyro, type GyroEnvironment } from '../src/tracking/gyro';

const angleOf = (q: Quaternion): number => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
const axisOf = (q: Quaternion): Vector3 => new Vector3(q.x, q.y, q.z).normalize();

describe('rotationFromRate', () => {
  it('beta gira em torno de x, gamma em torno de y e alpha em torno de z (graus por segundo)', () => {
    const x = rotationFromRate({ alpha: 0, beta: 90, gamma: 0 }, 1);
    expect(angleOf(x)).toBeCloseTo(Math.PI / 2);
    expect(axisOf(x).toArray()).toEqual([expect.closeTo(1), expect.closeTo(0), expect.closeTo(0)]);
    const y = rotationFromRate({ alpha: 0, beta: 0, gamma: 45 }, 2);
    expect(angleOf(y)).toBeCloseTo(Math.PI / 2);
    expect(axisOf(y).y).toBeCloseTo(1);
    const z = rotationFromRate({ alpha: 30, beta: 0, gamma: 0 }, 1);
    expect(angleOf(z)).toBeCloseTo(Math.PI / 6);
    expect(axisOf(z).z).toBeCloseTo(1);
  });

  it('o ângulo é proporcional ao tempo e ao módulo do vetor de velocidade', () => {
    const q = rotationFromRate({ alpha: 0, beta: 30, gamma: 40 }, 0.02);
    expect(angleOf(q)).toBeCloseTo((50 * Math.PI) / 180 * 0.02);
  });

  it('sentido: velocidade positiva em torno de y é anti-horária vista de cima (olha para a esquerda)', () => {
    const q = rotationFromRate({ alpha: 0, beta: 0, gamma: 90 }, 1);
    const forward = new Vector3(0, 0, -1).applyQuaternion(q);
    expect(forward.x).toBeLessThan(-0.9);
  });

  it.each([
    [0, [1, 0, 0]],
    [90, [0, 1, 0]],
    [180, [-1, 0, 0]],
    [270, [0, -1, 0]],
  ])('com a tela girada %s°, o eixo de beta (x do aparelho) vira o eixo %j da página', (angle, expected) => {
    const q = rotationFromRate({ alpha: 0, beta: 90, gamma: 0 }, 1, angle);
    const axis = axisOf(q);
    expect(axis.x).toBeCloseTo(expected[0]!);
    expect(axis.y).toBeCloseTo(expected[1]!);
    expect(axis.z).toBeCloseTo(0);
  });

  it.each([
    [0, [0, 1, 0]],
    [90, [-1, 0, 0]],
    [180, [0, -1, 0]],
    [270, [1, 0, 0]],
  ])('com a tela girada %s°, o eixo de gamma (y do aparelho) vira o eixo %j da página', (angle, expected) => {
    const axis = axisOf(rotationFromRate({ alpha: 0, beta: 0, gamma: 90 }, 1, angle));
    expect(axis.x).toBeCloseTo(expected[0]!);
    expect(axis.y).toBeCloseTo(expected[1]!);
  });

  it('o eixo z (alpha) não muda com a orientação da tela', () => {
    for (const angle of [0, 90, 180, 270]) {
      expect(axisOf(rotationFromRate({ alpha: 90, beta: 0, gamma: 0 }, 1, angle)).z).toBeCloseTo(1);
    }
  });

  it('velocidade zero, tempo inválido ou valores não finitos dão rotação nula', () => {
    for (const q of [
      rotationFromRate({ alpha: 0, beta: 0, gamma: 0 }, 1),
      rotationFromRate({ alpha: 10, beta: 0, gamma: 0 }, 0),
      rotationFromRate({ alpha: 10, beta: 0, gamma: 0 }, -1),
      rotationFromRate({ alpha: Number.NaN, beta: 0, gamma: 0 }, 1),
      rotationFromRate({ alpha: Number.POSITIVE_INFINITY, beta: 0, gamma: 0 }, 1),
    ]) {
      expect(q.equals(new Quaternion())).toBe(true);
    }
  });
});

class FakeTarget {
  private listeners = new Set<(event: Event) => void>();
  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.add(listener as (event: Event) => void);
  }
  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.delete(listener as (event: Event) => void);
  }
  get count(): number {
    return this.listeners.size;
  }
  emit(rotationRate: unknown): void {
    for (const listener of this.listeners) listener({ rotationRate } as unknown as Event);
  }
}

function makeEnvironment(overrides: Partial<GyroEnvironment> = {}) {
  const target = new FakeTarget();
  let now = 1000;
  let angle = 0;
  const environment: GyroEnvironment = {
    target,
    now: () => now,
    screenAngle: () => angle,
    supported: true,
    firstSampleTimeoutMs: 200,
    ...overrides,
  };
  return {
    environment,
    target,
    advance: (ms: number) => (now += ms),
    setAngle: (value: number) => (angle = value),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startGyro', () => {
  it('sem suporte, informa e não registra nada', async () => {
    const { environment, target } = makeEnvironment({ supported: false });
    expect(gyroSupported(environment)).toBe(false);
    const result = await startGyro(environment);
    expect(result).toMatchObject({ ok: false, problem: 'unsupported' });
    expect(target.count).toBe(0);
  });

  it('precisa de toque só quando o aparelho exige permissão (iOS)', () => {
    expect(gyroNeedsGesture(makeEnvironment().environment)).toBe(false);
    expect(gyroNeedsGesture(makeEnvironment({ requestPermission: async () => 'granted' }).environment)).toBe(true);
    expect(gyroNeedsGesture(makeEnvironment({ supported: false, requestPermission: async () => 'granted' }).environment)).toBe(false);
  });

  it('permissão negada ou com erro: problema "denied" sem escutar o sensor', async () => {
    for (const requestPermission of [async () => 'denied', async () => { throw new Error('x'); }]) {
      const { environment, target } = makeEnvironment({ requestPermission });
      expect(await startGyro(environment)).toMatchObject({ ok: false, problem: 'denied' });
      expect(target.count).toBe(0);
    }
  });

  it('sem nenhuma amostra com dados no prazo: "no-data" e o ouvinte é removido', async () => {
    const { environment, target } = makeEnvironment();
    const pending = startGyro(environment);
    target.emit(null); // computador: evento sem dados
    target.emit({ alpha: null, beta: null, gamma: null });
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ ok: false, problem: 'no-data' });
    expect(target.count).toBe(0);
  });

  it('com permissão e dados: devolve a fonte e a primeira amostra só marca o tempo', async () => {
    const { environment, target } = makeEnvironment({ requestPermission: async () => 'granted' });
    const pending = startGyro(environment);
    await vi.advanceTimersByTimeAsync(0);
    target.emit({ alpha: 0, beta: 90, gamma: 0 });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.takeRotation().equals(new Quaternion())).toBe(true);
    result.source.stop();
  });

  async function started() {
    const harness = makeEnvironment();
    const pending = startGyro(harness.environment);
    harness.target.emit({ alpha: 0, beta: 0, gamma: 0 });
    const result = await pending;
    if (!result.ok) throw new Error('esperado ok');
    return { ...harness, source: result.source };
  }

  it('integra as amostras seguintes e devolve a rotação acumulada, zerando depois', async () => {
    const { target, advance, source } = await started();
    for (let i = 0; i < 10; i += 1) {
      advance(20);
      target.emit({ alpha: 0, beta: 0, gamma: 50 }); // 50°/s por 0,2 s = 10°
    }
    const first = source.takeRotation();
    expect(angleOf(first)).toBeCloseTo((10 * Math.PI) / 180, 4);
    expect(axisOf(first).y).toBeCloseTo(1);
    expect(source.takeRotation().equals(new Quaternion())).toBe(true);
  });

  it('rotações em eixos diferentes se compõem na ordem do corpo', async () => {
    const { target, advance, source } = await started();
    advance(100);
    target.emit({ alpha: 0, beta: 0, gamma: 900 }); // 90° em torno de y
    advance(100);
    target.emit({ alpha: 0, beta: 900, gamma: 0 }); // depois 90° em torno de x
    const expected = rotationFromRate({ alpha: 0, beta: 0, gamma: 900 }, 0.1).multiply(rotationFromRate({ alpha: 0, beta: 900, gamma: 0 }, 0.1));
    const got = source.takeRotation();
    expect(Math.abs(got.dot(expected))).toBeCloseTo(1, 5);
  });

  it('usa o ângulo atual da tela a cada amostra', async () => {
    const { target, advance, setAngle, source } = await started();
    setAngle(90);
    advance(100);
    target.emit({ alpha: 0, beta: 90, gamma: 0 });
    expect(axisOf(source.takeRotation()).y).toBeCloseTo(1); // x do aparelho vira y da página
  });

  it('amostras com intervalo longo demais (aba parada) e sem dados são descartadas', async () => {
    const { target, advance, source } = await started();
    advance(5000);
    target.emit({ alpha: 0, beta: 0, gamma: 90 });
    advance(20);
    target.emit(null);
    advance(20);
    target.emit({ alpha: null, beta: 10, gamma: 10 });
    expect(source.takeRotation().equals(new Quaternion())).toBe(true);
  });

  it('stop remove o ouvinte e a fonte passa a devolver rotação nula', async () => {
    const { target, advance, source } = await started();
    advance(20);
    target.emit({ alpha: 0, beta: 0, gamma: 90 });
    source.stop();
    expect(target.count).toBe(0);
    expect(source.takeRotation().equals(new Quaternion())).toBe(true);
  });
});
