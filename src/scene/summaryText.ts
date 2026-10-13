import type { RuntimeSummary } from './runtime';

/** Texto curto do estado de carregamento dos itens, para a tela da câmera. */
export function describeSummary(summary: RuntimeSummary): string {
  const expected = summary.total - summary.skipped;
  if (expected <= 0) return '';
  const parts: string[] = [];
  if (summary.loading > 0) parts.push(`Carregando itens: ${summary.ready + summary.failed.length}/${expected}`);
  else parts.push(`Itens: ${summary.ready}/${expected} prontos`);
  if (summary.failed.length > 0) {
    parts.push(`${summary.failed.length} com erro`);
  }
  return parts.join(' · ');
}

/** Mensagens detalhadas (erros e avisos) para mostrar ao usuário. */
export function describeProblems(summary: RuntimeSummary): string[] {
  return [...summary.failed.map((f) => `${f.name}: ${f.message}`), ...summary.notes];
}
