import { Box3, Euler, Vector3 } from 'three';
import type { SceneItem } from '../storage/model';

export type SceneLayout = 'gallery' | 'semicircle' | 'free' | 'carousel' | 'cascade';
export interface LayoutOptions { spacing?: number; orientation?: 'keep' | 'upright' | 'flat'; bounds?: ReadonlyMap<string, Box3> }

export const SCENE_LAYOUTS: ReadonlyArray<{ id: SceneLayout; label: string; description: string }> = [
  { id: 'gallery', label: 'Mural', description: 'Reúna várias lembranças e veja tudo de uma vez.' },
  { id: 'semicircle', label: 'Arco', description: 'Uma curva aberta, com espaço entre os momentos.' },
  { id: 'free', label: 'Composição livre', description: 'Uma composição leve, com alturas e posições variadas.' },
  { id: 'carousel', label: 'Roda de lembranças', description: 'Lembranças em círculo. Escolha um movimento para dar vida à roda.' },
  { id: 'cascade', label: 'Escadinha 3D', description: 'Fileiras em diferentes alturas para explorar a profundidade.' },
];

/** Medida conservadora antes da decodificação: o modelo cabe num cubo de lado 0,5. */
export function layoutExtent(item: SceneItem, rotation: [number, number, number], nativeBounds?: Box3): { radius: number; minZ: number } {
  const aspect = item.file.width && item.file.height ? item.file.height / item.file.width : 1;
  const width = 0.5;
  const height = item.type === 'model' ? 0.5 : width * aspect;
  const depth = item.type === 'model' ? 0.5 : 0;
  const radians = rotation.map((degree) => degree * Math.PI / 180) as [number, number, number];
  const euler = new Euler(...radians);
  const bounds = nativeBounds ?? new Box3(new Vector3(-width / 2, -height / 2, item.type === 'model' ? 0 : -depth / 2), new Vector3(width / 2, height / 2, item.type === 'model' ? depth : depth / 2));
  let minZ = 0;
  let radius = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const corner = new Vector3(x, y, z).applyEuler(euler);
    minZ = Math.min(minZ, corner.z);
    radius = Math.max(radius, corner.length());
  }
  return { radius: Math.max(radius, 0.001), minZ };
}

/** A distância entre vizinhos define o tamanho: retratos altos não invadem os outros. */
export function arrangeItems(items: readonly SceneItem[], layout: SceneLayout, targetAspect: number, options: LayoutOptions = {}): SceneItem[] {
  const visual = items.filter((item) => item.type !== 'audio' && item.visible);
  if (visual.length < 2) return items.map((item) => ({ ...item, transform: { ...item.transform } }));
  const aspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 0.75;
  const spacing = Math.min(1.15, Math.max(0.65, Number.isFinite(options.spacing) ? options.spacing! : 1));
  const positions = layoutPositions(layout, visual.length, aspect, spacing);
  const indices = new Map(visual.map((item, i) => [item.id, i]));
  return items.map((item) => {
    const index = indices.get(item.id);
    if (index === undefined) return { ...item, transform: { ...item.transform } };
    const [x, y, depth] = positions[index]!;
    const rotation: [number, number, number] = options.orientation === 'upright'
      ? [item.type === 'model' ? 0 : 90, 0, 0]
      : options.orientation === 'flat' ? [item.type === 'model' ? -90 : 0, 0, 0] : [item.transform.rotation[0], item.transform.rotation[1], 0];
    const bounds = layoutExtent(item, rotation, options.bounds?.get(item.id));
    const neighbor = Math.min(...positions.filter((_, i) => i !== index).map(([nx, ny]) => Math.hypot(nx - x, ny - y)));
    const availableRadius = Math.min(neighbor * 0.4, 0.5 - Math.abs(x), aspect / 2 - Math.abs(y));
    const scale = Math.max(0.001, Math.min(item.transform.scale, availableRadius / bounds.radius));
    return {
      ...item,
      transform: { ...item.transform, position: [x, y, depth - bounds.minZ * scale], rotation, scale, offset: [0, 0, 0] },
    };
  });
}

function layoutPositions(layout: SceneLayout, count: number, aspect: number, spacing: number): [number, number, number][] {
  const radiusX = 0.34 * spacing;
  const radiusY = aspect * 0.34 * spacing;
  if (layout === 'semicircle' || layout === 'carousel') return Array.from({ length: count }, (_, i) => {
    const angle = layout === 'carousel' ? -Math.PI / 2 + 2 * Math.PI * i / count : Math.PI * (0.1 + 0.8 * i / Math.max(1, count - 1));
    return [radiusX * Math.cos(angle), radiusY * Math.sin(angle) - (layout === 'semicircle' ? radiusY * 0.35 : 0), 0];
  });
  const columns = Math.max(1, Math.ceil(Math.sqrt(count / Math.max(0.25, aspect))));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const rowCount = Math.min(columns, count - row * columns);
    const x = rowCount <= 1 ? 0 : -radiusX + 2 * radiusX * col / (rowCount - 1);
    const y = rows <= 1 ? 0 : radiusY - 2 * radiusY * row / (rows - 1);
    const offset = layout === 'free' ? Math.sin(i * 2.4) * 0.018 : 0;
    const z = layout === 'cascade' ? (rows - row - 1) * 0.09 : layout === 'free' ? (i % 3) * 0.025 : 0;
    return [x + offset, y, z];
  });
}
