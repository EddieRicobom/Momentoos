import './styles.css';
import { createTrackingStore } from './tracking/store';
import { showToast } from './ui/components';
import { cameraView } from './ui/cameraView';
import type { AppContext, AppTarget, View, ViewName } from './ui/context';
import { createView } from './ui/createView';
import { homeView } from './ui/homeView';
import { settingsView } from './ui/settingsView';

const VIEWS: Record<ViewName, View> = {
  home: homeView,
  create: createView,
  camera: cameraView,
  settings: settingsView,
};

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app não encontrado em index.html');

let target: AppTarget | null = null;
let cleanup: (() => void) | null = null;
let current: ViewName = 'home';

function render(view: ViewName): void {
  cleanup?.();
  cleanup = null;
  root!.replaceChildren();
  current = view;
  cleanup = VIEWS[view](context, root!);
  window.scrollTo(0, 0);
}

const context: AppContext = {
  store: createTrackingStore(),
  getTarget: () => target,
  setTarget: (next) => {
    target = next;
  },
  navigate(view) {
    if (view === current) return;
    history.pushState({ view }, '');
    render(view);
  },
  toast: showToast,
};

// Botão "voltar" do Android (e do navegador) percorre as telas; na tela da
// câmera isso também encerra a sessão de rastreamento.
window.addEventListener('popstate', (event) => {
  const state = event.state as { view?: ViewName } | null;
  render(state?.view && state.view in VIEWS ? state.view : 'home');
});

history.replaceState({ view: 'home' }, '');
render('home');
