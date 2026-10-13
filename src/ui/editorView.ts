import { applyControl, cloneItems, controlsFor, diffItems, formatValue, isDirty, moveItem, resetTransform, TYPE_LABEL, type Control } from '../scene/editorModel';
import { browserLoaders } from '../scene/loaders';
import type { PreviewView } from '../scene/picking';
import { SceneRuntime, type RuntimeSummary } from '../scene/runtime';
import { describeProblems, describeSummary } from '../scene/summaryText';
import {
  MAX_ITEMS_PER_PROJECT,
  MAX_ITEM_FILE_BYTES,
  type ProjectRecord,
  type SceneItem,
} from '../storage/model';
import type { ProjectRepository } from '../storage/repository';
import { addItem, duplicateItem, openItemFile, removeItem, updateItems } from '../storage/scene';
import { topBar } from './components';
import type { View } from './context';
import { describeError, formatBytes, h } from './dom';
import { createPreviewStage, type PreviewStage } from './previewStage';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.mp4,.m4v,.webm,.glb,.mp3,.ogg,.oga,.wav,.m4a';

const GROUP_TITLES: Record<string, string> = {
  position: 'Posição na tatuagem',
  rotation: 'Giro e inclinação',
  size: 'Tamanho',
  media: 'Mídia',
};

/**
 * Editor da cena de um projeto: lista de itens, prévia 3D sobre a foto de
 * referência e controles do item selecionado.
 *
 * Adicionar, duplicar e remover gravam na hora. Os ajustes (posição, giro,
 * tamanho, opções) ficam num rascunho e vão ao banco com "Salvar" — ou
 * sozinhos ao sair da tela, para não perder trabalho com o botão "voltar" do
 * aparelho. "Desfazer alterações" volta ao último salvamento.
 */
export const editorView: View = (context, root) => {
  const projectId = context.getEditingProject();

  let disposed = false;
  let busy = false;
  let repo: ProjectRepository | null = null;
  let record: ProjectRecord | null = null;
  let saved: SceneItem[] = [];
  let draft: SceneItem[] = [];
  let selectedId: string | null = null;
  let runtime: SceneRuntime | null = null;
  let stage: PreviewStage | null = null;
  let view: PreviewView = 'front';
  let playing = false;
  let confirmingRemove = false;
  let summary: RuntimeSummary | null = null;
  const refs = new Map<string, { input: HTMLInputElement; output: HTMLElement; control: Control }>();

  const stageBox = h('div', { class: 'editor-stage' });
  const stageNote = h('p', { class: 'muted', role: 'status' });
  stageNote.hidden = true;
  const statusLine = h('p', { class: 'muted editor-status', role: 'status' });
  const problems = h('ul', { class: 'editor-problems' });
  const message = h('p', { role: 'status' });
  message.hidden = true;
  const list = h('ul', { class: 'item-list' });
  const panel = h('section', { class: 'card editor-panel' });
  const saveBar = h('div', { class: 'save-bar' });
  const counter = h('span', { class: 'muted' });
  const frontButton = h('button', { class: 'btn', type: 'button', onclick: () => setView('front') }, 'De frente');
  const tiltedButton = h('button', { class: 'btn', type: 'button', onclick: () => setView('tilted') }, 'Inclinada');
  const playButton = h('button', { class: 'btn', type: 'button', onclick: () => void togglePlay() }, 'Reproduzir mídia');
  const fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPT, class: 'visually-hidden', 'aria-label': 'Adicionar arquivos' });
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length > 0) void addFiles(files);
  });

  // ------------------------------------------------------------------ mensagens

  function say(text: string | null, tone: 'info' | 'error' = 'info'): void {
    message.hidden = text === null;
    message.textContent = text ?? '';
    message.className = tone === 'error' ? 'form-error' : 'muted';
    message.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }

  async function run(task: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    redrawAll();
    try {
      await task();
    } catch (error) {
      if (!disposed) say(describeError(error), 'error');
    } finally {
      busy = false;
      if (!disposed) redrawAll();
    }
  }

  // ------------------------------------------------------------------ dados

  const selected = (): SceneItem | null => draft.find((item) => item.id === selectedId) ?? null;
  const dirty = (): boolean => isDirty(saved, draft);

  function replaceDraft(next: SceneItem): void {
    draft = draft.map((item) => (item.id === next.id ? next : item));
    runtime?.updateItem(next);
    syncControls(next);
    redrawSaveBar();
    redrawList();
  }

  function loadFromRecord(next: ProjectRecord): void {
    record = next;
    saved = cloneItems(next.scene.items);
    draft = cloneItems(next.scene.items);
  }

  async function saveDraft(): Promise<boolean> {
    if (!repo || !projectId) return false;
    const patches = diffItems(saved, draft);
    if (patches.size === 0) return true;
    const next = await updateItems(repo, projectId, patches);
    record = next;
    saved = cloneItems(next.scene.items);
    return true;
  }

  // ------------------------------------------------------------------ ações

  function setView(next: PreviewView): void {
    view = next;
    stage?.setView(next);
    frontButton.setAttribute('aria-pressed', String(next === 'front'));
    tiltedButton.setAttribute('aria-pressed', String(next === 'tilted'));
  }

  async function togglePlay(): Promise<void> {
    playing = !playing;
    playButton.setAttribute('aria-pressed', String(playing));
    playButton.textContent = playing ? 'Pausar mídia' : 'Reproduzir mídia';
    await runtime?.setTracking(playing);
  }

  async function addFiles(files: File[]): Promise<void> {
    await run(async () => {
      if (!repo || !projectId || !runtime) return;
      say(null);
      if (dirty()) await saveDraft();
      const errors: string[] = [];
      for (const file of files) {
        try {
          const index = draft.length % 6;
          const result = await addItem(repo, projectId, {
            file: { data: await file.arrayBuffer(), fileName: file.name, mimeType: file.type },
            transform: { position: [0.06 * index, -0.06 * index, 0] },
          });
          loadFromRecord(result.record);
          selectedId = result.item.id;
          void runtime.add(cloneItems([result.item])[0]!);
        } catch (error) {
          errors.push(`${file.name}: ${describeError(error)}`);
        }
      }
      confirmingRemove = false;
      if (errors.length > 0) say(errors.join('\n'), 'error');
    });
  }

  async function duplicateSelected(): Promise<void> {
    const item = selected();
    if (!item) return;
    await run(async () => {
      if (!repo || !projectId || !runtime) return;
      say(null);
      await saveDraft();
      const result = await duplicateItem(repo, projectId, item.id);
      loadFromRecord(result.record);
      selectedId = result.item.id;
      void runtime.add(cloneItems([result.item])[0]!);
    });
  }

  async function removeSelected(): Promise<void> {
    const item = selected();
    if (!item) return;
    await run(async () => {
      if (!repo || !projectId) return;
      say(null);
      await saveDraft();
      loadFromRecord(await removeItem(repo, projectId, item.id));
      runtime?.remove(item.id);
      selectedId = null;
      confirmingRemove = false;
    });
  }

  async function save(): Promise<void> {
    await run(async () => {
      say(null);
      if (await saveDraft()) say('Ajustes salvos.');
    });
  }

  function discard(): void {
    draft = cloneItems(saved);
    for (const item of draft) runtime?.updateItem(item);
    say('Alterações desfeitas.');
    redrawAll();
  }

  // ------------------------------------------------------------------ controles

  function syncControls(item: SceneItem): void {
    if (item.id !== selectedId) return;
    for (const { input, output, control } of refs.values()) {
      const value = control.read(item);
      input.value = String(value);
      output.textContent = formatValue(control, value);
    }
  }

  function sliderRow(item: SceneItem, control: Control): HTMLElement {
    const value = control.read(item);
    const output = h('output', { class: 'slider-value' }, formatValue(control, value));
    const input = h('input', {
      type: 'range',
      min: control.min,
      max: control.max,
      step: control.step,
      value,
      'aria-label': control.label,
    });
    input.addEventListener('input', () => {
      const current = selected();
      if (!current) return;
      const next = applyControl(current, control, Number(input.value));
      output.textContent = formatValue(control, control.read(next));
      draft = draft.map((candidate) => (candidate.id === next.id ? next : candidate));
      runtime?.updateItem(next);
      redrawSaveBar();
    });
    refs.set(control.id, { input, output, control });
    return h('label', { class: 'slider' }, h('span', { class: 'slider-label' }, control.label), input, output);
  }

  function checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
    const input = h('input', { type: 'checkbox', checked, class: 'check-input' });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'check-row' }, input, h('span', {}, label));
  }

  function drawPanel(): void {
    refs.clear();
    const item = selected();
    if (!item) {
      panel.replaceChildren(
        h('h2', { class: 'card-title' }, 'Item selecionado'),
        h('p', { class: 'muted' }, draft.length === 0 ? 'Adicione arquivos para começar.' : 'Toque num item da lista ou na prévia para ajustá-lo.'),
      );
      return;
    }

    const nameInput = h('input', { type: 'text', class: 'text-input', value: item.name, maxlength: 80, 'aria-label': 'Nome do item' });
    nameInput.addEventListener('change', () => {
      const current = selected();
      if (!current) return;
      const name = nameInput.value.replace(/\s+/g, ' ').trim();
      if (name === '') {
        nameInput.value = current.name;
        return;
      }
      replaceDraft({ ...current, name });
    });

    const children: Array<Node | null> = [
      h('h2', { class: 'card-title' }, `${TYPE_LABEL[item.type]} · ${item.file.fileName}`),
      h('p', { class: 'muted' }, `${formatBytes(item.file.size)}`),
      h('label', { class: 'field-label' }, 'Nome', nameInput),
      checkbox('Mostrar na câmera', item.visible, (visible) => replaceDraft({ ...selected()!, visible })),
    ];

    const controls = controlsFor(item.type);
    for (const group of ['position', 'rotation', 'size', 'media'] as const) {
      const rows = controls.filter((control) => control.group === group).map((control) => sliderRow(item, control));
      if (rows.length === 0) continue;
      children.push(h('h3', { class: 'panel-subtitle' }, GROUP_TITLES[group]), ...rows);
    }

    const fine = controls.filter((control) => control.group === 'offset').map((control) => sliderRow(item, control));
    if (fine.length > 0) {
      children.push(
        h(
          'details',
          { class: 'fine-tune' },
          h('summary', {}, 'Ajuste fino (deslocamento no eixo do próprio item)'),
          h('p', { class: 'muted' }, 'Move o item ao longo dos eixos dele depois do giro. Útil, por exemplo, para afastar da pele um item inclinado.'),
          ...fine,
        ),
      );
    }

    // Opções por tipo.
    const options: HTMLElement[] = [];
    if (item.type === 'video' || item.type === 'audio') {
      options.push(
        checkbox('Repetir', item.options.loop, (loop) => replaceDraft({ ...selected()!, options: { ...selected()!.options, loop } })),
        checkbox(item.type === 'video' ? 'Começar sem som' : 'Mudo', item.options.muted, (muted) => {
          replaceDraft({ ...selected()!, options: { ...selected()!.options, muted } });
          drawPanel(); // o aviso do vídeo com som depende desta opção
        }),
      );
      if (item.type === 'video' && !item.options.muted) {
        options.push(h('p', { class: 'muted' }, 'Vídeo com som pode pedir um toque na tela da câmera para tocar (regra do navegador).'));
      }
    }
    if (item.type === 'model') {
      options.push(
        checkbox('Tocar as animações do modelo', item.options.animate, (animate) => replaceDraft({ ...selected()!, options: { ...selected()!.options, animate } })),
        checkbox('Repetir a animação', item.options.loop, (loop) => replaceDraft({ ...selected()!, options: { ...selected()!.options, loop } })),
      );
      const clips = runtime?.clipsOf(item.id) ?? [];
      if (clips.length > 1) {
        const select = h(
          'select',
          { class: 'text-input', 'aria-label': 'Animação' },
          h('option', { value: '' }, 'A primeira do arquivo'),
          ...clips.map((clip) => h('option', { value: clip }, clip)),
        );
        select.value = item.options.clip ?? '';
        select.addEventListener('change', () => replaceDraft({ ...selected()!, options: { ...selected()!.options, clip: select.value === '' ? null : select.value } }));
        options.push(h('label', { class: 'field-label' }, 'Animação', select));
      }
    }
    if (options.length > 0) children.push(h('h3', { class: 'panel-subtitle' }, 'Opções'), ...options);

    children.push(
      confirmingRemove
        ? h(
            'div',
            { class: 'stack' },
            h('p', { class: 'muted' }, `Remover "${item.name}"? O arquivo é apagado deste aparelho (mantenha o original, ou um backup, se quiser guardá-lo).`),
            h(
              'div',
              { class: 'row' },
              h('button', { class: 'btn btn-danger', type: 'button', disabled: busy, onclick: () => void removeSelected() }, 'Remover definitivamente'),
              h('button', { class: 'btn', type: 'button', onclick: () => { confirmingRemove = false; drawPanel(); } }, 'Cancelar'),
            ),
          )
        : h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn', type: 'button', disabled: busy || draft.length >= MAX_ITEMS_PER_PROJECT, onclick: () => void duplicateSelected() }, 'Duplicar'),
            item.type === 'audio'
              ? null
              : h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { const current = selected(); if (current) { replaceDraft(resetTransform(current)); drawPanel(); } } }, 'Restaurar posição'),
            h('button', { class: 'btn btn-ghost', type: 'button', disabled: busy, onclick: () => { confirmingRemove = true; drawPanel(); } }, 'Remover'),
          ),
    );

    panel.replaceChildren(...children.filter((child): child is Node => child !== null));
  }

  // ------------------------------------------------------------------ desenho

  function redrawList(): void {
    counter.textContent = `${draft.length}/${MAX_ITEMS_PER_PROJECT} itens`;
    list.replaceChildren(
      ...draft.map((item) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              class: 'item-row',
              type: 'button',
              'aria-pressed': String(item.id === selectedId),
              onclick: () => selectItem(item.id),
            },
            h('span', { class: 'badge' }, TYPE_LABEL[item.type]),
            h('span', { class: 'item-name' }, item.name),
            item.visible ? null : h('span', { class: 'muted' }, 'oculto'),
            statusOf(item.id),
          ),
        ),
      ),
    );
  }

  function statusOf(id: string): HTMLElement | null {
    const failed = summary?.failed.find((entry) => entry.id === id);
    return failed ? h('span', { class: 'form-error' }, 'erro') : null;
  }

  function redrawSaveBar(): void {
    const isDirtyNow = dirty();
    saveBar.hidden = !isDirtyNow && !busy;
    saveBar.replaceChildren(
      h('span', { class: 'chip-text' }, isDirtyNow ? 'Alterações não salvas' : 'Tudo salvo'),
      h('button', { class: 'btn btn-primary', type: 'button', disabled: busy || !isDirtyNow, onclick: () => void save() }, 'Salvar'),
      h('button', { class: 'btn', type: 'button', disabled: busy || !isDirtyNow, onclick: discard }, 'Desfazer alterações'),
    );
  }

  function redrawStatus(): void {
    const line = summary ? describeSummary(summary) : '';
    statusLine.textContent = line;
    statusLine.hidden = line === '';
    const items = summary ? describeProblems(summary) : [];
    problems.replaceChildren(...items.map((text) => h('li', {}, text)));
    problems.hidden = items.length === 0;
  }

  function redrawAll(): void {
    redrawList();
    drawPanel();
    redrawSaveBar();
    redrawStatus();
    for (const button of [frontButton, tiltedButton, playButton]) button.disabled = busy;
  }

  function selectItem(id: string | null): void {
    if (id === selectedId) return;
    selectedId = id;
    confirmingRemove = false;
    redrawList();
    drawPanel();
  }

  // ------------------------------------------------------------------ carga

  async function start(): Promise<void> {
    if (!projectId) {
      root.append(
        h(
          'main',
          { class: 'screen' },
          topBar('Itens do projeto', () => context.navigate('projects')),
          h('p', { class: 'muted' }, 'Nenhum projeto escolhido. Abra um projeto em "Meus projetos" e toque em "Editar itens".'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => context.navigate('projects') }, 'Meus projetos'),
        ),
      );
      return;
    }

    root.append(
      h(
        'main',
        { class: 'screen editor' },
        topBar('Itens do projeto', () => context.navigate('projects')),
        h('p', { class: 'muted' }, 'Carregando…'),
      ),
    );

    try {
      repo = await context.getRepository();
      const entry = await repo.getEntry(projectId);
      if (disposed) return;
      if (!entry || entry.kind !== 'project') throw new Error('Este projeto não foi encontrado ou não pode ser aberto por esta versão do app.');
      loadFromRecord(entry.record);
      const image = entry.record.referenceImage ? await repo.getFile(projectId, 'referenceImage') : null;
      if (disposed) return;
      build(entry.record, image ? new Blob([image.data], { type: image.mimeType }) : null);
    } catch (error) {
      if (disposed) return;
      root.replaceChildren(
        h(
          'main',
          { class: 'screen' },
          topBar('Itens do projeto', () => context.navigate('projects')),
          h('p', { class: 'form-error', role: 'alert' }, describeError(error)),
          h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('projects') }, 'Meus projetos'),
        ),
      );
    }
  }

  function build(project: ProjectRecord, referenceImage: Blob | null): void {
    const aspect = project.anchor
      ? project.anchor.height / project.anchor.width
      : project.referenceImage
        ? project.referenceImage.height / project.referenceImage.width
        : 0.75;

    runtime = new SceneRuntime({
      items: cloneItems(draft),
      includeHidden: true,
      openFile: async (itemId) => (await openItemFile(repo!, projectId!, itemId)).data,
      loaders: browserLoaders,
      onChange: (next) => {
        summary = next;
        redrawStatus();
        redrawList();
        // Os nomes das animações só são conhecidos depois que o modelo carrega.
        if (selected()?.type === 'model') drawPanel();
      },
    });

    stage = createPreviewStage({
      container: stageBox,
      targetAspect: aspect,
      referenceImage,
      getSelectedId: () => selectedId,
      onSelect: (id) => selectItem(id),
      onDrag: (id, x, y) => {
        if (id !== selectedId) selectItem(id);
        const item = selected();
        if (item) replaceDraft(moveItem(item, x, y));
      },
    });
    if (stage) stage.attach(runtime);
    else {
      stageNote.hidden = false;
      stageNote.textContent = 'A prévia 3D não está disponível neste navegador (WebGL). Use os controles abaixo; o resultado aparece na câmera.';
    }
    void runtime.load();

    root.replaceChildren(
      h(
        'main',
        { class: 'screen editor' },
        topBar(project.name, () => context.navigate('projects')),
        h(
          'section',
          { class: 'card' },
          stageBox,
          stageNote,
          h('div', { class: 'row' }, frontButton, tiltedButton, playButton),
          h(
            'p',
            { class: 'muted' },
            'Toque num item para selecioná-lo e arraste para posicionar sobre a foto de referência. A foto é o alvo reconhecido na câmera; o centro dela é o centro do alvo.',
          ),
          statusLine,
          problems,
        ),
        h(
          'section',
          { class: 'card' },
          h('h2', { class: 'card-title' }, 'Itens'),
          counter,
          list,
          h(
            'div',
            { class: 'row' },
            h(
              'label',
              { class: 'btn btn-primary', 'aria-disabled': String(draft.length >= MAX_ITEMS_PER_PROJECT) },
              'Adicionar arquivos',
              fileInput,
            ),
          ),
          h(
            'p',
            { class: 'muted' },
            `Aceita imagem (PNG, JPG, WebP), GIF, vídeo (MP4, WebM), modelo 3D (GLB, sem compressão Draco) e áudio (MP3, OGG, WAV, M4A). Até ${Math.floor(MAX_ITEM_FILE_BYTES / (1024 * 1024))} MB por arquivo e ${MAX_ITEMS_PER_PROJECT} itens por projeto. Os arquivos ficam só neste aparelho.`,
          ),
          h(
            'p',
            { class: 'muted', id: 'youtube-note' },
            'YouTube e outros links ainda não são suportados: o player deles é uma página (iframe) que não entra na cena 3D e exige internet. Para usar um vídeo, adicione o arquivo MP4 ou WebM de um vídeo que você tenha direito de usar.',
          ),
          message,
        ),
        panel,
        saveBar,
      ),
    );

    setView('front');
    playButton.setAttribute('aria-pressed', 'false');
    selectedId = draft[0]?.id ?? null;
    redrawAll();
  }

  void start();

  return () => {
    disposed = true;
    // Salva sozinho o que ficou pendente: o botão "voltar" do aparelho não pergunta nada.
    if (repo && projectId && dirty()) {
      const pending = diffItems(saved, draft);
      void updateItems(repo, projectId, pending)
        .then(() => context.toast('Ajustes da cena salvos.'))
        .catch(() => context.toast('Não foi possível salvar os últimos ajustes da cena.'));
    }
    stage?.dispose();
    runtime?.dispose();
    stage = null;
    runtime = null;
  };
};
