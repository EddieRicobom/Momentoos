import { CONTROLS, applyControl, cloneItems, controlsFor, diffItems, formatValue, isDirty, moveItem, nudgeStep, resetTransform, TYPE_LABEL, type Control } from '../scene/editorModel';
import { browserLoaders } from '../scene/loaders';
import type { PreviewView } from '../scene/picking';
import { SceneRuntime, type RuntimeSummary } from '../scene/runtime';
import { describeProblems, describeSummary } from '../scene/summaryText';
import { arrangeItems, SCENE_LAYOUTS, type SceneLayout } from '../scene/layouts';
import {
  MAX_CAROUSEL_SLIDES,
  MAX_ITEMS_PER_PROJECT,
  MAX_ITEM_FILE_BYTES,
  type ProjectRecord,
  type SceneItem,
} from '../storage/model';
import type { ProjectRepository } from '../storage/repository';
import { addCarousel, addItem, addSlides, duplicateItem, openItemFile, openSlideFile, removeItem, removeSlide, updateItems } from '../storage/scene';
import { classifyFile } from '../storage/itemFiles';
import { topBar } from './components';
import { icon } from './icons';
import type { View } from './context';
import { describeError, formatBytes, h } from './dom';
import { createPreviewStage, type PreviewStage } from './previewStage';

const ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.mp4,.m4v,.webm,.glb,.mp3,.ogg,.oga,.wav,.m4a';

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
  let view: PreviewView = 'tilted';
  let playing = false;
  let confirmingRemove = false;
  /** Várias imagens escolhidas de uma vez, esperando a decisão: carrossel ou itens separados. */
  let choice: File[] | null = null;
  let pendingFiles: File[] | null = null;
  let pendingPreviewUrls: string[] = [];
  let summary: RuntimeSummary | null = null;
  const refs = new Map<string, { input: HTMLInputElement; output: HTMLElement; control: Control }>();
  /** Histórico de desfazer/refazer (só ajustes; adicionar/remover itens zera o histórico). */
  let undoStack: SceneItem[][] = [];
  let redoStack: SceneItem[][] = [];
  let lastRememberedAt = 0;
  /** Setas e botões +/−: passo pequeno. */
  let fine = false;
  let gridSnap = false;
  let layoutOriginal: SceneItem[] | null = null;
  let layoutMusicOriginal: boolean | null = null;
  let presentationTimer: number | null = null;
  let presentationIndex = 0;
  let presentationInterval = 4_000;
  let presentationInternalSelect = false;
  let presentationMusicId: string | null = null;
  let presentationMusicAttached = true;
  let youtubeMusicUrl = '';
  let youtubePlaying = false;
  let localMusicPlaying = false;
  const presentationItems = (): SceneItem[] => draft.filter((item) => item.visible && item.type !== 'audio');

  const stageBox = h('div', { class: 'editor-stage' });
  const stageNote = h('p', { class: 'muted stage-note', role: 'status' });
  stageNote.hidden = true;
  const undoButton = h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Desfazer', title: 'Desfazer', onclick: () => stepHistory(-1) }, icon('undo'));
  const redoButton = h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Refazer', title: 'Refazer', onclick: () => stepHistory(1) }, icon('redo'));
  undoButton.disabled = true;
  redoButton.disabled = true;
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
  const playButton = h('button', { class: 'btn btn-play', type: 'button', onclick: () => void togglePlay() }, 'Reproduzir prévia');
  const focusButton = h('button', { class: 'btn focus-camera', type: 'button', 'aria-label': 'Ver de perto a lembrança selecionada', title: 'Ver de perto', onclick: () => stage?.focusItem(selectedId) }, icon('center'), h('span', { class: 'focus-label' }, 'Ver de perto'));
  const layoutBox = h('section', { class: 'card layout-box', 'aria-label': 'Formas de reunir lembranças' });
  const presentationBox = h('section', { class: 'card presentation-box', 'aria-label': 'Rever lembranças' });
  const musicBox = h('section', { class: 'card music-box', 'aria-label': 'Trilha para rever lembranças' });
  const choiceBox = h('div', { class: 'choice-box', role: 'group', 'aria-label': 'Como adicionar as imagens' });
  choiceBox.hidden = true;
  const addConfirmBox = h('div', { class: 'add-confirm-box', role: 'group', 'aria-label': 'Confirmar adição de arquivos' });
  addConfirmBox.hidden = true;
  const slideInput = h('input', { type: 'file', multiple: true, accept: '.png,.jpg,.jpeg,.webp', class: 'visually-hidden', 'aria-label': 'Adicionar fotos a esta sequência de lembranças' });
  slideInput.addEventListener('change', () => {
    const files = [...(slideInput.files ?? [])];
    slideInput.value = '';
    if (files.length > 0) void addToCarousel(files);
  });
  const fileInput = h('input', { type: 'file', multiple: true, accept: ACCEPT, class: 'visually-hidden', 'aria-label': 'Adicionar fotos, vídeos ou sons' });
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length > 0) void addFiles(files);
  });

  const addLabel = h(
    'label',
    { class: 'btn btn-primary btn-small add-chip' },
    icon('plus'),
    'Adicionar lembranças',
    fileInput,
  );

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

  /**
   * Guarda o estado atual para "Desfazer" antes de uma mudança. Mudanças em
   * sequência (arrastar, segurar uma seta) valem como UMA: um novo ponto só
   * é guardado depois de uma pausa.
   */
  function remember(): void {
    const now = Date.now();
    if (undoStack.length === 0 || now - lastRememberedAt > 700) {
      undoStack.push(cloneItems(draft));
      if (undoStack.length > 80) undoStack.shift();
      redoStack = [];
    }
    lastRememberedAt = now;
    redrawHistory();
  }

  function resetHistory(): void {
    undoStack = [];
    redoStack = [];
    lastRememberedAt = 0;
    redrawHistory();
  }

  function redrawHistory(): void {
    undoButton.disabled = busy || undoStack.length === 0;
    redoButton.disabled = busy || redoStack.length === 0;
  }

  /** Volta (-1) ou refaz (+1). Só mexe em itens que ainda existem. */
  function stepHistory(direction: -1 | 1): void {
    stopPresentation();
    const from = direction === -1 ? undoStack : redoStack;
    const to = direction === -1 ? redoStack : undoStack;
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push(cloneItems(draft));
    const byId = new Map(snapshot.map((item) => [item.id, item]));
    draft = draft.map((item) => byId.get(item.id) ?? item);
    for (const item of draft) runtime?.updateItem(item);
    lastRememberedAt = 0;
    redrawAll();
  }

  function replaceDraft(next: SceneItem): void {
    stopPresentation();
    remember();
    draft = draft.map((item) => (item.id === next.id ? next : item));
    runtime?.updateItem(next);
    syncControls(next);
    redrawSaveBar();
    redrawList();
  }

  function loadFromRecord(next: ProjectRecord): void {
    resetHistory();
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
    stopPresentation();
    view = next;
    stage?.setView(next);
    stage?.focusItem(null);
    frontButton.setAttribute('aria-pressed', String(next === 'front'));
    tiltedButton.setAttribute('aria-pressed', String(next === 'tilted'));
  }

  async function togglePlay(): Promise<void> {
    playing = !playing;
    playButton.setAttribute('aria-pressed', String(playing));
    playButton.textContent = playing ? 'Pausar prévia' : 'Reproduzir prévia';
    await runtime?.setTracking(playing);
  }

  function stopPresentation(): void {
    const wasActive = presentationTimer !== null;
    if (presentationTimer !== null) window.clearInterval(presentationTimer);
    presentationTimer = null;
    if (wasActive && presentationMusicId) void runtime?.setItemActive(presentationMusicId, false);
    if (wasActive && youtubePlaying) {
      musicBox.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube-nocookie.com');
      youtubePlaying = false;
    }
    if (wasActive) localMusicPlaying = false;
    presentationBox.dataset.playing = 'false';
    redrawPresentation();
  }

  function presentationStep(direction: 1 | -1): void {
    const items = presentationItems();
    if (items.length === 0) return;
    presentationIndex = (presentationIndex + direction + items.length) % items.length;
    const item = items[presentationIndex]!;
    presentationInternalSelect = true;
    selectItem(item.id);
    presentationInternalSelect = false;
    stage?.focusItem(item.id);
  }

  function startPresentation(): void {
    const items = presentationItems();
    if (items.length < 2) {
      say('Adicione pelo menos duas lembranças visuais para começar a rever.');
      return;
    }
    if (presentationTimer !== null) {
      stopPresentation();
      return;
    }
    const selectedIndex = items.findIndex((item) => item.id === selectedId);
    presentationIndex = selectedIndex < 0 ? items.length - 1 : selectedIndex - 1;
    presentationBox.dataset.playing = 'true';
    presentationStep(1);
    presentationTimer = window.setInterval(() => presentationStep(1), presentationInterval);
    if (presentationMusicAttached) {
      if (presentationMusicId) {
        if (youtubePlaying) musicBox.querySelector('iframe')?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube-nocookie.com');
        youtubePlaying = false;
        void runtime?.setItemActive(presentationMusicId, true);
        redrawMusicBox();
      }
      else if (youtubeVideoId(youtubeMusicUrl) && !youtubePlaying) {
        youtubePlaying = true;
        redrawMusicBox();
      }
    }
    redrawPresentation();
  }

  function redrawPresentation(): void {
    const items = presentationItems();
    const active = presentationTimer !== null;
    presentationBox.replaceChildren(
      h('h2', { class: 'card-title' }, 'Rever lembranças'),
      h('p', { class: 'muted' }, 'Passe de uma lembrança para a próxima com movimentos suaves. Ao organizar, a apresentação pausa.'),
      h('label', { class: 'field-label' }, 'Intervalo', h('select', {
        class: 'text-input',
        'aria-label': 'Intervalo da apresentação',
        onchange: (event: Event) => {
          presentationInterval = Number((event.currentTarget as HTMLSelectElement).value);
          if (presentationTimer !== null) {
            window.clearInterval(presentationTimer);
            presentationTimer = window.setInterval(() => presentationStep(1), presentationInterval);
          }
        },
      }, ...[2, 3, 4, 6, 8].map((seconds) => h('option', { value: seconds * 1000, selected: presentationInterval === seconds * 1000 }, `${seconds} segundos`)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', disabled: items.length < 2, onclick: () => presentationStep(-1) }, 'Voltar'),
        h('button', { class: 'btn btn-primary', type: 'button', disabled: items.length < 2, 'aria-pressed': String(active), onclick: startPresentation }, active ? 'Pausar' : 'Começar a rever'),
        h('button', { class: 'btn', type: 'button', disabled: items.length < 2, onclick: () => presentationStep(1) }, 'Avançar'),
      ),
      h('p', { class: 'muted' }, `${items.length} ${items.length === 1 ? 'lembrança' : 'lembranças'} nesta apresentação`),
    );
  }

  function previewLayout(layout: SceneLayout): void {
    stopPresentation();
    if (!layoutOriginal) {
      layoutOriginal = cloneItems(draft);
      layoutMusicOriginal = presentationMusicAttached;
    }
    const aspect = record?.anchor ? record.anchor.height / record.anchor.width : record?.referenceImage ? record.referenceImage.height / record.referenceImage.width : 0.75;
    draft = arrangeItems(layoutOriginal, layout, aspect);
    for (const item of draft) runtime?.updateItem(item);
    layoutBox.replaceChildren(
      h('h2', { class: 'card-title' }, `Prévia: ${SCENE_LAYOUTS.find((entry) => entry.id === layout)?.label ?? 'Disposição'}`),
      h('p', { class: 'muted' }, 'Suas lembranças e seus nomes continuam iguais. A disposição só muda quando você confirma e toca em Salvar.'),
      checkbox('Tocar a trilha escolhida ao rever as lembranças', presentationMusicAttached, (value) => { presentationMusicAttached = value; previewLayout(layout); }),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: confirmLayout }, 'Usar esta disposição'),
        h('button', { class: 'btn', type: 'button', onclick: cancelLayout }, 'Voltar'),
      ),
    );
    redrawList();
    drawPanel();
    redrawSaveBar();
  }

  function confirmLayout(): void {
    if (!layoutOriginal) return;
    undoStack.push(cloneItems(layoutOriginal));
    if (undoStack.length > 80) undoStack.shift();
    redoStack = [];
    layoutOriginal = null;
    layoutMusicOriginal = null;
    storeMusicChoice();
    redrawHistory();
    redrawLayoutBox();
    redrawSaveBar();
  }

  function cancelLayout(): void {
    if (layoutOriginal) {
      draft = cloneItems(layoutOriginal);
      for (const item of draft) runtime?.updateItem(item);
    }
    layoutOriginal = null;
    if (layoutMusicOriginal !== null) presentationMusicAttached = layoutMusicOriginal;
    layoutMusicOriginal = null;
    redrawLayoutBox();
    redrawList();
    drawPanel();
    redrawSaveBar();
  }

  function redrawLayoutBox(): void {
    if (layoutOriginal) return;
    layoutBox.replaceChildren(
      h('h2', { class: 'card-title' }, 'Formas de reunir suas lembranças'),
      h('p', { class: 'muted' }, 'Escolha como quer reunir seus momentos. Experimente na prévia; para percorrer um por um, comece a rever.'),
      h('div', { class: 'layout-options' }, ...SCENE_LAYOUTS.map((layout) =>
        h('button', { class: 'btn layout-option', type: 'button', onclick: () => previewLayout(layout.id) },
          h('span', { class: `layout-thumb layout-thumb-${layout.id}`, 'aria-hidden': 'true' }, ...Array.from({ length: 5 }, () => h('i'))),
          h('span', { class: 'layout-copy' }, h('strong', {}, layout.label), h('span', { class: 'layout-description' }, layout.description)),
        ),
      )),
    );
  }

  function youtubeVideoId(value: string): string | null {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:') return null;
      if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;
      if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname)) return null;
      if (url.pathname === '/watch') return url.searchParams.get('v');
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  function musicStorageKey(): string {
    return `momentoos:music:${projectId ?? ''}`;
  }

  function storeMusicChoice(): void {
    try {
      localStorage.setItem(musicStorageKey(), JSON.stringify({ audioId: presentationMusicId, youtubeUrl: youtubeMusicUrl, musicAttached: presentationMusicAttached }));
    } catch {
      say('A preferência de música não pôde ser salva neste navegador.', 'error');
    }
  }

  function loadMusicChoice(): void {
    try {
      const raw = localStorage.getItem(musicStorageKey());
      if (!raw) return;
      const savedChoice = JSON.parse(raw) as { audioId?: unknown; youtubeUrl?: unknown; musicAttached?: unknown };
      if (typeof savedChoice.audioId === 'string' && draft.some((item) => item.id === savedChoice.audioId && item.type === 'audio')) presentationMusicId = savedChoice.audioId;
      if (typeof savedChoice.musicAttached === 'boolean') presentationMusicAttached = savedChoice.musicAttached;
      if (typeof savedChoice.youtubeUrl === 'string' && youtubeVideoId(savedChoice.youtubeUrl)) youtubeMusicUrl = savedChoice.youtubeUrl;
    } catch {
      /* preferência inválida ou armazenamento indisponível: a cena continua normal */
    }
  }

  function toggleLocalMusic(): void {
    if (!presentationMusicId) return;
    const wasPlaying = localMusicPlaying;
    if (presentationTimer !== null) {
      stopPresentation();
      if (wasPlaying) return;
    }
    localMusicPlaying = !localMusicPlaying;
    if (localMusicPlaying) {
      youtubePlaying = false;
      void runtime?.setItemActive(presentationMusicId, true);
    } else void runtime?.setItemActive(presentationMusicId, false);
    redrawMusicBox();
  }

  function toggleYoutubeMusic(): void {
    const wasPlaying = youtubePlaying;
    if (presentationTimer !== null) {
      stopPresentation();
      if (wasPlaying) return;
    }
    const id = youtubeVideoId(youtubeMusicUrl);
    if (!id) {
      say('Cole um link válido do YouTube (watch, youtu.be, Shorts ou live).', 'error');
      return;
    }
    if (youtubePlaying) {
      const frame = musicBox.querySelector('iframe');
      frame?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), 'https://www.youtube-nocookie.com');
      youtubePlaying = false;
    } else {
      if (presentationMusicId) void runtime?.setItemActive(presentationMusicId, false);
      localMusicPlaying = false;
      youtubePlaying = true;
    }
    redrawMusicBox();
  }

  function redrawMusicBox(): void {
    const audioItems = draft.filter((item) => item.type === 'audio');
    const select = h('select', {
      class: 'text-input',
      'aria-label': 'Trilha sonora guardada com esta lembrança',
      onchange: (event: Event) => {
        if (presentationMusicId) void runtime?.setItemActive(presentationMusicId, false);
        presentationMusicId = (event.currentTarget as HTMLSelectElement).value || null;
        localMusicPlaying = false;
        storeMusicChoice();
        redrawMusicBox();
      },
    },
    h('option', { value: '' }, 'Sem música local'),
    ...audioItems.map((item) => h('option', { value: item.id, selected: item.id === presentationMusicId }, item.name)));
    const urlInput = h('input', {
      class: 'text-input', type: 'url', inputmode: 'url', placeholder: 'https://youtu.be/…', value: youtubeMusicUrl,
      'aria-label': 'Link de música do YouTube',
      onchange: (event: Event) => { youtubeMusicUrl = (event.currentTarget as HTMLInputElement).value.trim(); },
    });
    const children: Node[] = [
      h('h2', { class: 'card-title' }, 'Trilha para rever suas lembranças'),
      h('p', { class: 'muted' }, 'Escolha uma trilha para acompanhar a apresentação. O áudio só começa quando você tocar em Reproduzir. Use um som guardado com esta lembrança ou um link do YouTube.'),
      h('label', { class: 'field-label' }, 'Arquivo de áudio', select),
      h('button', { class: 'btn', type: 'button', disabled: !presentationMusicId, 'aria-pressed': String(localMusicPlaying), onclick: toggleLocalMusic }, localMusicPlaying ? 'Pausar faixa local' : 'Reproduzir faixa local'),
      h('label', { class: 'field-label' }, 'YouTube', urlInput),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { youtubeMusicUrl = urlInput.value.trim(); storeMusicChoice(); toggleYoutubeMusic(); } }, youtubePlaying ? 'Pausar YouTube' : 'Reproduzir YouTube'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { youtubeMusicUrl = ''; youtubePlaying = false; localMusicPlaying = false; if (presentationMusicId) void runtime?.setItemActive(presentationMusicId, false); storeMusicChoice(); redrawMusicBox(); } }, 'Limpar'),
      ),
    ];
    const musicItem = audioItems.find((item) => item.id === presentationMusicId);
    if (musicItem) {
      const volume = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: musicItem.options.volume, 'aria-label': 'Volume da música local' });
      volume.addEventListener('input', () => {
        stopPresentation();
        const current = draft.find((item) => item.id === presentationMusicId);
        const control = CONTROLS.find((candidate) => candidate.id === 'volume')!;
        if (!current) return;
        remember();
        const changed = applyControl(current, control, Number(volume.value));
        draft = draft.map((item) => item.id === changed.id ? changed : item);
        runtime?.updateItem(changed);
        redrawSaveBar();
      });
      children.push(h('label', { class: 'field-label' }, 'Volume', volume));
    }
    const videoId = youtubeVideoId(youtubeMusicUrl);
    if (youtubePlaying && videoId) {
      const frame = h('iframe', {
        class: 'youtube-player', title: 'Player do YouTube', allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&controls=1&rel=0&enablejsapi=1`,
      });
      children.push(frame);
    }
    musicBox.replaceChildren(...children);
  }

  const isStaticImage = (file: File): boolean => {
    const kind = classifyFile(file.name, file.type);
    return kind.ok && kind.type === 'image';
  };

  /** Arquivos escolhidos: imagens soltas em número ≥ 2 pedem a decisão carrossel × separados. */
  function addFiles(files: File[]): void {
    stopPresentation();
    pendingFiles = files;
    pendingPreviewUrls = files.slice(0, 3).filter((file) => file.type.startsWith('image/')).map((file) => URL.createObjectURL(file));
    redrawPendingFiles();
  }

  function redrawPendingFiles(): void {
    addConfirmBox.hidden = pendingFiles === null;
    if (!pendingFiles) {
      addConfirmBox.replaceChildren();
      return;
    }
    const files = pendingFiles;
    const previews = pendingPreviewUrls.map((url, index) => h('img', { src: url, alt: `Prévia do arquivo ${index + 1}` }));
    const countText = files.length === 1 ? '1 arquivo será colocado' : `${files.length} arquivos serão colocados`;
    addConfirmBox.replaceChildren(
      h('h3', {}, 'Prévia de adição'),
      h('p', { class: 'muted' }, `${countText} no centro ou perto do centro do alvo. Você poderá ajustar a posição depois.`),
      h('div', { class: 'pending-placement' },
        h('span', { class: 'pending-target' },
          ...previews,
          previews.length === 0 ? h('span', {}, files[0]?.name ?? 'Objeto') : null,
        ),
        h('span', { class: 'muted' }, 'Posição inicial: centro do alvo'),
      ),
      h('ul', { class: 'pending-file-list' }, ...files.slice(0, 6).map((file) => h('li', {}, file.name)), files.length > 6 ? h('li', {}, `e mais ${files.length - 6} arquivo(s)`) : null),
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
          pendingFiles = null;
          pendingPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
          pendingPreviewUrls = [];
          redrawPendingFiles();
          void commitFiles(files);
        } }, 'Confirmar adição'),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          pendingFiles = null;
          pendingPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
          pendingPreviewUrls = [];
          redrawPendingFiles();
        } }, 'Cancelar'),
      ),
    );
  }

  async function commitFiles(files: File[]): Promise<void> {
    const images = files.filter(isStaticImage);
    if (images.length >= 2) {
      choice = images;
      redrawChoice();
      const others = files.filter((file) => !isStaticImage(file));
      if (others.length > 0) await addEach(others);
      return;
    }
    await addEach(files);
  }

  async function addEach(files: File[]): Promise<void> {
    await run(async () => {
      if (!repo || !projectId || !runtime) return;
      say(null);
      if (dirty()) await saveDraft();
      const errors: string[] = [];
      for (const file of files) {
        try {
          const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name);
          const result = await addItem(repo, projectId, {
            file: { data: await file.arrayBuffer(), fileName: file.name, mimeType: file.type },
            transform: { position: [0, 0, 0], ...(isImage ? { rotation: [90, 0, 0] as [number, number, number] } : {}) },
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

  async function readFiles(files: File[]): Promise<Array<{ data: ArrayBuffer; fileName: string; mimeType: string }>> {
    return Promise.all(files.map(async (file) => ({ data: await file.arrayBuffer(), fileName: file.name, mimeType: file.type })));
  }

  async function addCarouselFrom(files: File[]): Promise<void> {
    choice = null;
    redrawChoice();
    await run(async () => {
      if (!repo || !projectId || !runtime) return;
      say(null);
      if (dirty()) await saveDraft();
      const result = await addCarousel(repo, projectId, { files: await readFiles(files), name: 'Carrossel' });
      loadFromRecord(result.record);
      selectedId = result.item.id;
      confirmingRemove = false;
      void runtime.add(cloneItems([result.item])[0]!);
    });
  }

  async function addSeparately(files: File[]): Promise<void> {
    choice = null;
    redrawChoice();
    await addEach(files);
  }

  /** Acrescenta imagens a um carrossel que já existe. */
  async function addToCarousel(files: File[]): Promise<void> {
    stopPresentation();
    const item = selected();
    if (!item || item.type !== 'carousel') return;
    await run(async () => {
      if (!repo || !projectId || !runtime) return;
      say(null);
      await saveDraft();
      const result = await addSlides(repo, projectId, item.id, await readFiles(files));
      reloadItem(result.record, result.item);
    });
  }

  async function removeSlideOf(slot: number): Promise<void> {
    const item = selected();
    if (!item || item.type !== 'carousel') return;
    await run(async () => {
      if (!repo || !projectId || !runtime) return;
      say(null);
      await saveDraft();
      const result = await removeSlide(repo, projectId, item.id, slot);
      reloadItem(result.record, result.item);
    });
  }

  /** O conjunto de arquivos do item mudou: o item é recarregado na prévia. */
  function reloadItem(next: ProjectRecord, item: SceneItem): void {
    loadFromRecord(next);
    runtime?.remove(item.id);
    void runtime?.add(cloneItems([item])[0]!);
  }

  async function duplicateSelected(): Promise<void> {
    stopPresentation();
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
    stopPresentation();
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
    remember();
    draft = cloneItems(saved);
    for (const item of draft) runtime?.updateItem(item);
    say('Alterações desfeitas.');
    redrawAll();
  }

  // ------------------------------------------------------------------ controles

  const percentOf = (control: Control, value: number): string =>
    `${Math.min(100, Math.max(0, ((value - control.min) / (control.max - control.min)) * 100))}%`;

  function syncControls(item: SceneItem): void {
    if (item.id !== selectedId) return;
    for (const { input, output, control } of refs.values()) {
      const value = control.read(item);
      input.value = String(value);
      input.style.setProperty('--fill', percentOf(control, value));
      output.textContent = formatValue(control, value);
    }
  }

  /** Botão que repete enquanto o dedo está sobre ele (primeiro toque imediato, depois acelera). */
  function repeating(button: HTMLButtonElement, action: () => void): HTMLButtonElement {
    let delay: number | null = null;
    let timer: number | null = null;
    const stop = (): void => {
      if (delay !== null) window.clearTimeout(delay);
      if (timer !== null) window.clearInterval(timer);
      delay = null;
      timer = null;
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button > 0) return;
      stop();
      action();
      delay = window.setTimeout(() => {
        timer = window.setInterval(action, 70);
      }, 380);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(type, stop);
    // Teclado/leitor de tela: o clique sem ponteiro (detail 0) faz um passo.
    button.addEventListener('click', (event) => {
      if (event.detail === 0) action();
    });
    return button;
  }

  function stepControl(control: Control, direction: 1 | -1): void {
    const current = selected();
    if (!current) return;
    const next = applyControl(current, control, control.read(current) + direction * nudgeStep(control, fine));
    if (control.read(next) !== control.read(current)) replaceDraft(next);
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
    input.style.setProperty('--fill', percentOf(control, value));
    input.addEventListener('input', () => {
      stopPresentation();
      const current = selected();
      if (!current) return;
      remember();
      const next = applyControl(current, control, Number(input.value));
      output.textContent = formatValue(control, control.read(next));
      input.style.setProperty('--fill', percentOf(control, control.read(next)));
      draft = draft.map((candidate) => (candidate.id === next.id ? next : candidate));
      runtime?.updateItem(next);
      redrawSaveBar();
    });
    refs.set(control.id, { input, output, control });
    const stepper = (sign: '−' | '+', direction: 1 | -1): HTMLButtonElement =>
      repeating(
        h('button', { class: 'btn step', type: 'button', 'aria-label': `${direction === 1 ? 'Aumentar' : 'Diminuir'} ${control.label}` }, sign),
        () => stepControl(control, direction),
      );
    return h(
      'div',
      { class: 'slider' },
      h('span', { class: 'slider-label' }, control.label),
      output,
      h('div', { class: 'slider-track' }, stepper('−', -1), input, stepper('+', 1)),
    );
  }

  function checkbox(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
    const input = h('input', { type: 'checkbox', checked, class: 'check-input' });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'check-row' }, input, h('span', {}, label));
  }

  /** Move o item selecionado `dx`/`dy` (larguras do alvo). */
  function nudgePosition(dx: number, dy: number): void {
    const current = selected();
    if (!current) return;
    const px = CONTROLS.find((c) => c.id === 'pos-x')!;
    const py = CONTROLS.find((c) => c.id === 'pos-y')!;
    replaceDraft(moveItem(current, px.read(current) + dx, py.read(current) + dy));
  }

  function moveBlock(): HTMLElement {
    const px = CONTROLS.find((c) => c.id === 'pos-x')!;
    const amount = (): number => nudgeStep(px, fine);
    const arrow = (name: 'up' | 'down' | 'left' | 'right', label: string, dx: 1 | 0 | -1, dy: 1 | 0 | -1): HTMLButtonElement =>
      repeating(
        h('button', { class: `btn dpad-${name}`, type: 'button', 'aria-label': label }, icon(name)),
        () => nudgePosition(dx * amount(), dy * amount()),
      );
    const fineToggle = h(
      'button',
      {
        class: 'btn toggle',
        type: 'button',
        'aria-pressed': String(fine),
        onclick: () => {
          fine = !fine;
          drawPanel();
        },
      },
      'Passo fino',
    );
    return h(
      'div',
      { class: 'move-block' },
      h(
        'div',
        { class: 'dpad', role: 'group', 'aria-label': 'Mover o item' },
        arrow('up', 'Mover para cima', 0, 1),
        arrow('left', 'Mover para a esquerda', -1, 0),
        h('span', { class: 'btn dpad-center', 'aria-hidden': 'true' }, fine ? '0,2%' : '1%'),
        arrow('right', 'Mover para a direita', 1, 0),
        arrow('down', 'Mover para baixo', 0, -1),
      ),
      h('div', { class: 'move-side' }, fineToggle, h('p', { class: 'muted' }, 'Arraste na prévia ou use as setas. O encaixe alinha ao alvo; a grade é opcional.')),
      checkbox('Encaixe em grade (5%)', gridSnap, (value) => { gridSnap = value; drawPanel(); }),
    );
  }

  function quickRow(item: SceneItem): HTMLElement {
    const rotZ = CONTROLS.find((c) => c.id === 'rot-z')!;
    const scale = CONTROLS.find((c) => c.id === 'scale')!;
    const quick = (name: Parameters<typeof icon>[0], label: string, action: () => void): HTMLButtonElement =>
      h('button', { class: 'btn', type: 'button', onclick: action }, icon(name), h('span', {}, label));
    return h(
      'div',
      { class: 'quick-row' },
      quick('center', 'Centralizar', () => {
        const current = selected();
        if (current) replaceDraft(moveItem(current, 0, 0));
      }),
      quick('align', 'Alinhar X', () => {
        const current = selected();
        const neighbor = draft.filter((candidate) => candidate.type !== 'audio' && candidate.id !== current?.id).sort((a, b) => Math.abs(a.transform.position[0] - current!.transform.position[0]) - Math.abs(b.transform.position[0] - current!.transform.position[0]))[0];
        if (current && neighbor) replaceDraft(moveItem(current, neighbor.transform.position[0], current.transform.position[1]));
      }),
      quick('alignY', 'Alinhar Y', () => {
        const current = selected();
        const neighbor = draft.filter((candidate) => candidate.type !== 'audio' && candidate.id !== current?.id).sort((a, b) => Math.abs(a.transform.position[1] - current!.transform.position[1]) - Math.abs(b.transform.position[1] - current!.transform.position[1]))[0];
        if (current && neighbor) replaceDraft(moveItem(current, current.transform.position[0], neighbor.transform.position[1]));
      }),
      quick('rotateLeft', '−15°', () => {
        const current = selected();
        if (current) replaceDraft(applyControl(current, rotZ, wrap(rotZ.read(current) + 15)));
      }),
      quick('rotateRight', '+15°', () => {
        const current = selected();
        if (current) replaceDraft(applyControl(current, rotZ, wrap(rotZ.read(current) - 15)));
      }),
      quick('resize', '100%', () => {
        const current = selected();
        if (current) replaceDraft(applyControl(current, scale, 1));
      }),
    );
    function wrap(degrees: number): number {
      return ((((degrees + 180) % 360) + 360) % 360) - 180;
    }
    void item;
  }

  function drawPanel(): void {
    refs.clear();
    const item = selected();
    if (!item) {
      panel.replaceChildren(
        h('h2', { class: 'card-title' }, 'Item selecionado'),
        h('p', { class: 'muted' }, draft.length === 0 ? 'Adicione fotos, vídeos ou sons para começar.' : 'Toque numa lembrança da lista ou da prévia para ajustá-la.'),
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

    const controls = controlsFor(item.type);
    const byId = (id: string): Control | undefined => controls.find((control) => control.id === id);
    const rows = (ids: string[]): HTMLElement[] =>
      ids.map(byId).filter((control): control is Control => control !== undefined).map((control) => sliderRow(item, control));
    const visual = item.type !== 'audio';

    const children: Array<Node | null> = [
      h(
        'h2',
        { class: 'card-title' },
        item.type === 'carousel'
          ? `${TYPE_LABEL[item.type]} · ${item.slides?.length ?? 0} imagens`
          : `${TYPE_LABEL[item.type]} · ${item.file.fileName}`,
      ),
      h(
        'p',
        { class: 'muted' },
        formatBytes(item.type === 'carousel' ? (item.slides ?? []).reduce((sum, slide) => sum + slide.size, 0) : item.file.size),
      ),
      visual ? h('h3', { class: 'panel-subtitle' }, 'Posição') : null,
      visual ? moveBlock() : null,
      visual ? quickRow(item) : null,
      visual ? h('h3', { class: 'panel-subtitle' }, 'Tamanho e giro') : null,
      ...rows(['scale', 'rot-z']),
    ];

    const media = controls.filter((control) => control.group === 'media').map((control) => sliderRow(item, control));
    if (media.length > 0) children.push(h('h3', { class: 'panel-subtitle' }, 'Mídia'), ...media);

    const advanced = rows(['pos-x', 'pos-y', 'pos-z', 'rot-x', 'rot-y', 'off-x', 'off-y', 'off-z']);
    if (advanced.length > 0) {
      children.push(
        h(
          'details',
          { class: 'fine-tune' },
          h('summary', {}, 'Mais ajustes (posição precisa, inclinação, altura)'),
          h('p', { class: 'muted' }, 'A inclinação e o deslocamento no eixo do próprio item (afastar da pele um item inclinado, por exemplo) ficam aqui.'),
          ...advanced,
        ),
      );
    }

    children.push(
      h('h3', { class: 'panel-subtitle' }, 'Item'),
      h('label', { class: 'field-label' }, 'Nome', nameInput),
      checkbox('Mostrar na câmera', item.visible, (visible) => replaceDraft({ ...selected()!, visible })),
    );

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
    if (item.type === 'carousel') {
      options.push(
        checkbox('Transição suave entre as imagens', item.options.fade, (fade) => replaceDraft({ ...selected()!, options: { ...selected()!.options, fade } })),
      );
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

    if (item.type === 'carousel') {
      const slides = item.slides ?? [];
      children.push(
        h('h3', { class: 'panel-subtitle' }, `Imagens (${slides.length}/${MAX_CAROUSEL_SLIDES})`),
        h(
          'ol',
          { class: 'slide-list' },
          ...slides.map((slide, index) =>
            h(
              'li',
              { class: 'slide-row' },
              h('span', { class: 'item-name' }, `${index + 1}. ${slide.fileName}`),
              h('span', { class: 'muted' }, formatBytes(slide.size)),
              h(
                'button',
                {
                  class: 'btn btn-ghost',
                  type: 'button',
                  disabled: busy || slides.length <= 1,
                  'aria-label': `Remover a imagem ${index + 1}`,
                  onclick: () => void removeSlideOf(slide.slot),
                },
                'Remover',
              ),
            ),
          ),
        ),
        h(
          'div',
          { class: 'row' },
          h('label', { class: 'btn', 'aria-disabled': String(busy || slides.length >= MAX_CAROUSEL_SLIDES) }, 'Adicionar imagens', slideInput),
        ),
        h('p', { class: 'muted' }, 'As fotos trocam sozinhas enquanto a tatuagem está sendo vista; na prévia, use "Reproduzir prévia" para ver a troca. A ordem é a da lista.'),
      );
    }

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
            h('button', { class: 'btn btn-small', type: 'button', disabled: busy || draft.length >= MAX_ITEMS_PER_PROJECT, onclick: () => void duplicateSelected() }, 'Fazer cópia'),
            item.type === 'audio'
              ? null
              : h('button', { class: 'btn btn-small', type: 'button', onclick: () => { const current = selected(); if (current) { replaceDraft(resetTransform(current)); drawPanel(); } } }, 'Restaurar posição'),
            h('button', { class: 'btn btn-small btn-ghost', type: 'button', disabled: busy, onclick: () => { confirmingRemove = true; drawPanel(); } }, 'Remover'),
          ),
    );

    panel.replaceChildren(...children.filter((child): child is Node => child !== null));
  }

  // ------------------------------------------------------------------ desenho

  function redrawList(): void {
    counter.textContent = `${draft.length}/${MAX_ITEMS_PER_PROJECT} lembranças`;
    addLabel.setAttribute('aria-disabled', String(draft.length >= MAX_ITEMS_PER_PROJECT));
    list.replaceChildren(
      h('li', {}, addLabel),
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

  function redrawChoice(): void {
    choiceBox.hidden = choice === null;
    if (choice === null) {
      choiceBox.replaceChildren();
      return;
    }
    const files = choice;
    choiceBox.replaceChildren(
      h('p', {}, `Você escolheu ${files.length} fotos. Como quer guardar esse momento?`),
      h(
        'p',
        { class: 'muted' },
        `Sequência: as fotos mudam sozinhas, na ordem escolhida (até ${MAX_CAROUSEL_SLIDES} fotos). Separadas: ${files.length} lembranças para organizar uma a uma.`,
      ),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => void addCarouselFrom(files) }, 'Criar sequência automática'),
        h('button', { class: 'btn', type: 'button', disabled: busy, onclick: () => void addSeparately(files) }, `Guardar como ${files.length} lembranças`),
        h('button', { class: 'btn btn-ghost', type: 'button', disabled: busy, onclick: () => { choice = null; redrawChoice(); } }, 'Cancelar'),
      ),
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
    redrawChoice();
    redrawPendingFiles();
    redrawPresentation();
    for (const button of [frontButton, tiltedButton, focusButton, playButton]) button.disabled = busy;
    redrawHistory();
  }

  function selectItem(id: string | null): void {
    if (id === selectedId) {
      if (!presentationInternalSelect) stopPresentation();
      return;
    }
    if (!presentationInternalSelect) stopPresentation();
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
          topBar('Lembranças desta tatuagem', () => context.navigate('projects')),
          h('p', { class: 'muted' }, 'Nenhuma lembrança escolhida. Abra uma tatuagem salva em "Minhas lembranças".'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => context.navigate('projects') }, 'Minhas lembranças'),
        ),
      );
      return;
    }

    root.append(
      h(
        'main',
        { class: 'screen editor' },
        topBar('Lembranças desta tatuagem', () => context.navigate('projects')),
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
          topBar('Lembranças desta tatuagem', () => context.navigate('projects')),
          h('p', { class: 'form-error', role: 'alert' }, describeError(error)),
          h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('projects') }, 'Minhas lembranças'),
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
      openSlide: async (itemId, slot) => (await openSlideFile(repo!, projectId!, itemId, slot)).data,
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
      getGridSnap: () => gridSnap,
      onSelect: (id) => selectItem(id),
      onDrag: (id, x, y) => {
        stopPresentation();
        if (id !== selectedId) selectItem(id);
        const item = selected();
        if (item) replaceDraft(moveItem(item, x, y));
      },
      getRotationZ: (id) => {
        const item = draft.find((candidate) => candidate.id === id);
        return item && item.type !== 'audio' ? item.transform.rotation[2] : null;
      },
      getScale: (id) => {
        const item = draft.find((candidate) => candidate.id === id);
        return item && item.type !== 'audio' ? item.transform.scale : null;
      },
      onScale: (id, scale) => {
        const item = draft.find((candidate) => candidate.id === id);
        if (item && item.type !== 'audio') replaceDraft(applyControl(item, CONTROLS.find((c) => c.id === 'scale')!, scale));
      },
      onRotate: (id, degrees) => {
        const item = draft.find((candidate) => candidate.id === id);
        if (item && item.type !== 'audio') replaceDraft(applyControl(item, CONTROLS.find((c) => c.id === 'rot-z')!, degrees));
      },
      onTransformRotate: (id, degrees) => {
        const item = draft.find((candidate) => candidate.id === id);
        if (item && item.type !== 'audio') {
          replaceDraft({ ...item, transform: { ...item.transform, rotation: degrees } });
        }
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
        { class: 'editor-screen' },
        h(
          'header',
          { class: 'editor-head' },
          h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Voltar', onclick: () => context.navigate('projects') }, icon('back')),
          h('h1', { class: 'topbar-title' }, project.name),
          undoButton,
          redoButton,
        ),
        h(
          'div',
          { class: 'editor-stagewrap' },
          stageBox,
          h('p', { class: 'stage-hint' }, 'Toque ou clique para selecionar · Arraste para mover · Gire pelos anéis ou com dois dedos · Pinça redimensiona'),
          stageNote,
          h('div', { class: 'stage-tools' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Ponto de vista da prévia' }, frontButton, tiltedButton), focusButton, playButton),
        ),
        h(
          'div',
          { class: 'editor-sheet' },
          h(
            'section',
            { class: 'stack' },
            h('div', { class: 'items-head' }, h('h2', { class: 'card-title' }, 'Suas lembranças'), counter),
            list,
            addConfirmBox,
            choiceBox,
            layoutBox,
            presentationBox,
            musicBox,
            message,
            statusLine,
            problems,
          ),
          panel,
          h(
            'details',
            { class: 'fine-tune help-box' },
            h('summary', {}, 'Ajustes e formatos aceitos'),
            h(
              'p',
              { class: 'muted' },
              'Toque numa lembrança para escolhê-la, arraste com um dedo para posicionar e use dois dedos sobre a prévia para girar (torcendo) e mudar o tamanho (afastando ou aproximando). A foto é o alvo reconhecido na câmera; o centro dela é o centro do alvo.',
            ),
            h(
              'p',
              { class: 'muted' },
              `Você pode guardar fotos (PNG, JPG, WebP), GIFs, vídeos (MP4, WebM), modelos 3D (GLB, sem compressão Draco) e sons (MP3, OGG, WAV, M4A). Até ${Math.floor(MAX_ITEM_FILE_BYTES / (1024 * 1024))} MB por arquivo e ${MAX_ITEMS_PER_PROJECT} lembranças por tatuagem. Os arquivos ficam só neste aparelho.`,
            ),
            h(
              'p',
              { class: 'muted', id: 'youtube-note' },
              'Músicas e vídeos do YouTube tocam no player incorporado, não sobre a foto 3D. A reprodução exige conexão e segue as restrições do YouTube e do navegador.',
            ),
          ),
        ),
        saveBar,
      ),
    );

    setView('tilted');
    playButton.setAttribute('aria-pressed', 'false');
    selectedId = draft[0]?.id ?? null;
    loadMusicChoice();
    redrawLayoutBox();
    redrawMusicBox();
    redrawPresentation();
    redrawAll();
  }

  void start();

  return () => {
    disposed = true;
    stopPresentation();
    pendingPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
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
