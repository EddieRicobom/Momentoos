import { defaultTransform, type ItemOptions, type ItemTransform, type ItemType, type SceneItem } from '../storage/model';
import type { ItemPatch } from '../storage/scene';

/**
 * Regras puras do editor da cena: quais controles cada tipo de item tem, como
 * um valor entra no item (com limite) e o que mudou desde o último salvamento.
 */

export type ControlGroup = 'position' | 'rotation' | 'size' | 'offset' | 'media';

export interface Control {
  id: string;
  label: string;
  group: ControlGroup;
  min: number;
  max: number;
  step: number;
  unit: string;
  read(item: SceneItem): number;
  write(item: SceneItem, value: number): SceneItem;
  /** Tipos de item em que o controle faz sentido (omitido = todos os visuais). */
  types?: readonly ItemType[];
}

const VISUAL: readonly ItemType[] = ['image', 'gif', 'video', 'model'];

const vec = (
  key: 'position' | 'rotation' | 'offset',
  index: 0 | 1 | 2,
): Pick<Control, 'read' | 'write'> => ({
  read: (item) => item.transform[key][index],
  write: (item, value) => {
    const next = [...item.transform[key]] as [number, number, number];
    next[index] = value;
    return { ...item, transform: { ...item.transform, [key]: next } };
  },
});

const option = (key: 'opacity' | 'volume'): Pick<Control, 'read' | 'write'> => ({
  read: (item) => item.options[key],
  write: (item, value) => ({ ...item, options: { ...item.options, [key]: value } }),
});

export const CONTROLS: readonly Control[] = [
  { id: 'pos-x', label: 'Posição horizontal', group: 'position', min: -1, max: 1, step: 0.005, unit: 'larg.', ...vec('position', 0), types: VISUAL },
  { id: 'pos-y', label: 'Posição vertical', group: 'position', min: -1, max: 1, step: 0.005, unit: 'larg.', ...vec('position', 1), types: VISUAL },
  { id: 'pos-z', label: 'Altura sobre a pele', group: 'position', min: -0.5, max: 1, step: 0.005, unit: 'larg.', ...vec('position', 2), types: VISUAL },
  { id: 'rot-z', label: 'Giro (no plano do item)', group: 'rotation', min: -180, max: 180, step: 1, unit: '°', ...vec('rotation', 2), types: VISUAL },
  { id: 'rot-x', label: 'Inclinação em X', group: 'rotation', min: -180, max: 180, step: 1, unit: '°', ...vec('rotation', 0), types: VISUAL },
  { id: 'rot-y', label: 'Inclinação em Y', group: 'rotation', min: -180, max: 180, step: 1, unit: '°', ...vec('rotation', 1), types: VISUAL },
  {
    id: 'scale',
    label: 'Tamanho',
    group: 'size',
    min: 0.05,
    max: 5,
    step: 0.01,
    unit: '×',
    types: VISUAL,
    read: (item) => item.transform.scale,
    write: (item, value) => ({ ...item, transform: { ...item.transform, scale: value } }),
  },
  { id: 'off-x', label: 'Deslocamento em X do item', group: 'offset', min: -0.5, max: 0.5, step: 0.005, unit: 'larg.', ...vec('offset', 0), types: VISUAL },
  { id: 'off-y', label: 'Deslocamento em Y do item', group: 'offset', min: -0.5, max: 0.5, step: 0.005, unit: 'larg.', ...vec('offset', 1), types: VISUAL },
  { id: 'off-z', label: 'Deslocamento em Z do item', group: 'offset', min: -0.5, max: 0.5, step: 0.005, unit: 'larg.', ...vec('offset', 2), types: VISUAL },
  { id: 'opacity', label: 'Opacidade', group: 'media', min: 0, max: 1, step: 0.01, unit: '', ...option('opacity'), types: VISUAL },
  { id: 'volume', label: 'Volume', group: 'media', min: 0, max: 1, step: 0.01, unit: '', ...option('volume'), types: ['video', 'audio'] },
];

export function controlsFor(type: ItemType): Control[] {
  return CONTROLS.filter((control) => (control.types ?? VISUAL).includes(type));
}

export const clampValue = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

/** Grava o valor (preso aos limites do controle e arredondado ao passo). */
export function applyControl(item: SceneItem, control: Control, value: number): SceneItem {
  const clamped = clampValue(value, control.min, control.max);
  const decimals = Math.max(0, Math.ceil(-Math.log10(control.step)));
  return control.write(item, Number(clamped.toFixed(decimals)));
}

/** Move o item no plano da pele (arrasto na prévia), preso aos limites dos controles. */
export function moveItem(item: SceneItem, x: number, y: number): SceneItem {
  const px = CONTROLS.find((c) => c.id === 'pos-x')!;
  const py = CONTROLS.find((c) => c.id === 'pos-y')!;
  return applyControl(applyControl(item, px, x), py, y);
}

export function resetTransform(item: SceneItem): SceneItem {
  return { ...item, transform: defaultTransform() };
}

export function formatValue(control: Control, value: number): string {
  const decimals = Math.max(0, Math.ceil(-Math.log10(control.step)));
  const text = value.toFixed(Math.min(decimals, 2)).replace('.', ',');
  return control.unit ? `${text} ${control.unit}` : text;
}

// ------------------------------------------------------------------ alterações

const sameTransform = (a: ItemTransform, b: ItemTransform): boolean =>
  a.scale === b.scale &&
  [0, 1, 2].every((i) => a.rotation[i] === b.rotation[i] && a.position[i] === b.position[i] && a.offset[i] === b.offset[i]);

const sameOptions = (a: ItemOptions, b: ItemOptions): boolean =>
  a.opacity === b.opacity && a.loop === b.loop && a.muted === b.muted && a.volume === b.volume && a.animate === b.animate && a.clip === b.clip;

/** O que mudou em cada item do rascunho em relação ao que está salvo. */
export function diffItems(saved: readonly SceneItem[], draft: readonly SceneItem[]): Map<string, ItemPatch> {
  const byId = new Map(saved.map((item) => [item.id, item]));
  const patches = new Map<string, ItemPatch>();
  for (const item of draft) {
    const before = byId.get(item.id);
    if (!before) continue;
    const patch: ItemPatch = {};
    if (item.name !== before.name) patch.name = item.name;
    if (item.visible !== before.visible) patch.visible = item.visible;
    if (!sameTransform(item.transform, before.transform)) patch.transform = item.transform;
    if (!sameOptions(item.options, before.options)) patch.options = item.options;
    if (Object.keys(patch).length > 0) patches.set(item.id, patch);
  }
  return patches;
}

export const isDirty = (saved: readonly SceneItem[], draft: readonly SceneItem[]): boolean =>
  diffItems(saved, draft).size > 0;

export const cloneItems = (items: readonly SceneItem[]): SceneItem[] =>
  items.map((item) => ({
    ...item,
    file: { ...item.file },
    transform: {
      scale: item.transform.scale,
      rotation: [...item.transform.rotation],
      position: [...item.transform.position],
      offset: [...item.transform.offset],
    },
    options: { ...item.options },
  }));

export const TYPE_LABEL: Record<ItemType, string> = {
  image: 'Imagem',
  gif: 'GIF',
  video: 'Vídeo',
  model: 'Modelo 3D',
  audio: 'Áudio',
  carousel: 'Carrossel',
};
