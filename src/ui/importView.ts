import { BackupError, DEFAULT_LIMITS, importBackup, BACKUP_EXTENSION, type ImportReport } from '../storage/backup';
import { topBar } from './components';
import type { View } from './context';
import { describeError, formatBytes, formatDateTime, h } from './dom';

export const importView: View = (context, root) => {
  let disposed = false;
  let busy = false;

  const input = h('input', { type: 'file', accept: `.zip,${BACKUP_EXTENSION},application/zip`, hidden: true });
  const pick = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => input.click() }, 'Escolher arquivo de backup');
  const status = h('p', { class: 'muted', role: 'status' });
  status.hidden = true;
  const error = h('p', { class: 'form-error', role: 'alert' });
  error.hidden = true;
  const result = h('div', { class: 'stack' });

  async function run(file: File): Promise<void> {
    if (busy) return;
    busy = true;
    pick.disabled = true;
    error.hidden = true;
    result.replaceChildren();
    status.textContent = 'Lendo e verificando o backup…';
    status.hidden = false;
    try {
      if (file.size > DEFAULT_LIMITS.maxZipBytes) {
        throw new BackupError(
          'too-large',
          `O arquivo tem ${formatBytes(file.size)}; o limite para importar é ${formatBytes(DEFAULT_LIMITS.maxZipBytes)}.`,
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const repo = await context.getRepository();
      const report = await importBackup(repo, bytes);
      if (!disposed) result.replaceChildren(...describeReport(report, context.navigate));
    } catch (failure) {
      if (!disposed) {
        error.textContent = describeError(failure);
        error.hidden = false;
      }
    } finally {
      busy = false;
      pick.disabled = false;
      if (!disposed) status.hidden = true;
    }
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void run(file);
  });

  root.append(
    h(
      'main',
      { class: 'screen' },
      topBar('Importar projeto', () => context.navigate('home')),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Backup de outro aparelho'),
        h(
          'p',
          { class: 'muted' },
          `Escolha um arquivo ${BACKUP_EXTENSION} gerado por este app. Tudo é verificado aqui no aparelho antes de salvar: arquivos adulterados ou fora do formato são recusados. Nada é enviado para a internet, e projetos que você já tem não são sobrescritos.`,
        ),
        h('div', { class: 'row' }, pick),
        status,
        error,
      ),
      result,
      input,
    ),
  );

  return () => {
    disposed = true;
  };
};

function describeReport(report: ImportReport, navigate: (view: 'projects') => void): Node[] {
  const nodes: Node[] = [];
  const lines: Node[] = [];
  lines.push(
    h(
      'p',
      { class: 'muted', role: 'status' },
      `Backup de ${formatDateTime(report.backupCreatedAt)}: ${report.imported.length} importado(s), ${report.skipped.length} não importado(s).`,
    ),
  );
  for (const item of report.imported) {
    const notes: string[] = [];
    if (item.renamed) notes.push('já existia um projeto com o mesmo id e conteúdo diferente; entrou como cópia');
    if (item.health.status === 'needs-recompile') notes.push('precisa recompilar a partir da foto');
    lines.push(
      h('p', { class: 'muted' }, `✓ ${item.name}${notes.length > 0 ? ` — ${notes.join('; ')}` : ''}`),
    );
  }
  for (const item of report.skipped) {
    lines.push(h('p', { class: 'form-error' }, `✕ ${item.name ?? item.id?.slice(0, 8) ?? 'item'} — ${item.reason}`));
  }
  for (const warning of report.warnings) lines.push(h('p', { class: 'form-error' }, `Aviso: ${warning}`));
  nodes.push(
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title' }, 'Resultado'),
      ...lines,
      report.imported.length > 0
        ? h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => navigate('projects') }, 'Ver meus projetos'))
        : null,
    ),
  );
  return nodes;
}
