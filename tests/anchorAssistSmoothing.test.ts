import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AnchorAssist, type AnchorLike } from '../src/tracking/anchorAssist';

const INVISIBLE = new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1);
const pose = (x: number): Matrix4 => new Matrix4().compose(new Vector3(x, 0, -1000), new Quaternion(), new Vector3(600, 600, 600));

function setup(graceMs = 450) {
  const anchor: AnchorLike = { visible: false, group: { matrix: INVISIBLE, visible: false } };
  const events: string[] = [];
  let now = 0;
  const assist = new AnchorAssist(
    anchor,
    { found: () => events.push('found'), lost: () => events.push('lost') },
    () => now,
    { smoothing: { aspect: 0.75 }, graceMs },
  );
  /** O que o MindAR faz a cada leitura (matriz, visibilidade, found/lost e depois update). */
  const mindar = (matrix: Matrix4 | null): void => {
    const wasVisible = anchor.visible;
    anchor.group.visible = matrix !== null;
    anchor.group.matrix = matrix ?? INVISIBLE;
    if (wasVisible && matrix === null) {
      anchor.visible = false;
      assist.handleLost();
    }
    if (!wasVisible && matrix !== null) {
      anchor.visible = true;
      assist.handleFound();
    }
    assist.handleUpdate();
  };
  return { anchor, assist, events, mindar, at: (ms: number) => (now = ms) };
}

describe('AnchorAssist sem giroscópio: suavização e graça', () => {
  it('suaviza o tremor da pose do rastreador', () => {
    const t = setup();
    const xs: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      t.at(i * 33);
      t.mindar(pose(i % 2 === 0 ? 2 : -2)); // vai e volta ±2 px
      xs.push(t.anchor.group.matrix.elements[12]!);
    }
    const tail = xs.slice(20);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(1.2); // bruto: 4 px
  });

  it('a matriz entregue é sempre uma instância nova', () => {
    const t = setup();
    t.mindar(pose(0));
    const first = t.anchor.group.matrix;
    t.at(33);
    t.mindar(pose(1));
    expect(t.anchor.group.matrix).not.toBe(first);
    expect(t.anchor.group.matrix).not.toBe(INVISIBLE);
  });

  it('segura a última pose durante a graça e só então informa a perda', () => {
    const t = setup(450);
    t.at(0);
    t.mindar(pose(100));
    t.at(33);
    t.mindar(pose(100));
    t.at(100);
    t.mindar(null); // MindAR desistiu
    expect(t.events).toEqual(['found']);
    expect(t.anchor.group.visible).toBe(true);
    expect(t.anchor.group.matrix.elements[12]).toBeCloseTo(100, 3);

    t.at(400);
    t.assist.handleFrame();
    expect(t.events).toEqual(['found']);

    t.at(600); // 500 ms depois da perda
    t.assist.handleFrame();
    expect(t.events).toEqual(['found', 'lost']);
    expect(t.anchor.group.visible).toBe(false);
  });

  it('se o rastreador volta durante a graça, nada é informado (sem piscar)', () => {
    const t = setup(450);
    t.at(0);
    t.mindar(pose(100));
    t.at(100);
    t.mindar(null);
    t.at(250);
    t.mindar(pose(104));
    t.at(900);
    t.assist.handleFrame();
    expect(t.events).toEqual(['found']);
    expect(t.anchor.group.visible).toBe(true);
  });

  it('sem graça configurada, a perda é informada na hora (comportamento antigo)', () => {
    const t = setup(0);
    t.at(0);
    t.mindar(pose(100));
    t.at(50);
    t.mindar(null);
    expect(t.events).toEqual(['found', 'lost']);
  });
});
