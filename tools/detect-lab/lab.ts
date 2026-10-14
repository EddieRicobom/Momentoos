// @ts-nocheck — ferramenta de desenvolvimento; o MindAR não tem tipos completos.
/**
 * Laboratório de detecção: roda o MindAR REAL (detector, casamento no worker,
 * estimador de pose e rastreador) contra quadros sintéticos distorcidos e mede
 * o que é reconhecido. Veja tools/detect-lab/run.mjs.
 *
 * Limite honesto: as imagens são sintéticas e a câmera é simulada. Os números
 * servem para comparar "antes/depois" de uma mudança; não provam desempenho em
 * uma tatuagem real num celular real.
 */
import * as tf from '@tensorflow/tfjs';
import { Compiler } from 'mind-ar/src/image-target/compiler.js';
import { Controller } from 'mind-ar/src/image-target/controller.js';
import {
  buildModelViewProjectionTransform,
  computeScreenCoordiate,
} from 'mind-ar/src/image-target/estimation/utils.js';
import { Estimator } from 'mind-ar/src/image-target/estimation/estimator.js';
import { prepareTargetImage } from '../../src/tracking/imagePrep';
import { compileTarget } from '../../src/tracking/targetCompiler';
import {
  applyH,
  makeTattoo,
  renderFrame,
  NEUTRAL_GEOMETRY,
  NEUTRAL_LOOK,
} from './synth';

const FRAME_W = 640;
const FRAME_H = 480;

let controller = null;
let source = null; // canvas da "tatuagem" (verdade)
let targetW = 0;
let targetH = 0;

function canvasBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

let debugMode = false;

/** Experimento: normalização local de contraste aplicada ao quadro da câmera. */
function lcnTensor(gray, { win, target, maxGain }) {
  return tf.tidy(() => {
    const x = gray.expandDims(0).expandDims(-1);
    const mean = tf.avgPool(x, win, 1, 'same');
    const sq = tf.avgPool(x.square(), win, 1, 'same');
    const std = sq.sub(mean.square()).maximum(1).sqrt();
    const gain = tf.scalar(target).div(std).minimum(maxGain);
    return x.sub(mean).mul(gain).add(128).clipByValue(0, 255).squeeze([0, 3]);
  });
}

async function setup({ design, seed, enhance = 'none', variants = false, debug = false, lcn = null }) {
  debugMode = debug;
  if (controller) controller.dispose();
  source = makeTattoo(design, seed);
  const prepared = await prepareTargetImage(await canvasBlob(source), { enhance });
  const t0 = performance.now();
  const compiled = await compileTarget(prepared.image, () => {}, { variants });
  const compileMs = performance.now() - t0;
  targetW = compiled.width;
  targetH = compiled.height;
  controller = new Controller({ inputWidth: FRAME_W, inputHeight: FRAME_H, maxTrack: 1, debugMode });
  controller.addImageTargetsFromBuffer(compiled.buffer);
  if (lcn) {
    const loader = controller.inputLoader;
    const orig = loader.loadInput.bind(loader);
    let n = 0;
    loader.loadInput = (input) => {
      const raw = orig(input);
      n++;
      // lcn.alt: alterna quadro cru / normalizado (cobre os dois casos de luz)
      if (lcn.alt && n % 2 === 0) return raw;
      const out = lcnTensor(raw, lcn);
      raw.dispose();
      return out;
    };
  }
  const warm = renderFrame(source, NEUTRAL_GEOMETRY, NEUTRAL_LOOK, FRAME_W, FRAME_H, 1).canvas;
  controller.dummyRun(warm);
  return { compileMs, bytes: compiled.buffer.byteLength, width: targetW, height: targetH, variantKeyframes: compiled.variantKeyframes, trackingPoints: new Compiler().importData(compiled.buffer)[0].trackingData.map((t) => t.points.length) };
}

function corners() {
  return [
    [0, 0],
    [targetW, 0],
    [targetW, targetH],
    [0, targetH],
  ];
}

function poseError(mvt, H) {
  const mvp = buildModelViewProjectionTransform(controller.projectionTransform, mvt);
  let sum = 0;
  let diag = 0;
  const truth = corners().map(([x, y]) => applyH(H, x, y));
  corners().forEach(([x, y], i) => {
    const p = computeScreenCoordiate(mvp, x, y, 0);
    const t = truth[i];
    sum += Math.hypot(p.x - t[0], p.y - t[1]);
  });
  diag = Math.hypot(truth[2][0] - truth[0][0], truth[2][1] - truth[0][1]);
  const [cx, cy] = applyH(H, targetW / 2, targetH / 2);
  const mc = computeScreenCoordiate(mvp, targetW / 2, targetH / 2, 0);
  return { cornerErr: sum / 4 / diag, centerErr: Math.hypot(mc.x - cx, mc.y - cy) / diag };
}

/**
 * Piso de erro: a melhor pose RÍGIDA possível para esta deformação (estimador do
 * MindAR alimentado com correspondências perfeitas). Esticar/achatar a pele não
 * é um movimento rígido, então nem um reconhecimento perfeito zera o erro.
 */
function rigidFloor(H) {
  const est = new Estimator(controller.projectionTransform);
  const screenCoords = [];
  const worldCoords = [];
  for (let i = 0; i <= 8; i++)
    for (let j = 0; j <= 8; j++) {
      const x = (targetW * i) / 8;
      const y = (targetH * j) / 8;
      const [sx, sy] = applyH(H, x, y);
      screenCoords.push({ x: sx, y: sy });
      worldCoords.push({ x, y, z: 0 });
    }
  const mvt = est.estimate({ screenCoords, worldCoords });
  return mvt ? poseError(mvt, H) : null;
}

/**
 * Emula o que o MindAR faz: a cada quadro tenta um recorte (os 9 recortes se
 * revezam), e uma pose achada só vale se o rastreador a confirmar em
 * WARMUP quadros seguidos (warmupTolerance = 5 no controller). Poses falsas
 * costumam morrer aqui ("rejeitada") e a busca continua no quadro seguinte.
 */
const WARMUP = 6;

async function verify(canvas, mvt) {
  let cur = mvt;
  for (let i = 0; i < WARMUP; i++) {
    const tr = await controller.track(canvas, cur, 0);
    if (debugMode) (window.__trk ??= []).push({ i, good: tr.worldCoords.length, total: controller.tracker.trackingKeyframeList[0].points.length });
    if (tr.worldCoords.length < 4) return null;
    const next = await controller.trackUpdate(cur, tr);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

async function detectOnce(canvas, H) {
  controller.cropDetector.lastRandomIndex = 4;
  let nFeat = 0;
  let matchMs = 0;
  let rejected = 0;
  for (let k = 0; k < 9; k++) {
    const inputT = controller.inputLoader.loadInput(canvas);
    const { featurePoints } = controller.cropDetector.detectMoving(inputT);
    inputT.dispose();
    nFeat = Math.max(nFeat, featurePoints.length);
    const tm = performance.now();
    const r = await controller._workerMatch(featurePoints, [0]);
    if (debugMode) (window.__dbg ??= []).push({ k, pts: featurePoints.length, frames: (r.debugExtra?.frames ?? []).map((f) => f && { m: f.matches?.length ?? 0, h: f.houghMatches?.length ?? 0, i: f.inlierMatches?.length ?? 0, i2: f.inlierMatches2?.length ?? 0 }), found: r.targetIndex });
    matchMs += performance.now() - tm;
    if (r.targetIndex !== -1 && r.modelViewTransform) {
      const locked = await verify(canvas, r.modelViewTransform);
      if (!locked) {
        rejected++;
        continue;
      }
      const e = poseError(locked, H);
      return { found: true, frames: k + 1, nFeat, matchMs, rejected, mvt: locked, ...e };
    }
  }
  return { found: false, frames: null, nFeat, matchMs, rejected };
}

async function detectCase(geometry, look, seed = 1) {
  const g = { ...NEUTRAL_GEOMETRY, ...geometry };
  const l = { ...NEUTRAL_LOOK, ...look };
  const { canvas, H } = renderFrame(source, g, l, FRAME_W, FRAME_H, seed);
  const r = await detectOnce(canvas, H);
  delete r.mvt;
  // "reconhecido de verdade": achou E a pose cai em cima da tatuagem
  const floor = rigidFloor(H);
  r.floorCorner = floor ? floor.cornerErr : null;
  r.floorCenter = floor ? floor.centerErr : null;
  // "reconhecido de verdade": achou E a pose cai em cima da tatuagem, a menos do erro
  // inevitável de uma pose rígida (floor)
  r.good = r.found && r.centerErr < Math.max(0.12, (r.floorCenter ?? 0) + 0.08) && r.cornerErr < Math.max(0.2, (r.floorCorner ?? 0) + 0.1);
  return r;
}

/**
 * Teste de rastreamento: trava de frente e vai variando um parâmetro em passos
 * pequenos; devolve o último valor em que o rastreador ainda segurava.
 */
async function holdSweep(param, from, to, steps, base = {}, look = {}) {
  const g0 = { ...NEUTRAL_GEOMETRY, ...base };
  const l = { ...NEUTRAL_LOOK, ...look };
  const first = renderFrame(source, { ...g0, [param]: from }, l, FRAME_W, FRAME_H, 1);
  const lock = await detectOnce(first.canvas, first.H);
  if (!lock.found) return { locked: false };
  let mvt = lock.mvt;
  let lastGood = from;
  for (let i = 1; i <= steps; i++) {
    const v = from + ((to - from) * i) / steps;
    const fr = renderFrame(source, { ...g0, [param]: v }, l, FRAME_W, FRAME_H, 1 + i);
    // vários ciclos de rastreio por quadro, como o app (um por frame de câmera)
    const tr = await controller.track(fr.canvas, mvt, 0);
    if (tr.worldCoords.length < 4) return { locked: true, lastGood, lostAt: v, reason: 'poucos pontos' };
    const next = await controller.trackUpdate(mvt, tr);
    if (!next) return { locked: true, lastGood, lostAt: v, reason: 'estimador' };
    const e = poseError(next, fr.H);
    if (e.centerErr > 0.15 || e.cornerErr > 0.25) return { locked: true, lastGood, lostAt: v, reason: 'pose errada' };
    mvt = next;
    lastGood = v;
  }
  return { locked: true, lastGood, lostAt: null };
}

async function debugCase(geometry, look) {
  window.__dbg = [];
  const r = await detectCase(geometry, look);
  return { r, dbg: window.__dbg };
}

window.lab = { setup, detectCase, holdSweep, debugCase };
window.labReady = true;
