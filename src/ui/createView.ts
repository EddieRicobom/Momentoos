import { prepareTargetImage, type PreparedTarget } from '../tracking/imagePrep';
import { compileTarget, inspectTargetBuffer } from '../tracking/targetCompiler';
import { statusChip, topBar } from './components';
import type { AppTarget, View } from './context';
import { formatBytes, formatSeconds, h } from './dom';

export const createView: View = (context, root) => {
  const { store } = context;
  const chip = statusChip(store);
  let busy = false;

  const progress = h('progress', {
    class: 'progress',
    max: '100',
    value: '0',
    'aria-label': 'Progresso da preparação do alvo',
  });
  progress.hidden = true;

  const preview = h('img', { class: 'preview', alt: 'Tatuagem escolhida como alvo' });
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

  function setBusy(value: boolean): void {
    busy = value;
    for (const button of [galleryButton, photoButton, loadMindButton]) {
      button.disabled = value;
    }
  }

  async function handleImage(file: File): Promise<void> {
    if (busy) return;
    setBusy(true);
    store.dispatch({ type: 'PREPARE_START' });
    let prepared: PreparedTarget | null = null;
    try {
      prepared = await prepareTargetImage(file);
      preview.src = prepared.objectUrl;
      preview.hidden = false;

      const compiled = await compileTarget(prepared.image, (percent) =>
        store.dispatch({ type: 'PREPARE_PROGRESS', percent }),
      );

      const previous = context.getTarget();
      if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      context.setTarget({
        buffer: compiled.buffer,
        width: compiled.width,
        height: compiled.height,
        origin: 'compiled',
        label: file.name || 'foto',
        previewUrl: prepared.objectUrl,
        compileMs: compiled.compileMs,
      });
      store.dispatch({ type: 'PREPARE_DONE' });
    } catch (error) {
      prepared?.dispose();
      preview.hidden = true;
      preview.removeAttribute('src');
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
      const previous = context.getTarget();
      if (previous?.previewUrl) URL.revokeObjectURL(previous.previewUrl);
      preview.hidden = true;
      preview.removeAttribute('src');
      context.setTarget({
        buffer,
        width: info.width,
        height: info.height,
        origin: 'file',
        label: file.name,
        previewUrl: null,
        compileMs: null,
      });
      store.dispatch({ type: 'TARGET_LOADED' });
    } catch (error) {
      store.dispatch({ type: 'TARGET_LOAD_FAILED', message: describeError(error) });
    } finally {
      setBusy(false);
      renderResult();
    }
  }

  galleryInput.addEventListener('change', () => takeFile(galleryInput, handleImage));
  cameraInput.addEventListener('change', () => takeFile(cameraInput, handleImage));
  mindInput.addEventListener('change', () => takeFile(mindInput, handleMind));

  function renderResult(): void {
    const target = context.getTarget();
    result.replaceChildren();
    if (!target) {
      result.hidden = true;
      return;
    }
    result.hidden = false;
    if (target.previewUrl && preview.hidden) {
      preview.src = target.previewUrl;
      preview.hidden = false;
    }
    const details = [
      `${target.width}×${target.height} px`,
      formatBytes(target.buffer.byteLength),
      target.compileMs !== null ? `compilado em ${formatSeconds(target.compileMs)}` : 'carregado de arquivo .mind',
    ];
    result.append(
      h('h2', { class: 'card-title' }, 'Alvo pronto'),
      h('p', { class: 'muted' }, details.join(' · ')),
      h(
        'p',
        { class: 'muted' },
        'O alvo está só na memória deste app aberto. Baixe o .mind se quiser reaproveitá-lo sem recompilar; salvar no aparelho automaticamente chega na Etapa C.',
      ),
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
    );
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
          'Use uma foto nítida, com boa luz e a tatuagem preenchendo o quadro. Sem reflexo e sem sombra forte. O app reduz a imagem e compila o alvo aqui mesmo, sem enviar nada para a internet.',
        ),
        h('div', { class: 'row' }, galleryButton, photoButton),
        progress,
        preview,
      ),
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

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Erro desconhecido.';
}

function downloadTarget(target: AppTarget): void {
  const base = target.label.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
  const name = `${base || 'tatuagem'}.mind`;
  const url = URL.createObjectURL(
    new Blob([target.buffer.slice()], { type: 'application/octet-stream' }),
  );
  const link = h('a', { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
