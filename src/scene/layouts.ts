import { Box3, Euler, Vector3 } from 'three';
import type { SceneItem } from '../storage/model';

export type SceneLayout = 'gallery' | 'timeline' | 'semicircle' | 'carousel' | 'focus' | 'heart' | 'spiral' | 'stack' | 'cascade' | 'free';
export interface LayoutOptions {
  spacing?: number;
  orientation?: 'keep' | 'upright' | 'flat';
  bounds?: ReadonlyMap<string, Box3>;
  /** Item que fica em evidência no layout Destaque (padrão: o primeiro visível). */
  focusId?: string;
}

export interface LayoutInfo {
  id: SceneLayout;
  label: string;
  description: string;
  /** Os itens se sobrepõem de propósito (cada um numa altura diferente). */
  overlap?: boolean;
}

export const SCENE_LAYOUTS: ReadonlyArray<LayoutInfo> = [
  { id: 'gallery', label: 'Mural', description: 'Grade equilibrada: todas do mesmo tamanho, aproveitando o espaço.' },
  { id: 'focus', label: 'Destaque', description: 'A lembrança selecionada no centro, maior, e as outras ao redor.' },
  { id: 'timeline', label: 'Linha do tempo', description: 'Da esquerda para a direita, na ordem da lista, em zigue-zague.' },
  { id: 'semicircle', label: 'Arco', description: 'Uma curva aberta, com espaço entre os momentos.' },
  { id: 'carousel', label: 'Roda de lembranças', description: 'Lembranças em círculo. Escolha um movimento para dar vida à roda.' },
  { id: 'heart', label: 'Coração', description: 'Os momentos desenham um coração em volta da tatuagem.' },
  { id: 'spiral', label: 'Espiral', description: 'Uma espiral natural, com o centro mais alto que as bordas.' },
  { id: 'stack', label: 'Pilha de fotos', description: 'Fotos sobrepostas e levemente giradas, como sobre uma mesa.', overlap: true },
  { id: 'cascade', label: 'Escadinha 3D', description: 'Fileiras em diferentes alturas para explorar a profundidade.' },
  { id: 'free', label: 'Composição livre', description: 'Tamanhos, alturas e giros variados, num arranjo descontraído.' },
];

/** Espaço reservado (larguras do alvo) entre o layout e a borda da tatuagem. */
const EDGE_MARGIN = 0.02;

/**
 * Um lugar do layout: centro, espaço que o item pode ocupar, altura sobre a
 * pele e giro no plano. Nos geradores as unidades são livres; depois de
 * `fitSlots` são larguras do alvo.
 */
export interface LayoutSlot {
  x: number;
  y: number;
  z: number;
  /** Raio do círculo livre (vale para qualquer giro do item). */
  r: number;
  /** Meia largura e meia altura do retângulo livre (nas grades, maior que o círculo). */
  w: number;
  h: number;
  spin: number;
}

/** Layouts em grade: o item ocupa a célula retangular inteira, não só o círculo. */
const BOXY: ReadonlySet<SceneLayout> = new Set(['gallery', 'cascade']);

/** Medida conservadora antes da decodificação: o modelo cabe num cubo de lado 0,5. */
export function layoutExtent(item: SceneItem, rotation: [number, number, number], nativeBounds?: Box3): { radius: number; minZ: number; halfX: number; halfY: number } {
  const aspect = item.file.width && item.file.height ? item.file.height / item.file.width : 1;
  const width = 0.5;
  const height = item.type === 'model' ? 0.5 : width * aspect;
  const depth = item.type === 'model' ? 0.5 : 0;
  const radians = rotation.map((degree) => degree * Math.PI / 180) as [number, number, number];
  const euler = new Euler(...radians);
  const bounds = nativeBounds ?? new Box3(new Vector3(-width / 2, -height / 2, item.type === 'model' ? 0 : -depth / 2), new Vector3(width / 2, height / 2, item.type === 'model' ? depth : depth / 2));
  let minZ = 0;
  let radius = 0;
  let halfX = 0;
  let halfY = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const corner = new Vector3(x, y, z).applyEuler(euler);
    minZ = Math.min(minZ, corner.z);
    radius = Math.max(radius, corner.length());
    halfX = Math.max(halfX, Math.abs(corner.x));
    halfY = Math.max(halfY, Math.abs(corner.y));
  }
  return { radius: Math.max(radius, 0.001), minZ, halfX: Math.max(halfX, 0.001), halfY: Math.max(halfY, 0.001) };
}

/** Quanto de cada lugar o item ocupa: "Mais juntinhos" encosta, "Mais espaço" deixa folga. */
export function layoutFill(spacing = 1): number {
  const value = Number.isFinite(spacing) ? spacing : 1;
  return Math.min(0.96, Math.max(0.6, 0.84 - (value - 1) * 0.8));
}

/**
 * Lugares do layout em larguras do alvo (origem no centro), já centralizados e
 * ampliados ao máximo que cabe na tatuagem. Não dependem dos arquivos, então
 * servem também para desenhar a miniatura de cada opção. `cellAspect`
 * (altura / largura) molda as células das grades à proporção das fotos.
 */
export function layoutSlots(layout: SceneLayout, count: number, targetAspect: number, cellAspect = 1): LayoutSlot[] {
  if (count <= 0) return [];
  const aspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 0.75;
  if (count === 1) return fitSlots([circle(0, 0, 1)], aspect);
  if (layout === 'gallery' || layout === 'cascade' || layout === 'free') {
    const cell = layout === 'free' || !Number.isFinite(cellAspect) ? 1 : Math.min(2.5, Math.max(0.4, cellAspect));
    let best: LayoutSlot[] = [];
    for (let columns = 1; columns <= count; columns++) {
      const fitted = fitSlots(gridSlots(layout, count, columns, cell), aspect);
      if (best.length === 0 || fitted[0]!.w * fitted[0]!.h > best[0]!.w * best[0]!.h + 1e-12) best = fitted;
    }
    return best;
  }
  if (layout === 'timeline') {
    // O zigue-zague mais aberto ou mais fechado: fica o que der itens maiores neste alvo.
    let best: LayoutSlot[] = [];
    for (let step = 0.5; step <= 1.0001; step += 0.05) {
      const fitted = fitSlots(timelineSlots(count, step), aspect);
      if (best.length === 0 || fitted[0]!.r > best[0]!.r + 1e-12) best = fitted;
    }
    return best;
  }
  // Em alvos deitados, as formas redondas se esticam na horizontal (e em pé, na vertical).
  const stretch: [number, number] = aspect < 1 ? [Math.min(1.6, 1 / aspect), 1] : [1, Math.min(1.6, aspect)];
  const raw = layout === 'semicircle' ? ringSlots(count, 1, Math.min(1, aspect * 1.25), Math.PI * 0.94, -Math.PI * 0.88, false)
    : layout === 'carousel' ? ringSlots(count, 1, Math.min(1.4, Math.max(0.6, aspect)), Math.PI / 2, -Math.PI * 2, true)
      : layout === 'focus' ? focusSlots(count, stretch)
        : layout === 'heart' ? heartSlots(count, stretch)
          : layout === 'spiral' ? spiralSlots(count, stretch)
            : stackSlots(count);
  return fitSlots(raw, aspect);
}

/**
 * Reposiciona os itens visuais. O tamanho vem do lugar de cada um: os itens
 * ficam com a mesma área ocupada (exceto no Destaque e na Composição livre),
 * nunca se tocam (exceto na Pilha) e não passam da borda da tatuagem.
 */
export function arrangeItems(items: readonly SceneItem[], layout: SceneLayout, targetAspect: number, options: LayoutOptions = {}): SceneItem[] {
  const visual = items.filter((item) => item.type !== 'audio' && item.visible);
  if (visual.length < 2) return items.map((item) => ({ ...item, transform: { ...item.transform } }));
  const fill = layoutFill(options.spacing);
  const focusIndex = Math.max(0, visual.findIndex((item) => item.id === options.focusId));
  // No Destaque, o item em evidência ocupa o lugar 0 e os demais seguem a ordem da lista.
  const order = layout === 'focus' ? [visual[focusIndex]!, ...visual.filter((_, i) => i !== focusIndex)] : visual;
  const rotationFor = (item: SceneItem, spin: number): [number, number, number] => options.orientation === 'upright'
    ? [item.type === 'model' ? 0 : 90, 0, spin]
    : options.orientation === 'flat' ? [item.type === 'model' ? -90 : 0, 0, spin] : [item.transform.rotation[0], item.transform.rotation[1], spin];
  // Nas grades, a célula segue a proporção típica (mediana) dos itens.
  const proportions = order.map((item) => {
    const extent = layoutExtent(item, rotationFor(item, 0), options.bounds?.get(item.id));
    return extent.halfY / extent.halfX;
  }).sort((a, b) => a - b);
  const slots = layoutSlots(layout, order.length, targetAspect, proportions[Math.floor(proportions.length / 2)]);
  const indices = new Map(order.map((item, i) => [item.id, i]));
  return items.map((item) => {
    const index = indices.get(item.id);
    if (index === undefined) return { ...item, transform: { ...item.transform } };
    const slot = slots[index]!;
    const rotation = rotationFor(item, Number(slot.spin.toFixed(1)));
    const bounds = layoutExtent(item, rotation, options.bounds?.get(item.id));
    const room = BOXY.has(layout) ? Math.min(slot.w / bounds.halfX, slot.h / bounds.halfY) : slot.r / bounds.radius;
    const scale = Math.max(0.001, Math.min(5, room * fill));
    return {
      ...item,
      transform: { ...item.transform, position: [slot.x, slot.y, slot.z - bounds.minZ * scale], rotation, scale, offset: [0, 0, 0] },
    };
  });
}

/** Centraliza os lugares e aplica a maior escala uniforme que mantém todos dentro do alvo. */
function fitSlots(slots: readonly LayoutSlot[], aspect: number): LayoutSlot[] {
  const minX = Math.min(...slots.map((slot) => slot.x - slot.w));
  const maxX = Math.max(...slots.map((slot) => slot.x + slot.w));
  const minY = Math.min(...slots.map((slot) => slot.y - slot.h));
  const maxY = Math.max(...slots.map((slot) => slot.y + slot.h));
  const scale = Math.min((1 - 2 * EDGE_MARGIN) / Math.max(1e-9, maxX - minX), (aspect - 2 * EDGE_MARGIN) / Math.max(1e-9, maxY - minY));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return slots.map((slot) => ({ x: (slot.x - cx) * scale, y: (slot.y - cy) * scale, z: slot.z, r: slot.r * scale, w: slot.w * scale, h: slot.h * scale, spin: slot.spin }));
}

const circle = (x: number, y: number, r: number, z = 0, spin = 0): LayoutSlot => ({ x, y, z, r, w: r, h: r, spin });

/** Variação fixa (sem Math.random) para que o mesmo layout dê sempre o mesmo resultado. */
const wobble = (i: number, seed: number): number => Math.sin(i * 12.9898 + seed * 78.233) * 0.5 + Math.sin(i * 4.1414 + seed * 1.618) * 0.5;

/**
 * Grade de células com largura 1 e altura `cell`. As fileiras são divididas
 * por igual (7 itens em 3 fileiras: 3, 2, 2) e as menores ficam centralizadas.
 */
function gridSlots(layout: 'gallery' | 'cascade' | 'free', count: number, columns: number, cell: number): LayoutSlot[] {
  const rows = Math.ceil(count / columns);
  const base = Math.floor(count / rows);
  const extra = count % rows;
  const rowSize = (row: number): number => base + (row < extra ? 1 : 0);
  return Array.from({ length: count }, (_, i) => {
    let row = 0;
    let col = i;
    while (col >= rowSize(row)) col -= rowSize(row++);
    const rowCount = rowSize(row);
    const x = col - (rowCount - 1) / 2;
    const y = -row * cell;
    if (layout === 'free') {
      // Cada item encolhe um pouco dentro da célula e usa a folga para se deslocar.
      const r = 0.5 * (0.78 + 0.22 * (wobble(i, 1) * 0.5 + 0.5));
      const slack = 0.5 - r;
      return circle(x + wobble(i, 2) * slack, y + wobble(i, 3) * slack, r, (i % 3) * 0.03, wobble(i, 4) * 8);
    }
    return { x, y, z: layout === 'cascade' ? (rows - row - 1) * 0.09 : 0, r: Math.min(0.5, cell / 2), w: 0.5, h: cell / 2, spin: 0 };
  });
}

/**
 * Uma fileira em zigue-zague com passo horizontal `step` (0,5 a 1): vizinhos
 * ficam a distância 1 (raio 0,5) e, com passo ≥ 0,5, os de duas casas também.
 */
function timelineSlots(count: number, step: number): LayoutSlot[] {
  const amplitude = Math.sqrt(Math.max(0, 1 - step * step)) / 2;
  return Array.from({ length: count }, (_, i) => circle(i * step, i % 2 === 0 ? amplitude : -amplitude, 0.5));
}

/**
 * Pontos numa elipse (aberta ou fechada) a partir de `start`, percorrendo
 * `sweep` radianos (negativo = sentido horário). O raio vem da menor distância
 * entre vizinhos, com limite para não lotar o centro.
 */
function ringSlots(count: number, rx: number, ry: number, start: number, sweep: number, closed: boolean): LayoutSlot[] {
  const step = sweep / (closed ? count : Math.max(1, count - 1));
  const points = Array.from({ length: count }, (_, i) => ({ x: rx * Math.cos(start + step * i), y: ry * Math.sin(start + step * i) }));
  const r = Math.min(minDistance(points) / 2, 0.55 * Math.min(rx, ry));
  return points.map((point) => circle(point.x, point.y, r));
}

/**
 * Um círculo grande no centro (lugar 0) e os demais num anel em volta,
 * esticado por `stretch`; esticar só afasta, então os vizinhos podem crescer.
 */
function focusSlots(count: number, stretch: [number, number]): LayoutSlot[] {
  const others = count - 1;
  const gap = 0.08;
  const sine = others <= 1 ? 1 : Math.sin(Math.PI / others);
  const r = Math.min(0.62, sine >= 0.999 ? 0.62 : (1 + gap) * sine / (1 - sine));
  const ring = 1 + gap + r;
  // Com um ou dois vizinhos, eles ficam dos lados; a partir de três, o anel começa no alto.
  const start = others <= 2 ? 0 : Math.PI / 2;
  const points = Array.from({ length: others }, (_, i) => {
    const angle = start - 2 * Math.PI * i / others;
    return { x: ring * Math.cos(angle) * stretch[0], y: ring * Math.sin(angle) * stretch[1] };
  });
  const grown = Math.min(0.75, others > 1 ? minDistance(points) / 2 : 0.75, ...points.map((point) => Math.hypot(point.x, point.y) - 1 - gap));
  return [circle(0, 0, 1, 0.04), ...points.map((point) => circle(point.x, point.y, Math.max(r, grown)))];
}

/**
 * Pontos igualmente espaçados (pelo comprimento da curva) num coração
 * simétrico. O primeiro fica na reentrância de cima: dois pontos, um de cada
 * lado dela, ficariam colados e encolheriam todos os itens.
 */
function heartSlots(count: number, stretch: [number, number]): LayoutSlot[] {
  const samples = 720;
  const curve = Array.from({ length: samples + 1 }, (_, i) => {
    const t = 2 * Math.PI * i / samples;
    return { x: 16 * Math.sin(t) ** 3, y: 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) };
  });
  const lengths = [0];
  for (let i = 1; i < curve.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(curve[i]!.x - curve[i - 1]!.x, curve[i]!.y - curve[i - 1]!.y));
  const total = lengths.at(-1)!;
  let cursor = 0;
  const points = Array.from({ length: count }, (_, i) => {
    const target = total * i / count;
    while (cursor < samples - 1 && lengths[cursor + 1]! < target) cursor++;
    const span = lengths[cursor + 1]! - lengths[cursor]!;
    const mix = span > 0 ? (target - lengths[cursor]!) / span : 0;
    const x = curve[cursor]!.x + (curve[cursor + 1]!.x - curve[cursor]!.x) * mix;
    const y = curve[cursor]!.y + (curve[cursor + 1]!.y - curve[cursor]!.y) * mix;
    return { x: x * stretch[0], y: y * stretch[1] };
  });
  const r = Math.min(minDistance(points) / 2, 6);
  return points.map((point) => circle(point.x, point.y, r));
}

/** Espiral de girassol (ângulo de ouro): preenche um disco (esticado), com o centro mais alto. */
function spiralSlots(count: number, stretch: [number, number]): LayoutSlot[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const points = Array.from({ length: count }, (_, i) => {
    const radius = Math.sqrt(i + 0.5);
    return { x: radius * Math.cos(i * golden) * stretch[0], y: radius * Math.sin(i * golden) * stretch[1], radius };
  });
  const outer = Math.sqrt(count - 0.5);
  const r = minDistance(points) / 2;
  return points.map((point) => circle(point.x, point.y, r, 0.1 * (1 - point.radius / outer)));
}

/** Fotos empilhadas: a primeira da lista fica por cima. */
function stackSlots(count: number): LayoutSlot[] {
  const step = Math.min(0.015, 0.25 / count);
  return Array.from({ length: count }, (_, i) => circle(wobble(i, 5) * 0.22, wobble(i, 6) * 0.14, 1, (count - 1 - i) * step, wobble(i, 7) * (i === 0 ? 3 : 12)));
}

function minDistance(points: ReadonlyArray<{ x: number; y: number }>): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    best = Math.min(best, Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y));
  }
  return Number.isFinite(best) && best > 0 ? best : 1;
}
