/**
 * Escolha da resolução em que o rastreamento contínuo olha o alvo.
 *
 * O MindAR sempre rastreia na versão de 128 px (lado menor) do alvo. Nela,
 * linhas finas viram traços de ~0,3 px e quase nenhum ponto passa nos filtros
 * de nitidez/unicidade (testado: 0–4 pontos em desenhos de linha fina, contra
 * 12–30 nos de traço grosso), e sem pontos o conteúdo nunca aparece.
 * Resolução maior = mais pontos, mas a janela de busca de ±10 px cobre menos do
 * alvo (tolera movimentos mais lentos). Por isso só sobe de resolução quando
 * precisa.
 */

/** Lados menores (px) candidatos, do mais barato ao mais detalhado. */
export const TRACKING_SIDES = [128, 192, 256, 384] as const;

/** Pontos suficientes para parar de subir de resolução. */
export const TRACKING_POINTS_GOOD = 16;

/** Menos que isto: o rastreio funciona mal ou nada (avisamos o usuário). */
export const TRACKING_POINTS_MIN = 8;

/** Razões de escala (lado candidato / lado menor do alvo), sem ampliar o alvo. */
export function trackingRatios(width: number, height: number): number[] {
  const minSide = Math.min(width, height);
  const ratios: number[] = [];
  for (const side of TRACKING_SIDES) {
    if (side <= minSide) ratios.push(side / minSide);
  }
  // alvos pequenos (< 128 px) não chegam aqui pelo app, mas não devem ficar sem candidato
  if (ratios.length === 0) ratios.push(1);
  return ratios;
}

/**
 * Do mais barato ao mais detalhado: fica com o primeiro que tiver pontos
 * suficientes; se nenhum tiver, o que tiver mais (empate: o mais barato).
 */
export function pickTrackingSet<T extends { points: ArrayLike<unknown> }>(candidates: readonly T[]): T {
  let best = candidates[0]!;
  for (const c of candidates) {
    if (c.points.length >= TRACKING_POINTS_GOOD) return c;
    if (c.points.length > best.points.length) best = c;
  }
  return best;
}

export type TrackingQuality = 'good' | 'low' | 'none';

/** Para avisar na criação do alvo. */
export function trackingQuality(points: number): TrackingQuality {
  if (points >= TRACKING_POINTS_MIN) return 'good';
  return points >= 4 ? 'low' : 'none';
}

/**
 * Suaviza com [1 2 1]/4 em x e y, `passes` vezes (≈ sigma de sqrt(passes/2) px).
 * Os modelos de comparação do rastreador ficam levemente suaves: casam melhor
 * com quadros reais (desfoque, ruído, serrilhado). Medido no laboratório: 2
 * passadas foi o melhor entre 0, 1, 2, 3 e 4.
 */
export function smoothGray(src: Uint8Array, width: number, height: number, passes: number): Uint8Array {
  let a = Uint8Array.from(src);
  let b = new Uint8Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const l = a[y * width + Math.max(0, x - 1)]!;
        const c = a[y * width + x]!;
        const r = a[y * width + Math.min(width - 1, x + 1)]!;
        b[y * width + x] = (l + 2 * c + r + 2) >> 2;
      }
    [a, b] = [b, a];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = a[Math.max(0, y - 1) * width + x]!;
        const c = a[y * width + x]!;
        const d = a[Math.min(height - 1, y + 1) * width + x]!;
        b[y * width + x] = (u + 2 * c + d + 2) >> 2;
      }
    [a, b] = [b, a];
  }
  return a;
}
