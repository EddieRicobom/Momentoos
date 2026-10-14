import { statusLabel, statusTone } from '../tracking/state';
import type { TrackingStore } from '../tracking/store';
import { h } from './dom';
import { icon } from './icons';

/**
 * Indicador de estado do rastreamento. Retorna o elemento e a função que
 * cancela a assinatura no store (chamar na limpeza da tela).
 */
export function statusChip(store: TrackingStore): { element: HTMLElement; destroy(): void } {
  const text = h('span', { class: 'chip-text' });
  const detail = h('span', { class: 'chip-detail' });
  const element = h(
    'div',
    { class: 'chip', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'chip-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'chip-body' }, text, detail),
  );

  const destroy = store.subscribe((state) => {
    element.dataset.tone = statusTone(state.status);
    text.textContent = statusLabel(state);
    detail.textContent = state.message ?? '';
    detail.hidden = !state.message;
  });

  return { element, destroy };
}

export function topBar(title: string, onBack: () => void): HTMLElement {
  return h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn btn-icon', type: 'button', onclick: onBack, 'aria-label': 'Voltar' }, icon('back')),
    h('h1', { class: 'topbar-title' }, title),
  );
}

let toastTimer: number | null = null;

export function showToast(message: string): void {
  let region = document.getElementById('toast');
  if (!region) {
    region = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(region);
  }
  region.textContent = message;
  region.classList.add('toast-visible');
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    region?.classList.remove('toast-visible');
  }, 5500);
}
