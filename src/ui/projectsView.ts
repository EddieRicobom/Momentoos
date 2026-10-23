import { exportBackup } from '../storage/backup';
import { StorageError } from '../storage/errors';
import { sha256Hex } from '../storage/hash';
import { NAME_MAX_LENGTH, type ProjectHealth, type ProjectRecord } from '../storage/model';
import { openProjectAnchor, renameProject, replaceAnchor } from '../storage/projects';
import type { ListEntry, ProjectRepository } from '../storage/repository';
import { prepareTargetImage } from '../tracking/imagePrep';
import { compileTarget, inspectTargetBuffer } from '../tracking/targetCompiler';
import { topBar } from './components';
import type { View } from './context';
import { describeError, downloadBytes, formatBytes, formatDateTime, h } from './dom';

type ProjectEntry = Extract<ListEntry, { kind: 'project' }>;
type UnreadableEntry = Extract<ListEntry, { kind: 'unreadable' }>;

const HEALTH_LABEL: Record<ProjectHealth['status'], string> = {
  ready: 'Pronto',
  'needs-recompile': 'Precisa recompilar',
  broken: 'Incompleto',
};
const HEALTH_TONE: Record<ProjectHealth['status'], string> = {
  ready: 'ok',
  'needs-recompile': 'warn',
  broken: 'bad',
};

export const projectsView: View = (context, root) => {
  let disposed = false;
  /** Só uma operação pesada (abrir, recompilar, exportar) por vez. */
  let busy = false;
  let thumbUrls: string[] = [];

  const status = h('p', { class: 'muted' }, 'Carregando projetos…');
  const list = h('div', { class: 'project-list' });

  function releaseThumbs(): void {
    for (const url of thumbUrls) URL.revokeObjectURL(url);
    thumbUrls = [];
  }

  async function load(): Promise<void> {
    status.hidden = false;
    status.textContent = 'Carregando projetos…';
    try {
      const repo = await context.getRepository();
      const entries = await repo.list();
      const thumbs = new Map<string, string>();
      for (const entry of entries) {
        if (entry.kind !== 'project' || entry.record.referenceImage === null) continue;
        const file = await repo.getFile(entry.record.id, 'referenceImage');
        if (file) thumbs.set(entry.record.id, URL.createObjectURL(new Blob([file.data], { type: file.mimeType })));
      }
      if (disposed) {
        for (const url of thumbs.values()) URL.revokeObjectURL(url);
        return;
      }
      releaseThumbs();
      thumbUrls = [...thumbs.values()];
      draw(repo, entries, thumbs);
    } catch (error) {
      if (disposed) return;
      list.replaceChildren(
        h('p', { class: 'form-error', role: 'alert' }, describeError(error)),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => void load() }, 'Tentar de novo')),
      );
      status.hidden = true;
    }
  }

  function draw(repo: ProjectRepository, entries: ListEntry[], thumbs: Map<string, string>): void {
    status.hidden = true;
    if (entries.length === 0) {
      list.replaceChildren(
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'card-title' }, 'Nenhuma lembrança guardada'),
          h(
            'p',
            { class: 'muted' },
            'Escolha uma foto de tatuagem e guarde nela as fotos, vídeos e sons que quer reencontrar. Se já tem um backup, você pode restaurá-lo.',
          ),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => context.navigate('create') }, 'Criar uma lembrança'),
            h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('import') }, 'Importar backup'),
          ),
        ),
      );
      return;
    }
    list.replaceChildren(
      ...entries.map((entry) =>
        entry.kind === 'project'
          ? projectCard(entry, thumbs.get(entry.record.id) ?? null)
          : unreadableCard(repo, entry),
      ),
    );
  }

  function projectCard(entry: ProjectEntry, thumbUrl: string | null): HTMLElement {
    const { record, health } = entry;
    const card = h('section', { class: 'card project-card' });
    let mode: 'idle' | 'renaming' | 'confirm-delete' | 'working' = 'idle';
    let message: { text: string; tone: 'error' | 'info' } | null = null;
    let offerRecompile = health.status === 'needs-recompile';
    const hasImage = record.referenceImage !== null && thumbUrl !== null;

    const progress = h('progress', { class: 'progress', max: '100', 'aria-label': 'Progresso da recompilação' });

    async function guarded(task: (repo: ProjectRepository) => Promise<void>, workingText?: string): Promise<void> {
      if (busy) return;
      busy = true;
      mode = 'working';
      message = workingText ? { text: workingText, tone: 'info' } : null;
      progress.removeAttribute('value');
      redraw();
      try {
        await task(await context.getRepository());
        if (mode === 'working') mode = 'idle';
      } catch (error) {
        mode = 'idle';
        message = { text: describeError(error), tone: 'error' };
        // Alvo corrompido/incompatível: se há foto, recompilar resolve.
        if (error instanceof StorageError && ['integrity', 'incompatible', 'not-found'].includes(error.code)) {
          offerRecompile = record.referenceImage !== null;
        }
      } finally {
        busy = false;
        if (!disposed && card.isConnected) redraw();
      }
    }

    async function open(repo: ProjectRepository): Promise<void> {
      const { buffer } = await openProjectAnchor(repo, record.id);
      const info = inspectTargetBuffer(buffer);
      context.setTarget({
        buffer,
        width: info.width,
        height: info.height,
        origin: 'project',
        label: record.name,
        previewUrl: null,
        compileMs: null,
        projectId: record.id,
        referenceImage: null,
        diagnostics: { trackingPoints: info.trackingPoints, variantKeyframes: info.variantKeyframes },
      });
      context.store.dispatch({ type: 'TARGET_LOADED' });
      if (info.variantKeyframes === 0 && record.referenceImage !== null) {
        context.toast('Dica: esta tatuagem usa um alvo antigo. Atualize-o em "Minhas lembranças" para reconhecer melhor em ângulos fortes e pele esticada.');
      }
      context.navigate('camera');
    }

    async function recompile(repo: ProjectRepository): Promise<void> {
      const file = await repo.getFile(record.id, 'referenceImage');
      if (!file || record.referenceImage === null) {
        throw new StorageError('not-found', 'Este projeto não tem a foto de referência; não dá para recompilar.');
      }
      if ((await sha256Hex(file.data)) !== record.referenceImage.sha256) {
        throw new StorageError('integrity', 'A foto de referência está corrompida; não dá para recompilar a partir dela.');
      }
      const prepared = await prepareTargetImage(new Blob([file.data], { type: file.mimeType }));
      try {
        const compiled = await compileTarget(prepared.image, (percent) => {
          if (percent > 0) progress.value = percent;
        });
        await replaceAnchor(repo, record.id, compiled.buffer);
      } finally {
        prepared.dispose();
      }
      context.toast(`"${record.name}" recompilado.`);
      await load();
    }

    async function exportOne(repo: ProjectRepository): Promise<void> {
      const result = await exportBackup(repo, [record.id], { appVersion: __APP_VERSION__ });
      downloadBytes(result.bytes, result.fileName, 'application/zip');
      message = {
        text: result.warnings.length > 0 ? `Backup gerado, com avisos: ${result.warnings.join(' ')}` : 'Backup gerado.',
        tone: result.warnings.length > 0 ? 'error' : 'info',
      };
    }

    async function rename(repo: ProjectRepository, name: string): Promise<void> {
      await renameProject(repo, record.id, name);
      await load();
    }

    async function remove(repo: ProjectRepository): Promise<void> {
      await repo.delete(record.id);
      const target = context.getTarget();
      if (target?.projectId === record.id) context.setTarget({ ...target, projectId: null });
      context.toast(`"${record.name}" excluído.`);
      await load();
    }

    function redraw(): void {
      const meta = [`Atualizado ${formatDateTime(record.updatedAt)}`];
      if (record.anchor) meta.push(`alvo ${formatBytes(record.anchor.size)}`, `${record.anchor.width}×${record.anchor.height} px`);

      const title =
        mode === 'renaming'
          ? renameForm(record, (name) => void guarded((repo) => rename(repo, name)), () => {
              mode = 'idle';
              redraw();
            })
          : h('strong', { class: 'project-name' }, record.name);

      const reason = health.status === 'ready' ? null : health.reason;
      const children: Array<Node | null> = [
        h(
          'div',
          { class: 'project-head' },
          thumbUrl
            ? h('img', { class: 'project-thumb', src: thumbUrl, alt: `Foto de referência de ${record.name}` })
            : h('div', { class: 'project-thumb project-thumb-empty', 'aria-hidden': 'true' }, '∅'),
          h(
            'div',
            { class: 'project-info' },
            title,
            h('span', { class: 'badge', 'data-tone': HEALTH_TONE[health.status] }, HEALTH_LABEL[health.status]),
            h('span', { class: 'muted block' }, meta.join(' · ')),
          ),
        ),
        reason ? h('p', { class: 'muted' }, reason) : null,
        mode === 'working' ? progress : null,
        message ? h('p', { class: message.tone === 'error' ? 'form-error' : 'muted', role: message.tone === 'error' ? 'alert' : 'status' }, message.text) : null,
      ];

      if (mode === 'confirm-delete') {
        children.push(
          h(
            'p',
            { class: 'muted' },
            `Excluir "${record.name}"? A foto e o alvo são apagados deste aparelho e não dá para desfazer. Exporte um backup antes se quiser guardá-los.`,
          ),
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn btn-danger', type: 'button', onclick: () => void guarded(remove) }, 'Excluir definitivamente'),
            h('button', { class: 'btn', type: 'button', onclick: () => { mode = 'idle'; redraw(); } }, 'Cancelar'),
          ),
        );
      } else if (mode === 'idle') {
        const main: HTMLElement[] = [];
        if (health.status === 'ready') {
          main.push(h('button', { class: record.scene.items.length > 0 ? 'btn btn-primary' : 'btn', type: 'button', onclick: () => void guarded(open, 'Preparando suas lembranças…') }, 'Rever na câmera'));
        }
        if (offerRecompile && hasImage) {
          main.push(
            h(
              'button',
              { class: health.status === 'ready' ? 'btn' : 'btn btn-primary', type: 'button', onclick: () => void guarded(recompile, 'Recompilando a partir da foto de referência…') },
              'Recompilar',
            ),
          );
        }
        main.push(
          h(
            'button',
            {
              class: record.scene.items.length === 0 ? 'btn btn-primary' : 'btn',
              type: 'button',
              onclick: () => {
                context.setEditingProject(record.id);
                context.navigate('editor');
              },
            },
            record.scene.items.length > 0 ? `Organizar lembranças (${record.scene.items.length})` : 'Adicionar lembranças',
          ),
        );
        const more: HTMLElement[] = [
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => { mode = 'renaming'; message = null; redraw(); } }, 'Renomear'),
        ];
        if (health.status !== 'broken') {
          more.push(h('button', { class: 'btn btn-small', type: 'button', onclick: () => void guarded(exportOne, 'Gerando backup…') }, 'Exportar'));
        }
        more.push(h('button', { class: 'btn btn-small btn-quiet-danger', type: 'button', onclick: () => { mode = 'confirm-delete'; message = null; redraw(); } }, 'Excluir'));
        children.push(h('div', { class: 'row actions-main' }, ...main), h('div', { class: 'row actions-more' }, ...more));
      }

      card.replaceChildren(...children.filter((c): c is Node => c !== null));
    }

    redraw();
    return card;
  }

  function unreadableCard(repo: ProjectRepository, entry: UnreadableEntry): HTMLElement {
    const card = h('section', { class: 'card project-card' });
    let confirming = false;
    let error: string | null = null;

    function redraw(): void {
      const parts: Array<Node | null> = [
        h('strong', { class: 'project-name' }, `Registro ${entry.id.slice(0, 8)}`),
        h('span', { class: 'badge', 'data-tone': entry.code === 'newer-version' ? 'warn' : 'bad' }, entry.code === 'newer-version' ? 'Versão mais nova' : 'Ilegível'),
        h(
          'p',
          { class: 'muted' },
          entry.code === 'newer-version'
            ? `${entry.message} Ele não foi alterado: atualize o app para abri-lo.`
            : `${entry.message} O registro foi mantido; você pode excluí-lo se não precisar dele.`,
        ),
        error ? h('p', { class: 'form-error', role: 'alert' }, error) : null,
        confirming
          ? h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn btn-danger', type: 'button', onclick: () => void drop() }, 'Excluir definitivamente'),
              h('button', { class: 'btn', type: 'button', onclick: () => { confirming = false; redraw(); } }, 'Cancelar'),
            )
          : h('div', { class: 'row' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { confirming = true; redraw(); } }, 'Excluir')),
      ];
      card.replaceChildren(...parts.filter((part): part is Node => part !== null));
    }

    async function drop(): Promise<void> {
      try {
        await repo.delete(entry.id);
        await load();
      } catch (failure) {
        error = describeError(failure);
        confirming = false;
        if (!disposed) redraw();
      }
    }

    redraw();
    return card;
  }

  root.append(
    h(
      'main',
      { class: 'screen' },
      topBar('Minhas lembranças', () => context.navigate('home')),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('import') }, 'Importar backup'),
        h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('export') }, 'Exportar backup'),
      ),
      status,
      list,
    ),
  );
  void load();

  return () => {
    disposed = true;
    releaseThumbs();
  };
};

function renameForm(record: ProjectRecord, onSave: (name: string) => void, onCancel: () => void): HTMLElement {
  const input = h('input', {
    class: 'text-input',
    type: 'text',
    maxlength: String(NAME_MAX_LENGTH),
    autocomplete: 'off',
    'aria-label': 'Novo nome do projeto',
  });
  input.value = record.name;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onSave(input.value);
    if (event.key === 'Escape') onCancel();
  });
  window.setTimeout(() => input.select(), 0);
  return h(
    'div',
    { class: 'rename-form' },
    input,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => onSave(input.value) }, 'Salvar nome'),
      h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Cancelar'),
    ),
  );
}
