import { NAME_MAX_LENGTH } from '../storage/model';
import { createProject } from '../storage/projects';
import { isFullRect, type NormalizedRect } from '../tracking/cropGeometry';
import {
  loadSourceImage,
  prepareTargetFromSource,
  renderPreview,
  suggestCrop,
  type PreparedTarget,
  type SourceImage,
} from '../tracking/imagePrep';
import { compileTarget, inspectTargetBuffer } from '../tracking/targetCompiler';
import type { EnhanceMode } from '../tracking/targetPixels';
import { statusChip, topBar } from './components';
import type { AppTarget, View } from './context';
import { createCropEditor } from './cropEditor';
import { describeError, downloadBytes, formatBytes, formatDate, formatSeconds, h } from './dom';

interface ModeInfo {
  value: EnhanceMode;
  name: string;
  hint: string;
}

/**
 * Modos de contraste. São HIPÓTESES fundamentadas no código do MindAR (ver
 * src/tracking/targetPixels.ts), ainda não medidas em tatuagens reais: por isso
 * "Original" continua disponível para comparar.
 */
const MODES: ModeInfo[] = [
  {
    value: 'none',
    name: 'Original',
    hint: 'Usa a foto como está. Serve de comparação.',
  },
  {
    value: 'balanced',
    name: 'Equilibrado (sugerido)',
    hint: 'Converte para cinza do mesmo jeito que a câmera do app e estica o contraste. Não troca a ordem dos tons.',
  },
  {
    value: 'strong',
    name: 'Forte (experimental)',
    hint: 'Além disso, realça o contraste local para traços finos. Pode realçar também textura da pele e ruído.',
  },
];

const modeName = (mode: EnhanceMode): string => MODES.find((m) => m.value === mode)?.name.split(' (')[0] ?? mode;

export const createView: View = (context, root) => {
  const { store } = context;
  const chip = statusChip(store);
  let busy = false;
  let disposed = false;
  let saving = false;
  let source: SourceImage | null = null;
  let sourceName = '';
  let mode: EnhanceMode = 'balanced';
  let frame: number | null = null;

  const nameInput = h('input', {
    class: 'text-input',
    type: 'text',
    maxlength: String(NAME_MAX_LENGTH),
    autocomplete: 'off',
    'aria-label': 'Nome do projeto',
  });
  nameInput.value = defaultProjectName();
  const saveError = h('p', { class: 'form-error', role: 'alert' });
  saveError.hidden = true;

  const progress = h('progress', {
    class: 'progress',
    max: '100',
    value: '0',
    'aria-label': 'Progresso da preparação do alvo',
  });
  progress.hidden = true;

  const preview = h('img', { class: 'preview', alt: 'Imagem usada como alvo' });
  preview.hidden = true;

  const result = h('section', { class: 'card result' });

  // ---------- seletores de arquivo (gerados por botões) ----------
  const galleryInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  // `capture` pede ao celular que abra o app de câmera em vez da galeria.
  const cameraInput = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    hidden: true,
  });
  const mindInput = h('input', { type: 'file', accept: '.mind,application/octet-stream', hidden: true });

  const galleryButton = h(
    'button',
    { class: 'btn btn-primary', type: 'button', onclick: () => galleryInput.click() },
    'Escolher da galeria',
  );
  const photoButton = h(
    'button',
    { class: 'btn', type: 'button', onclick: () => cameraInput.click() },
    'Fotografar',
  );
  const loadMindButton = h(
    'button',
    { class: 'btn btn-ghost', type: 'button', onclick: () => mindInput.click() },
    'Carregar alvo salvo (.mind)',
  );

  // ---------- ajuste de recorte e contraste ----------
  const cropEditor = createCropEditor(() => {
    cropNote.hidden = true;
    schedulePreview();
  });
  const cropNote = h('p', { class: 'muted' });
  cropNote.hidden = true;
  const suggestButton = h(
    'button',
    { class: 'btn', type: 'button', onclick: () => applySuggestion(true) },
    'Sugerir área da tatuagem',
  );
  const fullButton = h(
    'button',
    {
      class: 'btn btn-ghost',
      type: 'button',
      onclick: () => {
        cropEditor.setRect(null);
        cropNote.hidden = true;
        schedulePreview();
      },
    },
    'Usar a foto inteira',
  );
  const enhancePreview = h('div', { class: 'stack' });
  const compileButton = h(
    'button',
    { class: 'btn btn-primary', type: 'button', onclick: () => void handleCompile() },
    'Compilar alvo',
  );

  const modeList = h(
    'fieldset',
    { class: 'mode-list' },
    h('legend', { class: 'field-label' }, 'Contraste interno (a tatuagem aparece em cinza para o rastreador)'),
    ...MODES.map((info) => {
      const input = h('input', {
        type: 'radio',
        name: 'enhance-mode',
        value: info.value,
        checked: info.value === mode,
        onchange: () => {
          mode = info.value;
          schedulePreview();
        },
      });
      return h(
        'label',
        { class: 'mode-option' },
        input,
        h('span', null, h('strong', null, info.name), h('span', { class: 'muted block' }, info.hint)),
      );
    }),
  );

  const adjust = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, '2. Área da tatuagem e contraste'),
    h(
      'p',
      { class: 'muted' },
      'Arraste o retângulo para ficar só em volta da tatuagem. Quanto menos pele e fundo dentro dele, mais o app aproveita a imagem para reconhecer a tatuagem. O rastreador usa a imagem em tons de cinza.',
    ),
    cropEditor.element,
    cropNote,
    h('div', { class: 'row' }, suggestButton, fullButton),
    modeList,
    h('p', { class: 'muted' }, 'É assim que o app vai enxergar a imagem:'),
    enhancePreview,
    h('div', { class: 'row' }, compileButton),
    progress,
  );
  adjust.hidden = true;

  function setBusy(value: boolean): void {
    busy = value;
    for (const button of [galleryButton, photoButton, loadMindButton, compileButton, suggestButton, fullButton]) {
      button.disabled = value;
    }
  }

  const currentCrop = (): NormalizedRect | null => {
    const rect = cropEditor.getRect();
    return isFullRect(rect) ? null : rect;
  };

  function schedulePreview(): void {
    if (frame !== null || !source) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (disposed || !source) return;
      try {
        const canvas = renderPreview(source, { crop: currentCrop(), enhance: mode });
        canvas.className = 'enhance-preview';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Prévia da imagem como o rastreador a enxerga');
        enhancePreview.replaceChildren(canvas);
      } catch (error) {
        enhancePreview.replaceChildren(h('p', { class: 'form-error' }, describeError(error)));
      }
    });
  }

  function applySuggestion(explicit: boolean): void {
    if (!source) return;
    let suggestion: NormalizedRect | null = null;
    try {
      suggestion = suggestCrop(source);
    } catch {
      suggestion = null;
    }
    cropEditor.setRect(suggestion);
    cropNote.hidden = false;
    cropNote.textContent = suggestion
      ? 'Área sugerida automaticamente (procura tinta mais escura que a pele). Confira e ajuste se precisar.'
      : explicit
        ? 'Não consegui identificar uma área clara. Arraste o retângulo para marcar a tatuagem.'
        : 'Não consegui sugerir uma área; está usando a foto inteira. Arraste o retângulo para marcar a tatuagem.';
    schedulePreview();
  }

  async function handlePhoto(file: File): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const next = await loadSourceImage(file);
      source?.dispose();
      source = next;
      sourceName = file.name || 'foto';
      cropEditor.setImage(next.objectUrl, next.width, next.height);
      adjust.hidden = false;
      applySuggestion(false);
    } catch (error) {
      // PREPARE_FAILED só vale durante o preparo; ler a foto é "carregar".
      store.dispatch({ type: 'TARGET_LOAD_FAILED', message: describeError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCompile(): Promise<void> {
    if (busy || !source) return;
    const chosenMode = mode;
    const crop = currentCrop();
    setBusy(true);
    store.dispatch({ type: 'PREPARE_START' });
    let prepared: PreparedTarget | null = null;
    try {
      prepared = await prepareTargetFromSource(source, { crop, enhance: chosenMode });
      const compiled = await compileTarget(prepared.image, (percent) =>
        store.dispatch({ type: 'PREPARE_PROGRESS', percent }),
      );
      context.setTarget({
        buffer: compiled.buffer,
        width: compiled.width,
        height: compiled.height,
        origin: 'compiled',
        label: sourceName,
        previewUrl: prepared.objectUrl,
        compileMs: compiled.compileMs,
        projectId: null,
        // Guardamos a imagem EXATA que foi compilada (recortada e realçada):
        // recompilar depois reproduz o mesmo alvo.
        referenceImage: { blob: prepared.blob, width: prepared.width, height: prepared.height },
        note: `Recorte: ${crop ? 'sim' : 'foto inteira'} · Contraste: ${modeName(chosenMode)}`,
      });
      nameInput.value = defaultProjectName(undefined, modeName(chosenMode));
      saveError.hidden = true;
      store.dispatch({ type: 'PREPARE_DONE' });
    } catch (error) {
      prepared?.dispose();
      store.dispatch({ type: 'PREPARE_FAILED', message: describeError(error) });
    } finally {
      setBusy(false);
      renderResult();
    }
  }

  async function handleMind(file: File): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const info = inspectTargetBuffer(buffer);
      context.setTarget({
        buffer,
        width: info.width,
        height: info.height,
        origin: 'file',
        label: file.name,
        previewUrl: null,
        compileMs: null,
        projectId: null,
        referenceImage: null,
        note: null,
      });
      nameInput.value = defaultProjectName(file.name);
      saveError.hidden = true;
      store.dispatch({ type: 'TARGET_LOADED' });
    } catch (error) {
      store.dispatch({ type: 'TARGET_LOAD_FAILED', message: describeError(error) });
    } finally {
      setBusy(false);
      renderResult();
    }
  }

  galleryInput.addEventListener('change', () => takeFile(galleryInput, handlePhoto));
  cameraInput.addEventListener('change', () => takeFile(cameraInput, handlePhoto));
  mindInput.addEventListener('change', () => takeFile(mindInput, handleMind));

  function renderResult(): void {
    const target = context.getTarget();
    result.replaceChildren();
    if (!target) {
      result.hidden = true;
      return;
    }
    result.hidden = false;
    if (target.previewUrl) {
      preview.src = target.previewUrl;
      preview.hidden = false;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
    const details = [
      `${target.width}×${target.height} px`,
      formatBytes(target.buffer.byteLength),
      target.compileMs !== null
        ? `compilado em ${formatSeconds(target.compileMs)}`
        : target.origin === 'project'
          ? 'aberto de um projeto salvo'
          : 'carregado de arquivo .mind',
    ];
    result.append(
      h('h2', { class: 'card-title' }, 'Alvo pronto'),
      preview,
      h('p', { class: 'muted' }, details.join(' · ')),
      ...(target.note ? [h('p', { class: 'muted' }, target.note)] : []),
      ...saveSection(target),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          { class: 'btn btn-primary', type: 'button', onclick: () => context.navigate('camera') },
          'Testar rastreamento',
        ),
        h(
          'button',
          { class: 'btn', type: 'button', onclick: () => downloadTarget(target) },
          'Baixar alvo (.mind)',
        ),
      ),
      ...(source
        ? [
            h(
              'p',
              { class: 'muted' },
              'Quer comparar? Salve este, volte ao passo 2, mude o recorte ou o contraste e compile de novo: cada versão vira um projeto com o nome do contraste usado.',
            ),
          ]
        : []),
    );
  }

  function saveSection(target: AppTarget): Node[] {
    if (target.projectId !== null) {
      return [
        h(
          'p',
          { class: 'muted' },
          'Salvo neste aparelho. Para reabrir sem recompilar, use "Meus projetos".',
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => context.navigate('projects') }, 'Ver meus projetos'),
        ),
      ];
    }
    const note =
      target.referenceImage === null
        ? 'Este alvo veio de um arquivo .mind, sem a foto original: dá para salvá-lo e usá-lo, mas não para recompilar depois.'
        : 'Ainda não salvo: ele existe só enquanto este app estiver aberto. Salve para reabrir depois sem recompilar. A imagem usada fica guardada só neste aparelho.';
    const saveButton = h(
      'button',
      { class: 'btn btn-primary', type: 'button', onclick: () => void saveProject(target, saveButton) },
      'Salvar projeto',
    );
    return [
      h('p', { class: 'muted' }, note),
      h('label', { class: 'field-label' }, 'Nome do projeto', nameInput),
      saveError,
      h('div', { class: 'row' }, saveButton),
    ];
  }

  async function saveProject(target: AppTarget, button: HTMLButtonElement): Promise<void> {
    if (saving) return;
    saving = true;
    button.disabled = true;
    saveError.hidden = true;
    try {
      const repo = await context.getRepository();
      const reference = target.referenceImage;
      const record = await createProject(repo, {
        name: nameInput.value,
        anchor: target.buffer,
        referenceImage: reference
          ? {
              data: await reference.blob.arrayBuffer(),
              mimeType: reference.blob.type || 'image/png',
              width: reference.width,
              height: reference.height,
            }
          : null,
      });
      // Se o alvo mudou enquanto salvava, o projeto foi salvo mas o alvo atual é outro.
      if (context.getTarget() === target) {
        context.setTarget({ ...target, projectId: record.id, referenceImage: null });
      }
      context.toast(`Projeto "${record.name}" salvo.`);
    } catch (error) {
      if (!disposed) {
        saveError.textContent = describeError(error);
        saveError.hidden = false;
        button.disabled = false;
      }
    } finally {
      saving = false;
      if (!disposed) renderResult();
    }
  }

  const unsubscribe = store.subscribe((state) => {
    const preparing = state.status === 'preparing-target';
    progress.hidden = !preparing;
    // Sem progresso ainda (decodificando/reduzindo a foto): barra indeterminada.
    if (preparing && state.progress > 0) progress.value = state.progress;
    else if (preparing) progress.removeAttribute('value');
  });

  root.append(
    h(
      'main',
      { class: 'screen' },
      topBar('Criar âncora', () => context.navigate('home')),
      h('div', { class: 'status-row' }, chip.element),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, '1. Foto da tatuagem'),
        h(
          'p',
          { class: 'muted' },
          'Use uma foto nítida, com boa luz e a tatuagem preenchendo o quadro. Sem reflexo e sem sombra forte. O app recorta, ajusta o contraste e compila o alvo aqui mesmo, sem enviar nada para a internet.',
        ),
        h('div', { class: 'row' }, galleryButton, photoButton),
      ),
      adjust,
      result,
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'card-title' }, 'Já tem um alvo?'),
        h('p', { class: 'muted' }, 'Recarregue um arquivo .mind baixado antes: nada é recompilado.'),
        h('div', { class: 'row' }, loadMindButton),
      ),
      galleryInput,
      cameraInput,
      mindInput,
    ),
  );
  renderResult();

  return () => {
    disposed = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    cropEditor.destroy();
    source?.dispose();
    source = null;
    unsubscribe();
    chip.destroy();
  };
};

function takeFile(input: HTMLInputElement, handler: (file: File) => Promise<void>): void {
  const file = input.files?.[0];
  // Limpa para que escolher o mesmo arquivo de novo dispare "change".
  input.value = '';
  if (file) void handler(file);
}

function defaultProjectName(fileName?: string, suffix?: string): string {
  const base = fileName?.replace(/\.[^.]+$/, '').trim() || `Tatuagem ${formatDate(new Date())}`;
  const name = suffix ? `${base} · ${suffix}` : base;
  return name.slice(0, NAME_MAX_LENGTH);
}

function downloadTarget(target: AppTarget): void {
  const base = target.label.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
  downloadBytes(target.buffer, `${base || 'tatuagem'}.mind`, 'application/octet-stream');
}
