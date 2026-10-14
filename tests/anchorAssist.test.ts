import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AnchorAssist, type AnchorLike } from '../src/tracking/anchorAssist';
import type { GyroSource } from '../src/tracking/gyro';

const deg = (d: number): number => (d * Math.PI) / 180;
const yaw = (d: number): Quaternion => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(d));

/** Matriz "invisível" compartilhada, como a do MindAR. */
const INVISIBLE = new Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1);
const pose = (x = 0): Matrix4 => new Matrix4().compose(new Vector3(x, 0, -5), new Quaternion(), new Vector3(2, 2, 2));

function setup() {
  const anchor: AnchorLike = { visible: false, group: { matrix: INVISIBLE, visible: false } };
  const events: string[] = [];
  let now = 0;
  let pending = new Quaternion();
  let stopped = 0;
  const source: GyroSource = {
    takeRotation: () => {
      const q = pending;
      pending = new Quaternion();
      return q;
    },
    stop: () => {
      stopped += 1;
    },
  };
  const assist = new AnchorAssist(
    anchor,
    { found: () => events.push('found'), lost: () => events.push('lost'), suspended: () => events.push('suspended') },
    () => now,
  );

  /** O que o MindAR faz a cada leitura: matriz, visibilidade, callbacks found/lost e depois update. */
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
  return {
    anchor,
    assist,
    events,
    source,
    mindar,
    rotate: (q: Quaternion) => (pending = q),
    at: (ms: number) => (now = ms),
    get stopped() {
      return stopped;
    },
  };
}

describe('AnchorAssist sem giroscópio', () => {
  it('repassa achou e perdeu como o MindAR informa, sem duplicar', () => {
    const t = setup();
    t.mindar(pose());
    t.mindar(pose(0.1));
    t.mindar(null);
    t.mindar(null);
    t.mindar(pose());
    expect(t.events).toEqual(['found', 'lost', 'found']);
    expect(t.assist.active).toBe(false);
  });

  it('não mexe na matriz que o MindAR colocou', () => {
    const t = setup();
    const m = pose();
    t.mindar(m);
    expect(t.anchor.group.matrix).toBe(m);
  });
});

describe('AnchorAssist com giroscópio', () => {
  it('a primeira leitura semeia a pose; a matriz usada é uma cópia, nunca a compartilhada', () => {
    const t = setup();
    t.assist.enable(t.source);
    t.mindar(pose());
    expect(t.events).toEqual(['found']);
    expect(t.anchor.group.matrix).not.toBe(INVISIBLE);
    t.mindar(null);
    expect(INVISIBLE.elements[15]).toBe(1);
    expect(INVISIBLE.elements.slice(0, 15).every((v) => v === 0)).toBe(true);
  });

  it('a cada quadro, a pose gira com o giroscópio', () => {
    const t = setup();
    t.assist.enable(t.source);
    t.mindar(pose());
    t.rotate(yaw(10));
    t.assist.handleFrame();
    const position = new Vector3().setFromMatrixPosition(t.anchor.group.matrix);
    expect(position.x).toBeGreaterThan(0.5); // câmera olhou para a esquerda: alvo foi para a direita
    expect(t.anchor.group.visible).toBe(true);
  });

  it('ao perder, mantém a pose visível e só informa "perdeu" quando o tempo acaba', () => {
    const t = setup();
    t.assist.enable(t.source, { holdMs: 500 });
    t.at(0);
    t.mindar(pose());
    t.at(100);
    t.mindar(null);
    expect(t.events).toEqual(['found']);
    expect(t.anchor.group.visible).toBe(true);
    t.at(400);
    t.assist.handleFrame();
    expect(t.events).toEqual(['found']);
    expect(t.anchor.group.visible).toBe(true);

    t.at(700);
    t.assist.handleFrame();
    expect(t.events).toEqual(['found', 'lost']);
    expect(t.anchor.group.visible).toBe(false);
    t.at(900);
    t.assist.handleFrame();
    expect(t.events).toEqual(['found', 'lost']);
  });

  it('a tatuagem volta durante o prazo: não repete "achou" nem passa por "perdeu"', () => {
    const t = setup();
    t.assist.enable(t.source, { holdMs: 500 });
    t.at(0);
    t.mindar(pose());
    t.at(100);
    t.mindar(null);
    t.at(300);
    t.mindar(pose(0.05));
    t.at(2000);
    t.assist.handleFrame();
    expect(t.events).toEqual(['found']);
    expect(t.anchor.group.visible).toBe(true);
  });

  it('depois do fim do prazo, achar de novo informa "achou" outra vez', () => {
    const t = setup();
    t.assist.enable(t.source, { holdMs: 200 });
    t.at(0);
    t.mindar(pose());
    t.mindar(null);
    t.at(500);
    t.assist.handleFrame();
    t.mindar(pose());
    expect(t.events).toEqual(['found', 'lost', 'found']);
  });

  it('sem pose ainda (nada rastreado), a perda do MindAR é repassada na hora', () => {
    const t = setup();
    t.assist.enable(t.source);
    t.anchor.visible = true; // MindAR achou antes de ligarmos o giroscópio
    t.assist.handleFound();
    t.anchor.visible = false;
    t.assist.handleLost(); // sem pose no estabilizador: repassa
    expect(t.events).toEqual(['found', 'lost']);
  });

  it('desligar durante o "segurar" informa a perda e esconde; o sensor é parado', () => {
    const t = setup();
    t.assist.enable(t.source, { holdMs: 5000 });
    t.mindar(pose());
    t.mindar(null);
    expect(t.events).toEqual(['found']);
    t.assist.disable();
    expect(t.events).toEqual(['found', 'lost']);
    expect(t.anchor.group.visible).toBe(false);
    expect(t.stopped).toBe(1);
    expect(t.assist.active).toBe(false);
    t.assist.handleFrame(); // não faz mais nada
    expect(t.events).toEqual(['found', 'lost']);
  });

  it('desligar enquanto rastreia devolve o controle ao MindAR sem eventos extras', () => {
    const t = setup();
    t.assist.enable(t.source);
    t.mindar(pose());
    t.assist.disable();
    expect(t.events).toEqual(['found']);
    t.mindar(null);
    expect(t.events).toEqual(['found', 'lost']);
  });

  it('religar troca a fonte e para a anterior', () => {
    const t = setup();
    t.assist.enable(t.source);
    t.assist.enable({ takeRotation: () => new Quaternion(), stop: vi.fn() });
    expect(t.stopped).toBe(1);
  });

  it('giroscópio que discorda da câmera é suspenso, avisado uma vez, e a perda deixa de ser adiada', () => {
    const t = setup();
    t.assist.enable(t.source, { holdMs: 1000 });
    let x = 0;
    t.mindar(pose(x));
    for (let i = 1; i <= 16; i += 1) {
      // o giroscópio diz que a câmera girou 3° para um lado e a câmera confirma o lado oposto
      t.rotate(yaw(3));
      t.assist.handleFrame();
      const camera = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(-3 * i));
      t.at(i * 33);
      t.mindar(new Matrix4().compose(new Vector3(0, 0, -5).applyQuaternion(camera.clone().invert()), camera.clone().invert(), new Vector3(2, 2, 2)));
    }
    expect(t.assist.suspended).toBe(true);
    expect(t.events.filter((e) => e === 'suspended')).toEqual(['suspended']);
    t.mindar(null);
    expect(t.events).toContain('lost');
    expect(t.anchor.group.visible).toBe(false);
  });

  it('dispose solta o sensor sem informar perda', () => {
    const t = setup();
    t.assist.enable(t.source, { holdMs: 5000 });
    t.mindar(pose());
    t.mindar(null);
    t.assist.dispose();
    expect(t.events).toEqual(['found']);
    expect(t.stopped).toBe(1);
  });
});
