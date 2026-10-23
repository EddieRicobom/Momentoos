import { describe, expect, it } from 'vitest';
import { arrangeItems, layoutExtent, SCENE_LAYOUTS, type SceneLayout } from '../src/scene/layouts';
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
  it.each<SceneLayout>(['gallery', 'semicircle', 'free', 'carousel'])('%s keeps content and stays within the target', (layout) => {
    const input = [item('a'), item('b'), item('c'), item('d'), item('audio', 'audio')];
    const result = arrangeItems(input, layout, 0.75);
    expect(result.map((entry) => entry.id)).toEqual(input.map((entry) => entry.id));
    expect(result.map((entry) => entry.file)).toEqual(input.map((entry) => entry.file));
    expect(result[4]?.transform).toEqual(input[4]?.transform);
    for (const entry of result.slice(0, 4)) {
      expect(entry.transform.scale).toBeLessThanOrEqual(input[0]!.transform.scale);
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
      arranged.slice(0, count).forEach((entry, i) => {
        const bounds = layoutExtent(entry, entry.transform.rotation);
        expect(entry.transform.position[2] + bounds.minZ * entry.transform.scale).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.abs(entry.transform.position[0]) + bounds.radius * entry.transform.scale).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(entry.transform.position[1]) + bounds.radius * entry.transform.scale).toBeLessThanOrEqual(0.3 + 1e-9);
        for (const other of arranged.slice(i + 1, count)) {
          const distance = Math.hypot(entry.transform.position[0] - other.transform.position[0], entry.transform.position[1] - other.transform.position[1]);
          const radius = layoutExtent(other, other.transform.rotation).radius * other.transform.scale;
          expect(distance).toBeGreaterThanOrEqual(bounds.radius * entry.transform.scale + radius - 1e-9);
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
});
