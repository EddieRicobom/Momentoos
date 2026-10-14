// @ts-nocheck
// Laboratório de interface: renderiza as telas REAIS do app num Chromium, com um projeto
// semeado no IndexedDB (imagem de referência e itens gerados em canvas). Serve para tirar
// capturas de tela e olhar o layout; não faz parte do app. Veja tools/ui-lab/run.mjs.
import { encode } from '@msgpack/msgpack';
import '../../src/styles.css';
import { openRepository } from '../../src/storage/repository';
import { createProject } from '../../src/storage/projects';
import { addItem } from '../../src/storage/scene';
import { createTrackingStore } from '../../src/tracking/store';
import { showToast } from '../../src/ui/components';
import { cameraView } from '../../src/ui/cameraView';
import { createView } from '../../src/ui/createView';
import { editorView } from '../../src/ui/editorView';
import { exportView } from '../../src/ui/exportView';
import { homeView } from '../../src/ui/homeView';
import { importView } from '../../src/ui/importView';
import { projectsView } from '../../src/ui/projectsView';
import { settingsView } from '../../src/ui/settingsView';

const VIEWS = { home: homeView, create: createView, camera: cameraView, settings: settingsView, projects: projectsView, import: importView, export: exportView, editor: editorView };

async function png(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { data: await blob.arrayBuffer(), width, height };
}

const tattoo = (ctx, w, h) => {
  ctx.fillStyle = '#d9b99b';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, h * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(w / 2 + Math.cos(a) * h * 0.32, h / 2 + Math.sin(a) * h * 0.32);
    ctx.lineTo(w / 2 + Math.cos(a) * h * 0.46, h / 2 + Math.sin(a) * h * 0.46);
    ctx.stroke();
  }
};
const badge = (color, label) => (ctx, w, h) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, h - 16, 40);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 90px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, w / 2, h / 2 + 30);
};

let target = null;
let cleanup = null;
let current = 'home';
let editingProject = null;
const root = document.getElementById('app');
const repo = await openRepository({ name: `ui-lab-${Date.now()}` });

const context = {
  store: createTrackingStore(),
  getTarget: () => target,
  setTarget: (next) => { target = next; },
  getRepository: async () => repo,
  getEditingProject: () => editingProject,
  setEditingProject: (id) => { editingProject = id; },
  navigate: (view) => render(view),
  toast: showToast,
};

function render(view) {
  cleanup?.();
  root.replaceChildren();
  current = view;
  cleanup = VIEWS[view](context, root);
}

const reference = await png(640, 480, tattoo);
const mind = encode({ v: 2, dataList: [{ targetImage: { width: 640, height: 480 }, trackingData: [{ points: [] }, { points: [] }], matchingData: [] }] });
const project = await createProject(repo, { name: 'Braço esquerdo', anchor: mind, referenceImage: { data: reference.data, mimeType: 'image/png', width: 640, height: 480 } });
await createProject(repo, { name: 'Costela', anchor: mind, referenceImage: { data: reference.data, mimeType: 'image/png', width: 640, height: 480 } });
const a = await png(256, 256, badge('#e0457b', 'A'));
const b = await png(256, 256, badge('#3b82f6', 'B'));
await addItem(repo, project.id, { file: { data: a.data, fileName: 'estrela.png' }, name: 'Estrela', transform: { position: [-0.18, 0.1, 0.01] } });
await addItem(repo, project.id, { file: { data: b.data, fileName: 'brilho.png' }, name: 'Brilho', transform: { position: [0.2, -0.12, 0.01], scale: 0.7 } });

window.lab = { render, context, projectId: project.id, setEditing: (id) => { editingProject = id; } };
window.labReady = true;
render('home');
