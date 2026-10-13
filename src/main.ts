import './styles.css';
import { openRepository, type ProjectRepository } from './storage/repository';
import { createTrackingStore } from './tracking/store';
import { showToast } from './ui/components';
import { cameraView } from './ui/cameraView';
import type { AppContext, AppTarget, View, ViewName } from './ui/context';
import { createView } from './ui/createView';
import { editorView } from './ui/editorView';
import { exportView } from './ui/exportView';
import { homeView } from './ui/homeView';
import { importView } from './ui/importView';
import { projectsView } from './ui/projectsView';
import { settingsView } from './ui/settingsView';

const VIEWS: Record<ViewName, View> = {
  home: homeView,
  create: createView,
  camera: cameraView,
  settings: settingsView,
  projects: projectsView,
  import: importView,
  export: exportView,
  editor: editorView,
};

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app não encontrado em index.html');

let target: AppTarget | null = null;
let cleanup: (() => void) | null = null;
let current: ViewName = 'home';
let editingProject: string | null = null;
let repositoryPromise: Promise<ProjectRepository> | null = null;

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
    const previousUrl = target?.previewUrl ?? null;
    if (previousUrl && previousUrl !== (next?.previewUrl ?? null)) URL.revokeObjectURL(previousUrl);
    target = next;
  },
  getRepository() {
    if (!repositoryPromise) {
      repositoryPromise = openRepository();
      // Se a abertura falhar, a próxima tentativa começa do zero.
      repositoryPromise.catch(() => {
        repositoryPromise = null;
      });
    }
    return repositoryPromise;
  },
  getEditingProject: () => editingProject,
  setEditingProject(id) {
    editingProject = id;
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
