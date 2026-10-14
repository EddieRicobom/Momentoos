import { TRACKING_POINTS_MIN, trackingQuality } from './trackingScales';

/** O que sabemos sobre a qualidade de um alvo compilado (sem abrir a câmera). */
export interface TargetDiagnostics {
  /** Pontos de apoio do rastreamento contínuo (quanto mais, mais firme o conteúdo). */
  trackingPoints: number;
  /** Keyframes de variantes esticadas/inclinadas (0 = alvo só de frente, como no MindAR puro). */
  variantKeyframes: number;
}

export interface DiagnosticsText {
  /** Linha informativa, sempre presente. */
  summary: string;
  /** Aviso para o usuário agir (ou null quando está tudo bem). */
  warning: string | null;
}

export function describeDiagnostics(d: TargetDiagnostics, canRecompile: boolean): DiagnosticsText {
  const quality = trackingQuality(d.trackingPoints);
  const variants =
    d.variantKeyframes > 0
      ? 'reconhece também em ângulos fortes e com a pele esticada ou achatada'
      : 'sem variantes de ângulo/esticamento';
  const summary = `Rastreio: ${d.trackingPoints} ponto${d.trackingPoints === 1 ? '' : 's'} de apoio · ${variants}.`;

  const warnings: string[] = [];
  if (quality === 'none') {
    warnings.push(
      `Esta imagem quase não tem pontos de apoio para rastrear (${d.trackingPoints}; o mínimo recomendado é ${TRACKING_POINTS_MIN}). O app pode até reconhecê-la, mas o conteúdo provavelmente não vai fixar. Tente recortar uma área com detalhes mais variados (evite padrões muito repetidos ou linhas muito finas).`,
    );
  } else if (quality === 'low') {
    warnings.push(
      `Poucos pontos de apoio para rastrear (${d.trackingPoints}; o recomendado é ${TRACKING_POINTS_MIN} ou mais). O conteúdo pode tremer ou sumir. Tente recortar uma área com detalhes mais variados.`,
    );
  }
  if (d.variantKeyframes === 0) {
    warnings.push(
      canRecompile
        ? 'Este alvo foi compilado sem as variantes de ângulo/esticamento. Recompile a partir da foto para reconhecer melhor em ângulos fortes e com a pele esticada.'
        : 'Este alvo não tem as variantes de ângulo/esticamento (veio de um .mind antigo). Compile a imagem de novo no app para reconhecer melhor em ângulos fortes e com a pele esticada.',
    );
  }
  return { summary, warning: warnings.length > 0 ? warnings.join(' ') : null };
}
