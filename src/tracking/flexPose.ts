/**
 * Pose "flexível": o MindAR calcula a pose como um corpo rígido, mas a pele de
 * uma tatuagem estica, achata e entorta. Para um plano, o que a câmera vê é
 * uma homografia (8 graus de liberdade); a pose rígida só tem 6. Este módulo
 * mantém os 8: acha a homografia pelas correspondências e a guarda numa matriz
 * 3x4 do mesmo formato do MindAR (colunas 1 e 2 NÃO são mais unitárias nem
 * ortogonais: a razão entre elas é o esticar/achatar).
 *
 * Como o rastreador, o filtro e a conversão para OpenGL do MindAR só fazem
 * álgebra linear com essa matriz 3x4, ela passa por todo o resto sem mudança.
 *
 * Parte pura (sem DOM): roda no worker e nos testes em Node.
 */
import { solveHomography } from 'mind-ar/src/image-target/utils/homography.js';

export interface Pt {
  x: number;
  y: number;
}

export type Transform3x4 = number[][];
export type Intrinsics = number[][];

/** Erro quadrático médio (px) dos 80% melhores pares: robusto a 1-2 pontos ruins. */
export function trimmedRms(
  transform: Transform3x4,
  K: Intrinsics,
  world: readonly Pt[],
  screen: readonly Pt[],
  keep = 0.8,
): number {
  const errs: number[] = [];
  for (let i = 0; i < world.length; i++) {
    const p = project(transform, K, world[i]!.x, world[i]!.y);
    if (p === null) {
      errs.push(Infinity);
      continue;
    }
    const dx = p.x - screen[i]!.x;
    const dy = p.y - screen[i]!.y;
    errs.push(dx * dx + dy * dy);
  }
  errs.sort((a, b) => a - b);
  const n = Math.max(1, Math.floor(errs.length * keep));
  let sum = 0;
  for (let i = 0; i < n; i++) sum += errs[i]!;
  return Math.sqrt(sum / n);
}

/** Projeta um ponto do plano do alvo (z = 0) para pixels. Null se estiver atrás da câmera. */
export function project(transform: Transform3x4, K: Intrinsics, x: number, y: number): Pt | null {
  const cx = transform[0]![0]! * x + transform[0]![1]! * y + transform[0]![3]!;
  const cy = transform[1]![0]! * x + transform[1]![1]! * y + transform[1]![3]!;
  const cz = transform[2]![0]! * x + transform[2]![1]! * y + transform[2]![3]!;
  if (!(cz > 1e-9)) return null;
  const u = K[0]![0]! * cx + K[0]![2]! * cz;
  const v = K[1]![1]! * cy + K[1]![2]! * cz;
  return { x: u / cz, y: v / cz };
}

/** Razão entre os comprimentos das colunas 1 e 2 (1 = pose rígida, sem esticar). */
export function stretchRatio(transform: Transform3x4): number {
  const n1 = Math.hypot(transform[0]![0]!, transform[1]![0]!, transform[2]![0]!);
  const n2 = Math.hypot(transform[0]![1]!, transform[1]![1]!, transform[2]![1]!);
  return n2 === 0 ? Infinity : n1 / n2;
}

/**
 * Homografia -> matriz 3x4, igual ao `estimate` do MindAR exceto por UM
 * detalhe: o MindAR normaliza as colunas 1 e 2 separadamente (jogando fora o
 * esticar); aqui as duas dividem pelo mesmo fator (a média geométrica), então
 * a razão entre elas sobrevive e a projeção reproduz a homografia exata.
 */
export function transformFromHomography(H: readonly number[], K: Intrinsics): Transform3x4 | null {
  const fx = K[0]![0]!;
  const fy = K[1]![1]!;
  const cx = K[0]![2]!;
  const cy = K[1]![2]!;
  // G = K⁻¹ · H (K = [[fx,0,cx],[0,fy,cy],[0,0,1]])
  const g = (col: number): [number, number, number] => {
    const h0 = H[col]!;
    const h1 = H[3 + col]!;
    const h2 = H[6 + col]!;
    return [(h0 - cx * h2) / fx, (h1 - cy * h2) / fy, h2];
  };
  const g1 = g(0);
  const g2 = g(1);
  const g3 = g(2);
  const n1 = Math.hypot(...g1);
  const n2 = Math.hypot(...g2);
  if (!(n1 > 0 && n2 > 0)) return null;
  let s = Math.sqrt(n1 * n2);
  // o alvo precisa ficar na frente da câmera (profundidade positiva)
  if (g3[2] < 0) s = -s;
  const c1 = g1.map((v) => v / s) as [number, number, number];
  const c2 = g2.map((v) => v / s) as [number, number, number];
  const c4 = g3.map((v) => v / s) as [number, number, number];
  const cross: [number, number, number] = [
    c1[1] * c2[2] - c1[2] * c2[1],
    c1[2] * c2[0] - c1[0] * c2[2],
    c1[0] * c2[1] - c1[1] * c2[0],
  ];
  const nc = Math.hypot(...cross);
  if (!(nc > 1e-9)) return null;
  const c3 = cross.map((v) => v / nc);
  return [
    [c1[0], c2[0], c3[0]!, c4[0]],
    [c1[1], c2[1], c3[1]!, c4[1]],
    [c1[2], c2[2], c3[2]!, c4[2]],
  ];
}

/** Aceita só matrizes plausíveis: nada de espelhadas, colapsadas ou absurdamente achatadas. */
export function isSane(transform: Transform3x4): boolean {
  const ratio = stretchRatio(transform);
  if (!(ratio > 0.12 && ratio < 8)) return false;
  const c1 = [transform[0]![0]!, transform[1]![0]!, transform[2]![0]!];
  const c2 = [transform[0]![1]!, transform[1]![1]!, transform[2]![1]!];
  const dot = c1[0]! * c2[0]! + c1[1]! * c2[1]! + c1[2]! * c2[2]!;
  const cos = dot / (Math.hypot(...c1) * Math.hypot(...c2));
  // ângulo entre os eixos x e y do alvo: tolera cisalhamento, rejeita colapso
  if (!(Math.abs(cos) < 0.87)) return false;
  return transform[2]![3]! > 0;
}

/**
 * Estima a transformação flexível. Faz mínimos quadrados e repete descartando
 * correspondências ruins (erro > max(3x a mediana, 3 px)).
 */
export function estimateFlex(
  screen: readonly Pt[],
  world: readonly Pt[],
  K: Intrinsics,
  minPoints = 6,
): Transform3x4 | null {
  if (screen.length < minPoints || world.length !== screen.length) return null;
  let idx = world.map((_, i) => i);
  let best: Transform3x4 | null = null;
  for (let pass = 0; pass < 3; pass++) {
    if (idx.length < minPoints) break;
    const H = solveHomography(
      idx.map((i) => [world[i]!.x, world[i]!.y]),
      idx.map((i) => [screen[i]!.x, screen[i]!.y]),
    ) as number[] | null;
    if (!H || H.some((v) => !Number.isFinite(v))) return best;
    const t = transformFromHomography(H, K);
    if (!t) return best;
    best = t;
    const errs = idx.map((i) => {
      const p = project(t, K, world[i]!.x, world[i]!.y);
      return p === null ? Infinity : Math.hypot(p.x - screen[i]!.x, p.y - screen[i]!.y);
    });
    const sorted = [...errs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const cut = Math.max(median * 3, 3);
    const kept = idx.filter((_, k) => errs[k]! <= cut);
    if (kept.length === idx.length || kept.length < minPoints) break;
    idx = kept;
  }
  return best;
}

export interface FlexChoice {
  transform: Transform3x4 | null;
  /** 'rigid' = o resultado do MindAR; 'flex' = homografia com esticar. */
  mode: 'rigid' | 'flex' | 'none';
}

/** Limites (px) de erro de reprojeção; ver escolha em `chooseTransform`. */
export const RIGID_GOOD_RMS = 2.5;
export const FLEX_MAX_RMS = 4.5;
/** Flex só substitui o rígido se reduzir o erro em pelo menos esta fração. */
export const FLEX_GAIN = 0.7;

/**
 * Escolhe entre a pose rígida (a de sempre) e a flexível. Preferência pela
 * rígida: ela é mais estável (6 graus de liberdade) e é o comportamento
 * testado do MindAR; a flexível entra quando a rígida não se ajusta.
 */
export function chooseTransform(
  rigid: Transform3x4 | null,
  flex: Transform3x4 | null,
  K: Intrinsics,
  world: readonly Pt[],
  screen: readonly Pt[],
): FlexChoice {
  const rigidRms = rigid ? trimmedRms(rigid, K, world, screen) : Infinity;
  if (rigid && rigidRms <= RIGID_GOOD_RMS) return { transform: rigid, mode: 'rigid' };
  const flexOk = flex !== null && isSane(flex);
  const flexRms = flexOk ? trimmedRms(flex!, K, world, screen) : Infinity;
  if (flexOk && flexRms <= FLEX_MAX_RMS && flexRms < rigidRms * FLEX_GAIN) {
    return { transform: flex, mode: 'flex' };
  }
  if (rigid) return { transform: rigid, mode: 'rigid' };
  return { transform: null, mode: 'none' };
}
