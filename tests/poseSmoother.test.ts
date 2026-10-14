import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PoseSmoother } from '../src/tracking/poseSmoother';

/** Pose como a do MindAR: escala = largura do alvo em unidades da câmera (aqui 600). */
const SCALE = 600;
const pose = (x = 0, y = 0, yawDeg = 0): Matrix4 =>
  new Matrix4().compose(
    new Vector3(x, y, -1000),
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (yawDeg * Math.PI) / 180),
    new Vector3(SCALE, SCALE, SCALE),
  );

/** Gerador pseudo-aleatório determinístico (-1..1). */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return (s / 4294967296) * 2 - 1;
  };
}

const tx = (m: Matrix4): number => m.elements[12]!;
const std = (values: number[]): number => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
};

describe('PoseSmoother', () => {
  it('a primeira leitura passa direto', () => {
    const smoother = new PoseSmoother(0.75);
    expect(tx(smoother.filter(pose(40), 0))).toBe(40);
  });

  it('devolve matrizes novas (nunca a mesma instância)', () => {
    const smoother = new PoseSmoother(0.75);
    const raw = pose(10);
    const a = smoother.filter(raw, 0);
    const b = smoother.filter(raw, 33);
    expect(a).not.toBe(raw);
    expect(b).not.toBe(a);
  });

  it('reduz bastante o tremor com o alvo parado', () => {
    const smoother = new PoseSmoother(0.75);
    const noise = rng(7);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      // ±2 px de ruído numa largura de 600 px (~0,3% da largura)
      const m = pose(100 + noise() * 2, 50 + noise() * 2);
      const filtered = smoother.filter(m, i * 33);
      if (i >= 30) {
        raw.push(tx(m));
        out.push(tx(filtered));
      }
    }
    expect(std(out)).toBeLessThan(std(raw) / 3);
  });

  it('segue um movimento rápido sem ficar muito atrás', () => {
    const smoother = new PoseSmoother(0.75);
    let last = 0;
    // 1 largura de alvo por segundo (600 px/s) por 1 s
    for (let i = 0; i <= 30; i += 1) {
      last = tx(smoother.filter(pose(i * 20), i * 33));
    }
    const lag = 600 - last;
    expect(lag).toBeLessThan(60); // < 10% da largura do alvo
    expect(lag).toBeGreaterThanOrEqual(0);
  });

  it('chega à nova posição depois de um degrau', () => {
    const smoother = new PoseSmoother(0.75);
    for (let i = 0; i < 20; i += 1) smoother.filter(pose(0), i * 33);
    let value = 0;
    for (let i = 20; i < 80; i += 1) value = tx(smoother.filter(pose(300), i * 33));
    expect(value).toBeGreaterThan(290);
  });

  it('zona morta: diferença minúscula quase não move a pose', () => {
    const smoother = new PoseSmoother(0.75);
    for (let i = 0; i < 20; i += 1) smoother.filter(pose(0), i * 33);
    const before = tx(smoother.filter(pose(0), 20 * 33));
    const after = tx(smoother.filter(pose(0.3), 21 * 33)); // 0,05% da largura
    expect(Math.abs(after - before)).toBeLessThan(0.05);
  });

  it('depois de uma pausa longa recomeça da leitura nova', () => {
    const smoother = new PoseSmoother(0.75);
    smoother.filter(pose(0), 0);
    smoother.filter(pose(0), 33);
    expect(tx(smoother.filter(pose(500), 5000))).toBe(500);
  });

  it('reset() faz a próxima leitura passar direto', () => {
    const smoother = new PoseSmoother(0.75);
    smoother.filter(pose(0), 0);
    smoother.reset();
    expect(smoother.current).toBeNull();
    expect(tx(smoother.filter(pose(80), 33))).toBe(80);
  });

  it('suaviza o giro também (cantos do alvo contam, não só o centro)', () => {
    const smoother = new PoseSmoother(0.75);
    const noise = rng(3);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      const m = pose(0, 0, noise() * 1.0); // ±1° de ruído
      const f = smoother.filter(m, i * 33);
      if (i >= 30) {
        raw.push(m.elements[1]!);
        out.push(f.elements[1]!);
      }
    }
    expect(std(out)).toBeLessThan(std(raw) / 2.5);
  });

  it('mantém a pose não rígida (esticada) elemento a elemento', () => {
    const smoother = new PoseSmoother(0.75);
    const stretched = new Matrix4().set(600, 120, 0, 10, 0, 300, 0, 20, 0, 0, 600, -1000, 0, 0, 0, 1);
    smoother.filter(stretched, 0);
    const out = smoother.filter(stretched, 33);
    for (let i = 0; i < 16; i += 1) expect(out.elements[i]).toBeCloseTo(stretched.elements[i]!, 6);
  });
});
