import { BACKUP_EXTENSION, exportBackup, type ExportResult } from '../storage/backup';
import type { ListEntry } from '../storage/repository';
import { topBar } from './components';
import type { View } from './context';
import { describeError, downloadBytes, formatBytes, formatDateTime, h } from './dom';

type ProjectEntry = Extract<ListEntry, { kind: 'project' }>;

export const exportView: View = (context, root) => {
  let disposed = false;
  let busy = false;

  const body = h('div', { class: 'stack' });
  const checkboxes = new Map<string, HTMLInputElement>();

  async function load(): Promise<void> {
    body.replaceChildren(h('p', { class: 'muted' }, 'Carregando projetos…'));
    try {
      const repo = await context.getRepository();
      const entries = await repo.list();
      if (disposed) return;
      const projects = entries.filter((e): e is ProjectEntry => e.kind === 'project' && e.health.status !== 'broken');
      const left = entries.length - projects.length;
      draw(projects, left);
    } catch (error) {
      if (disposed) return;
      body.replaceChildren(
        h('p', { class: 'form-error', role: 'alert' }, describeError(error)),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => void load() }, 'Tentar de novo')),
      );
    }
  }

  function draw(projects: ProjectEntry[], leftOut: number): void {
    checkboxes.clear();
    const result = h('div', { class: 'stack' });
    const error = h('p', { class: 'form-error', role: 'alert' });
    error.hidden = true;

    if (projects.length === 0) {
      body.replaceChildren(
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'card-title' }, 'Nada para exportar'),
          h('p', { class: 'muted' }, 'Não há projetos íntegros salvos neste aparelho.'),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('projects') }, 'Meus projetos')),
        ),
      );
      return;
    }

    const rows = projects.map(({ record, health }) => {
      const input = h('input', { type: 'checkbox', checked: true, class: 'check-input' });
      checkboxes.set(record.id, input);
      const detail = [
        `Atualizado ${formatDateTime(record.updatedAt)}`,
        record.anchor ? `alvo ${formatBytes(record.anchor.size)}` : 'sem alvo',
        record.referenceImage ? `foto ${formatBytes(record.referenceImage.size)}` : 'sem foto',
      ];
      if (health.status === 'needs-recompile') detail.push('precisa recompilar');
      return h(
        'label',
        { class: 'pick-row' },
        input,
        h('span', null, h('strong', null, record.name), h('span', { class: 'muted block' }, detail.join(' · '))),
      );
    });

    const selectAll = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setAll(true) }, 'Marcar todos');
    const selectNone = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setAll(false) }, 'Desmarcar todos');
    const exportButton = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => void run() }, 'Gerar backup');

    function setAll(value: boolean): void {
      for (const input of checkboxes.values()) input.checked = value;
    }

    async function run(): Promise<void> {
      if (busy) return;
      const ids = [...checkboxes].filter(([, input]) => input.checked).map(([id]) => id);
      error.hidden = true;
      result.replaceChildren();
      if (ids.length === 0) {
        error.textContent = 'Marque pelo menos um projeto.';
        error.hidden = false;
        return;
      }
      busy = true;
      exportButton.disabled = true;
      try {
        const repo = await context.getRepository();
        const output = await exportBackup(repo, ids, { appVersion: __APP_VERSION__ });
        downloadBytes(output.bytes, output.fileName, 'application/zip');
        if (!disposed) result.replaceChildren(...report(output));
      } catch (failure) {
        if (!disposed) {
          error.textContent = describeError(failure);
          error.hidden = false;
        }
      } finally {
        busy = false;
        exportButton.disabled = false;
      }
    }

    body.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Projetos no backup'),
        h('div', { class: 'pick-list' }, ...rows),
        h('div', { class: 'row' }, selectAll, selectNone),
        leftOut > 0
          ? h('p', { class: 'muted' }, `${leftOut} registro(s) incompleto(s) ou ilegível(is) não aparecem aqui e não entram no backup.`)
          : null,
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Atenção'),
        h(
          'p',
          { class: 'muted' },
          `O arquivo ${BACKUP_EXTENSION} contém a foto da sua tatuagem sem criptografia. Guarde-o em um lugar seu e só envie para quem você escolher.`,
        ),
        error,
        h('div', { class: 'row' }, exportButton),
        result,
      ),
    );
  }

  root.append(h('main', { class: 'screen' }, topBar('Exportar backup', () => context.navigate('home')), body));
  void load();
  return () => {
    disposed = true;
  };
};

function report(output: ExportResult): Node[] {
  const lines: Node[] = [
    h(
      'p',
      { class: 'muted', role: 'status' },
      `Backup gerado: ${output.fileName} (${formatBytes(output.bytes.byteLength)}), com ${output.exported.length} projeto(s). Confira na pasta de downloads do aparelho.`,
    ),
  ];
  for (const item of output.skipped) {
    lines.push(h('p', { class: 'form-error' }, `Não incluído (${item.id.slice(0, 8)}): ${item.reason}`));
  }
  for (const warning of output.warnings) lines.push(h('p', { class: 'form-error' }, warning));
  return lines;
}
