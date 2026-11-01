import { describe, expect, it } from 'vitest';
import { arrangeItems, layoutExtent, layoutSlots, SCENE_LAYOUTS, type SceneLayout } from '../src/scene/layouts';
import { defaultOptions, defaultTransform, type SceneItem } from '../src/storage/model';

function item(id: string, type: SceneItem['type'] = 'image'): SceneItem {
  return {
    id,
    type,
    name: id,
    visible: true,
    file: { fileName: `${id}.png`, mimeType: 'image/png', size: 10, sha256: '0'.repeat(64) },
    transform: { ...defaultTransform(), position: [0.1, 0.1, 0.2] },
    options: defaultOptions(type),
  };
}

describe('arrangeItems', () => {
  it.each<SceneLayout>(SCENE_LAYOUTS.map((layout) => layout.id))('%s keeps content and stays within the target', (layout) => {
    const input = [item('a'), item('b'), item('c'), item('d'), item('audio', 'audio')];
    const result = arrangeItems(input, layout, 0.75);
    expect(result.map((entry) => entry.id)).toEqual(input.map((entry) => entry.id));
    expect(result.map((entry) => entry.file)).toEqual(input.map((entry) => entry.file));
    expect(result[4]?.transform).toEqual(input[4]?.transform);
    for (const entry of result.slice(0, 4)) {
      expect(entry.transform.scale).toBeGreaterThan(0);
      expect(entry.transform.scale).toBeLessThanOrEqual(5);
      const radians = entry.transform.rotation[2] * Math.PI / 180;
      const halfW = 0.25 * entry.transform.scale;
      const halfH = entry.file.width && entry.file.height ? halfW * entry.file.height / entry.file.width : halfW;
      const extentX = halfW * Math.abs(Math.cos(radians)) + halfH * Math.abs(Math.sin(radians));
      const extentY = halfW * Math.abs(Math.sin(radians)) + halfH * Math.abs(Math.cos(radians));
      expect(Math.abs(entry.transform.position[0]) + extentX).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(entry.transform.position[1]) + extentY).toBeLessThanOrEqual(0.375 + 1e-9);
    }
  });

  it('deixa a cena intacta quando há menos de dois objetos visuais', () => {
    const only = item('one');
    expect(arrangeItems([only], 'gallery', 0.75)[0]).toEqual(only);
    expect(arrangeItems([item('audio', 'audio')], 'gallery', 0.75)[0]).toEqual(item('audio', 'audio'));
  });

  it.each([2, 8, 24, 100])('acomoda %i retratos, preserva ocultos e apoia os objetos em pé', (count) => {
    const input = Array.from({ length: count }, (_, i) => ({ ...item(String(i)), file: { ...item(String(i)).file, width: 100, height: i % 2 ? 500 : 100 } }));
    const hidden = { ...item('hidden'), visible: false };
    for (const layout of SCENE_LAYOUTS) {
      const arranged = arrangeItems([...input, hidden], layout.id, 0.6, { orientation: 'upright' });
      expect(arranged.at(-1)).toEqual(hidden);
      // Nas grades o item ocupa a célula retangular; nos demais, o círculo que vale para qualquer giro.
      const grid = layout.id === 'gallery' || layout.id === 'cascade';
      const half = (entry: SceneItem): [number, number] => {
        const bounds = layoutExtent(entry, entry.transform.rotation);
        return grid ? [bounds.halfX * entry.transform.scale, bounds.halfY * entry.transform.scale] : [bounds.radius * entry.transform.scale, bounds.radius * entry.transform.scale];
      };
      arranged.slice(0, count).forEach((entry, i) => {
        const bounds = layoutExtent(entry, entry.transform.rotation);
        const [hx, hy] = half(entry);
        expect(entry.transform.position[2] + bounds.minZ * entry.transform.scale).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.abs(entry.transform.position[0]) + hx).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(entry.transform.position[1]) + hy).toBeLessThanOrEqual(0.3 + 1e-9);
        if (layout.overlap) return;
        for (const other of arranged.slice(i + 1, count)) {
          const [ox, oy] = half(other);
          const dx = Math.abs(entry.transform.position[0] - other.transform.position[0]);
          const dy = Math.abs(entry.transform.position[1] - other.transform.position[1]);
          if (grid) expect(dx >= hx + ox - 1e-9 || dy >= hy + oy - 1e-9).toBe(true);
          else expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(hx + ox - 1e-9);
        }
      });
    }
  });

  it('usa profundidade na escadinha, sem alterar os arquivos de origem', () => {
    const input = Array.from({ length: 6 }, (_, i) => item(String(i)));
    const before = JSON.stringify(input);
    const result = arrangeItems(input, 'cascade', 0.75);
    expect(new Set(result.map((entry) => entry.transform.position[2])).size).toBeGreaterThan(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('no Mural, fotos deitadas usam células na mesma proporção e ficam maiores', () => {
    const landscape = Array.from({ length: 6 }, (_, i) => ({ ...item(String(i)), file: { ...item(String(i)).file, width: 400, height: 300 } }));
    const square = Array.from({ length: 6 }, (_, i) => item(String(i)));
    const area = (entries: SceneItem[]) => entries.reduce((sum, entry) => {
      const bounds = layoutExtent(entry, entry.transform.rotation);
      return sum + bounds.halfX * bounds.halfY * entry.transform.scale ** 2;
    }, 0);
    const wide = arrangeItems(landscape, 'gallery', 0.75);
    expect(area(wide)).toBeGreaterThan(area(arrangeItems(landscape, 'carousel', 0.75)));
    expect(area(arrangeItems(square, 'gallery', 0.75))).toBeGreaterThan(0);
  });

  it('o Mural usa o mesmo tamanho para todos e ocupa bem o alvo', () => {
    const result = arrangeItems(Array.from({ length: 6 }, (_, i) => item(String(i))), 'gallery', 0.75);
    expect(new Set(result.map((entry) => entry.transform.scale.toFixed(6))).size).toBe(1);
    const xs = result.map((entry) => entry.transform.position[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
  });

  it('o Destaque coloca o item escolhido no centro, maior que os outros', () => {
    const input = Array.from({ length: 5 }, (_, i) => item(String(i)));
    const result = arrangeItems(input, 'focus', 0.75, { focusId: '3' });
    const focus = result.find((entry) => entry.id === '3')!;
    expect(Math.hypot(focus.transform.position[0], focus.transform.position[1])).toBeLessThan(1e-9);
    for (const entry of result.filter((other) => other.id !== '3')) expect(focus.transform.scale).toBeGreaterThan(entry.transform.scale * 1.5);
    expect(result.map((entry) => entry.id)).toEqual(input.map((entry) => entry.id));
  });

  it('a Pilha sobrepõe em alturas diferentes, com a primeira por cima', () => {
    const result = arrangeItems(Array.from({ length: 4 }, (_, i) => item(String(i))), 'stack', 0.75);
    const heights = result.map((entry) => entry.transform.position[2]);
    expect(new Set(heights).size).toBe(4);
    expect(heights[0]).toBe(Math.max(...heights));
    expect(result.some((entry) => entry.transform.rotation[2] !== 0)).toBe(true);
  });

  it('o Coração e o Arco são simétricos e a Linha do tempo segue a ordem da lista', () => {
    for (const layout of ['heart', 'semicircle'] as const) {
      const slots = layoutSlots(layout, 7, 0.75);
      const xs = slots.map((slot) => slot.x).sort((a, b) => a - b);
      xs.forEach((x, i) => expect(x).toBeCloseTo(-xs[xs.length - 1 - i]!, 6));
    }
    const timeline = layoutSlots('timeline', 5, 0.75).map((slot) => slot.x);
    expect([...timeline].sort((a, b) => a - b)).toEqual(timeline);
  });

  it('a Espiral deixa o centro mais alto e a mesma entrada dá sempre o mesmo resultado', () => {
    const slots = layoutSlots('spiral', 12, 1);
    expect(slots[0]!.z).toBeGreaterThan(slots.at(-1)!.z);
    expect(layoutSlots('free', 9, 0.75)).toEqual(layoutSlots('free', 9, 0.75));
  });
});
