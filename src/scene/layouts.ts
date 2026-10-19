import type { SceneItem } from '../storage/model';
import { clampPositionToTarget } from './picking';

export type SceneLayout = 'gallery' | 'semicircle' | 'free' | 'carousel';

export const SCENE_LAYOUTS: ReadonlyArray<{ id: SceneLayout; label: string; description: string }> = [
  { id: 'gallery', label: 'Mural', description: 'Reúna várias lembranças e veja tudo de uma vez.' },
  { id: 'semicircle', label: 'Arco', description: 'Distribua as lembranças ao redor do centro.' },
  { id: 'free', label: 'Composição livre', description: 'Uma disposição leve, com pequenas variações.' },
  { id: 'carousel', label: 'Roda de lembranças', description: 'Reúna suas lembranças em círculo; a apresentação é iniciada separadamente.' },
];

/** Reorganiza apenas as posições dos itens visuais; arquivos e opções permanecem intactos. */
export function arrangeItems(items: readonly SceneItem[], layout: SceneLayout, targetAspect: number): SceneItem[] {
  const visual = items.filter((item) => item.type !== 'audio');
  if (visual.length < 2) return items.map((item) => ({ ...item, transform: { ...item.transform } }));
  const aspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 0.75;
  const capacityScale = Math.max(0.12, Math.min(0.48, 0.92 / Math.sqrt(visual.length)));
  const positions = layoutPositions(layout, visual.length, aspect);
  let index = 0;
  return items.map((item) => {
    if (item.type === 'audio') return { ...item, transform: { ...item.transform } };
    const [x, y, rotation] = positions[index++]!;
    const itemScale = Math.min(item.transform.scale, capacityScale);
    const imageAspect = item.file.width && item.file.height ? item.file.height / item.file.width : 1;
    const angle = (rotation * Math.PI) / 180;
    const halfWidth = 0.25 * itemScale;
    const halfHeight = halfWidth * imageAspect;
    const boundsX = halfWidth * Math.abs(Math.cos(angle)) + halfHeight * Math.abs(Math.sin(angle));
    const boundsY = halfWidth * Math.abs(Math.sin(angle)) + halfHeight * Math.abs(Math.cos(angle));
    const [safeX, safeY] = clampPositionToTarget(x, y, boundsX, boundsY, aspect);
    return {
      ...item,
      transform: {
        ...item.transform,
        position: [safeX, safeY, Math.max(0, item.transform.position[2])],
        rotation: [item.transform.rotation[0], item.transform.rotation[1], rotation],
        scale: itemScale,
      },
    };
  });
}

type Pose = [number, number, number];

function layoutPositions(layout: SceneLayout, count: number, aspect: number): Pose[] {
  if (layout === 'semicircle') {
    const radiusX = 0.4;
    const radiusY = Math.min(aspect * 0.38, 0.42);
    return Array.from({ length: count }, (_, i) => {
      const angle = Math.PI * (0.12 + (0.76 * i) / Math.max(1, count - 1));
      return [radiusX * Math.cos(angle), radiusY * Math.sin(angle) - radiusY * 0.35, (0.5 - i / Math.max(1, count - 1)) * 18];
    });
  }
  if (layout === 'carousel') {
    const radiusX = Math.min(0.38, 0.7 / Math.sqrt(count));
    const radiusY = Math.min(aspect * 0.38, 0.7 / Math.sqrt(count));
    return Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
      return [radiusX * Math.cos(angle), radiusY * Math.sin(angle), (90 - (360 * i) / count) % 360];
    });
  }
  const columns = layout === 'free' ? Math.ceil(Math.sqrt(count)) : Math.max(1, Math.ceil(Math.sqrt(count / Math.max(0.5, aspect))));
  const rows = Math.ceil(count / columns);
  const width = Math.min(0.82, columns * 0.22);
  const height = Math.min(aspect * 0.82, rows * 0.2);
  return Array.from({ length: count }, (_, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const rowCount = Math.min(columns, count - row * columns);
    const x = rowCount <= 1 ? 0 : -width / 2 + (width * col) / (rowCount - 1);
    const y = rows <= 1 ? 0 : height / 2 - (height * row) / (rows - 1);
    const offset = layout === 'free' ? (row % 2 ? 0.035 : -0.035) : 0;
    return [x + offset, y, 0];
  });
}
