import { project, type Pt, type Transform3x4 } from '../src/tracking/flexPose';

/** Poses e correspondências sintéticas compartilhadas pelos testes de pose flexível. */
const f = 240 / Math.tan((45 * Math.PI) / 360);
export const K = [
  [f, 0, 320],
  [0, f, 240],
  [0, 0, 1],
];

export function rotation(tiltDeg: number, axisDeg: number, rotZDeg: number): number[][] {
  const mul = (a: number[][], b: number[][]) => a.map((_, i) => b[0]!.map((__, j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!));
  const axis = (axisDeg * Math.PI) / 180;
  const th = (tiltDeg * Math.PI) / 180;
  const [x, y] = [Math.cos(axis), Math.sin(axis)];
  const c = Math.cos(th);
  const s = Math.sin(th);
  const t = 1 - c;
  const tilt = [
    [t * x * x + c, t * x * y, s * y],
    [t * x * y, t * y * y + c, -s * x],
    [-s * y, s * x, c],
  ];
  const z = (rotZDeg * Math.PI) / 180;
  const rz = [
    [Math.cos(z), -Math.sin(z), 0],
    [Math.sin(z), Math.cos(z), 0],
    [0, 0, 1],
  ];
  return mul(tilt, rz);
}

/** Pose "verdadeira": plano esticado (sx, sy) com rotação R e translação t (em px do alvo). */
export function truePose(sx: number, sy: number, tiltDeg = 20, axisDeg = 30, rotZDeg = 15): Transform3x4 {
  const R = rotation(tiltDeg, axisDeg, rotZDeg);
  const t = [-80, 40, 1500];
  return [
    [R[0]![0]! * sx, R[0]![1]! * sy, R[0]![2]!, t[0]!],
    [R[1]![0]! * sx, R[1]![1]! * sy, R[1]![2]!, t[1]!],
    [R[2]![0]! * sx, R[2]![1]! * sy, R[2]![2]!, t[2]!],
  ];
}

export function gridPairs(pose: Transform3x4, n = 6): { world: Pt[]; screen: Pt[] } {
  const world: Pt[] = [];
  const screen: Pt[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const w = { x: (i * 600) / (n - 1), y: (j * 720) / (n - 1) };
      world.push(w);
      screen.push(project(pose, K, w.x, w.y)!);
    }
  return { world, screen };
}

