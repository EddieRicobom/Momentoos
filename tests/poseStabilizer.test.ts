import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STABILIZER, PoseStabilizer } from '../src/tracking/poseStabilizer';

const deg = (d: number): number => (d * Math.PI) / 180;
const axisAngle = (x: number, y: number, z: number, degrees: number): Quaternion =>
  new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), deg(degrees));

/** Pose do alvo no quadro da câmera, como o MindAR entrega (posição, orientação, escala = largura). */
const pose = (position: Vector3, quaternion: Quaternion, scale = 2): Matrix4 =>
  new Matrix4().compose(position, quaternion, new Vector3(scale, scale, scale));

const parts = (matrix: Matrix4) => {
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  return { position, quaternion, scale };
};

/** Mundo fixo + câmera que gira: a pose "verdadeira" no quadro da câmera depois de acumular C. */
function truth(start: Matrix4, camera: Quaternion): Matrix4 {
  const { position, quaternion, scale } = parts(start);
  const inverse = camera.clone().invert();
  return pose(position.clone().applyQuaternion(inverse), inverse.clone().multiply(quaternion), scale.x);
}

const START = (): Matrix4 => pose(new Vector3(0.4, -0.2, -6), axisAngle(0.3, 1, 0.2, 25));

const closeTo = (a: Matrix4, b: Matrix4, tolerance = 1e-5): void => {
  for (let i = 0; i < 16; i += 1) expect(a.elements[i]!).toBeCloseTo(b.elements[i]!, -Math.log10(tolerance));
};

describe('PoseStabilizer: previsão pelo giroscópio', () => {
  it('a primeira medida passa sem alteração', () => {
    const s = new PoseStabilizer();
    const out = s.measure(START(), 0);
    closeTo(out.matrix!, START());
    expect(out).toMatchObject({ held: false, expired: false });
    expect(s.hasPose).toBe(true);
  });

  it('sem pose, rotate e frame não fazem nada', () => {
    const s = new PoseStabilizer();
    s.rotate(axisAngle(0, 1, 0, 10));
    expect(s.frame(0)).toEqual({ matrix: null, held: false, expired: false });
  });

  it.each([
    ['em torno de y (panorâmica)', [0, 1, 0]],
    ['em torno de x (inclinar)', [1, 0, 0]],
    ['em torno de z (girar o aparelho)', [0, 0, 1]],
    ['eixo qualquer', [0.3, -0.5, 0.8]],
  ] as const)('a pose girada pelos passos do giroscópio bate com a pose verdadeira (%s)', (_label, axis) => {
    const s = new PoseStabilizer();
    s.measure(START(), 0);
    let camera = new Quaternion();
    for (let i = 0; i < 40; i += 1) {
      const step = axisAngle(axis[0], axis[1], axis[2], 0.75);
      camera = camera.clone().multiply(step);
      s.rotate(step);
    }
    closeTo(s.frame(1000).matrix!, truth(START(), camera));
  });

  it('girar a câmera para a esquerda faz o alvo andar para a direita na imagem', () => {
    const s = new PoseStabilizer();
    s.measure(pose(new Vector3(0, 0, -5), new Quaternion()), 0);
    s.rotate(axisAngle(0, 1, 0, 10)); // gira anti-horário visto de cima = olha para a esquerda
    expect(parts(s.frame(1).matrix!).position.x).toBeGreaterThan(0.5);
  });

  it('a escala não muda com a rotação', () => {
    const s = new PoseStabilizer();
    s.measure(pose(new Vector3(0, 0, -5), new Quaternion(), 3), 0);
    s.rotate(axisAngle(1, 1, 0, 20));
    expect(parts(s.frame(1).matrix!).scale.x).toBeCloseTo(3);
  });
});

describe('PoseStabilizer: mistura com a medida do rastreador', () => {
  it('previsão e medida próximas: o resultado fica entre as duas, pelo peso configurado', () => {
    const s = new PoseStabilizer({ blend: 0.5 });
    s.measure(pose(new Vector3(0, 0, -5), new Quaternion()), 0);
    // sem giro; a medida seguinte difere um pouco da pose atual
    const out = s.measure(pose(new Vector3(0.1, 0, -5), new Quaternion()), 33);
    expect(parts(out.matrix!).position.x).toBeCloseTo(0.05);
  });

  it('peso padrão 0,6 e blend 1 ignora a previsão', () => {
    expect(DEFAULT_STABILIZER.blend).toBe(0.6);
    const s = new PoseStabilizer({ blend: 1 });
    s.measure(pose(new Vector3(0, 0, -5), new Quaternion()), 0);
    const out = s.measure(pose(new Vector3(0.1, 0, -5), new Quaternion()), 33);
    expect(parts(out.matrix!).position.x).toBeCloseTo(0.1);
  });

  it('diferença grande de ângulo: vale só a medida', () => {
    const s = new PoseStabilizer({ blend: 0.2, maxAngleDeg: 8 });
    s.measure(pose(new Vector3(0, 0, -5), new Quaternion()), 0);
    const measured = pose(new Vector3(0, 0, -5), axisAngle(0, 0, 1, 20));
    closeTo(s.measure(measured, 33).matrix!, measured);
  });

  it('diferença pequena de ângulo (abaixo do limite) ainda é suavizada', () => {
    const s = new PoseStabilizer({ blend: 0.2, maxAngleDeg: 8 });
    s.measure(pose(new Vector3(0, 0, -5), new Quaternion()), 0);
    const out = s.measure(pose(new Vector3(0, 0, -5), axisAngle(0, 0, 1, 5)), 33);
    expect(parts(out.matrix!).quaternion.angleTo(new Quaternion())).toBeCloseTo(deg(1), 2);
  });

  it('diferença grande de posição (em larguras do alvo): vale só a medida', () => {
    const s = new PoseStabilizer({ blend: 0.2, maxShift: 0.25 });
    s.measure(pose(new Vector3(0, 0, -5), new Quaternion(), 2), 0);
    const measured = pose(new Vector3(1, 0, -5), new Quaternion(), 2); // 0,5 largura de deslocamento
    closeTo(s.measure(measured, 33).matrix!, measured);
    const s2 = new PoseStabilizer({ blend: 0.2, maxShift: 0.25 });
    s2.measure(pose(new Vector3(0, 0, -5), new Quaternion(), 2), 0);
    const small = s2.measure(pose(new Vector3(0.4, 0, -5), new Quaternion(), 2), 33); // 0,2 largura
    expect(parts(small.matrix!).position.x).toBeCloseTo(0.08);
  });

  it('suaviza o tremor de um alvo parado e não atrasa um alvo que se move junto com o giro', () => {
    // ruído pseudoaleatório determinístico (LCG), aproximadamente branco
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296 - 0.5;
    };
    const table = Array.from({ length: 300 }, random);
    const noise = (i: number): number => table[i]!;
    const staticPose = (i: number): Matrix4 => pose(new Vector3(noise(i) * 0.2, noise(i + 100) * 0.2, -5), new Quaternion());
    const stabilized = new PoseStabilizer();
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 60; i += 1) {
      const m = staticPose(i);
      raw.push(parts(m).position.x);
      out.push(parts(stabilized.measure(m, i * 33).matrix!).position.x);
    }
    const std = (values: number[]): number => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    };
    expect(std(out.slice(10))).toBeLessThan(std(raw.slice(10)) * 0.85);

    // panorâmica constante: a medida acompanha a rotação; o resultado não pode ficar para trás da medida
    const moving = new PoseStabilizer();
    let camera = new Quaternion();
    moving.measure(START(), 0);
    let worst = 0;
    for (let i = 1; i <= 60; i += 1) {
      const step = axisAngle(0, 1, 0, 0.5);
      camera = camera.clone().multiply(step);
      moving.rotate(step);
      const result = moving.measure(truth(START(), camera), i * 33);
      worst = Math.max(worst, parts(result.matrix!).quaternion.angleTo(parts(truth(START(), camera)).quaternion));
    }
    expect(worst).toBeLessThan(deg(0.01));
  });
});

describe('PoseStabilizer: perda da tatuagem', () => {
  it('segura a pose girando com o giroscópio e informa o fim do tempo uma vez', () => {
    const s = new PoseStabilizer({ holdMs: 500 });
    s.measure(START(), 0);
    let camera = new Quaternion();
    const lost = s.measure(null, 100);
    expect(lost).toMatchObject({ held: true, expired: false });
    expect(s.holding).toBe(true);

    const step = axisAngle(0, 1, 0, 1);
    camera = camera.clone().multiply(step);
    s.rotate(step);
    const during = s.frame(300);
    expect(during.held).toBe(true);
    closeTo(during.matrix!, truth(START(), camera));

    expect(s.frame(599)).toMatchObject({ held: true, expired: false });
    expect(s.frame(600)).toEqual({ matrix: null, held: false, expired: true });
    expect(s.frame(700)).toEqual({ matrix: null, held: false, expired: false });
    expect(s.hasPose).toBe(false);
  });

  it('perdas repetidas durante o "segurar" não renovam o prazo', () => {
    const s = new PoseStabilizer({ holdMs: 500 });
    s.measure(START(), 0);
    s.measure(null, 100);
    s.measure(null, 400);
    expect(s.measure(null, 650)).toEqual({ matrix: null, held: false, expired: true });
  });

  it('a tatuagem volta durante o prazo: segue rastreando, misturando com a pose segurada', () => {
    const s = new PoseStabilizer({ holdMs: 500, blend: 1 });
    s.measure(START(), 0);
    s.measure(null, 100);
    const back = pose(new Vector3(0.45, -0.2, -6), axisAngle(0.3, 1, 0.2, 25));
    const out = s.measure(back, 300);
    expect(out).toMatchObject({ held: false, expired: false });
    closeTo(out.matrix!, back);
    expect(s.holding).toBe(false);
    expect(s.frame(900).matrix).not.toBeNull(); // o prazo antigo não vale mais
  });

  it('sem tempo de espera (holdMs 0), a perda é imediata', () => {
    const s = new PoseStabilizer({ holdMs: 0 });
    s.measure(START(), 0);
    expect(s.measure(null, 50)).toEqual({ matrix: null, held: false, expired: true });
    expect(s.hasPose).toBe(false);
  });

  it('perda sem pose anterior não faz nada; depois do fim, a próxima medida começa limpa', () => {
    const s = new PoseStabilizer({ holdMs: 100 });
    expect(s.measure(null, 0)).toEqual({ matrix: null, held: false, expired: false });
    s.measure(START(), 10);
    s.measure(null, 20);
    s.frame(200);
    const fresh = pose(new Vector3(1, 1, -4), new Quaternion());
    closeTo(s.measure(fresh, 300).matrix!, fresh);
  });

  it('reset esquece tudo', () => {
    const s = new PoseStabilizer();
    s.measure(START(), 0);
    s.reset();
    expect(s.hasPose).toBe(false);
    expect(s.frame(1).matrix).toBeNull();
  });
});

describe('PoseStabilizer: giroscópio que discorda da câmera', () => {
  const run = (sign: 1 | -1, updates: number) => {
    const s = new PoseStabilizer({ blend: 0.6 });
    let camera = new Quaternion();
    s.measure(START(), 0);
    for (let i = 1; i <= updates; i += 1) {
      const real = axisAngle(0.2, 1, 0.1, 3); // 3° por atualização: movimento claro
      camera = camera.clone().multiply(real);
      s.rotate(sign === 1 ? real : real.clone().invert());
      s.measure(truth(START(), camera), i * 33);
    }
    return { s, camera };
  };

  it('giroscópio coerente nunca suspende, mesmo com movimento por muito tempo', () => {
    expect(run(1, 120).s.suspended).toBe(false);
  });

  it('giroscópio com sinal invertido é suspenso depois de poucas atualizações', () => {
    expect(run(-1, 8).s.suspended).toBe(false); // ainda sem amostras suficientes
    expect(run(-1, 14).s.suspended).toBe(true);
  });

  it('suspenso, repassa as poses do rastreador sem alterar e ignora rotate/hold', () => {
    const { s, camera } = run(-1, 20);
    expect(s.suspended).toBe(true);
    s.rotate(axisAngle(0, 1, 0, 30));
    const next = truth(START(), camera.clone().multiply(axisAngle(0, 1, 0, 2)));
    closeTo(s.measure(next, 1000).matrix!, next);
    expect(s.measure(null, 1100)).toEqual({ matrix: null, held: false, expired: true });
  });

  it('giroscópio que erra de vez em quando (1 em cada 3 atualizações) continua valendo', () => {
    const s = new PoseStabilizer();
    let camera = new Quaternion();
    s.measure(START(), 0);
    for (let i = 1; i <= 90; i += 1) {
      const real = axisAngle(0.2, 1, 0.1, 3);
      camera = camera.clone().multiply(real);
      s.rotate(i % 3 === 0 ? real.clone().invert() : real);
      s.measure(truth(START(), camera), i * 33);
    }
    expect(s.suspended).toBe(false);
  });

  it('suspenso, o quadro seguinte não gira mais com o giroscópio', () => {
    const { s, camera } = run(-1, 20);
    expect(s.suspended).toBe(true);
    const last = truth(START(), camera);
    s.measure(last, 5000);
    s.rotate(axisAngle(0, 1, 0, 30));
    closeTo(s.frame(5001).matrix!, last);
  });

  it('a escala acompanha sempre a medida', () => {
    const s = new PoseStabilizer({ blend: 0.5 });
    s.measure(pose(new Vector3(0, 0, -5), new Quaternion(), 2), 0);
    const out = s.measure(pose(new Vector3(0, 0, -5), new Quaternion(), 2.4), 33);
    expect(parts(out.matrix!).scale.x).toBeCloseTo(2.4);
  });

  it('movimento pequeno (abaixo de 1,5° por atualização) não entra na decisão', () => {
    const s = new PoseStabilizer();
    s.measure(START(), 0);
    let camera = new Quaternion();
    for (let i = 1; i <= 60; i += 1) {
      const real = axisAngle(0, 1, 0, 0.5);
      camera = camera.clone().multiply(real);
      s.rotate(real.clone().invert()); // totalmente errado, mas minúsculo
      s.measure(truth(START(), camera), i * 33);
    }
    expect(s.suspended).toBe(false);
  });

  it('a comparação reinicia depois de perder a tatuagem', () => {
    const s = new PoseStabilizer({ holdMs: 100 });
    let camera = new Quaternion();
    s.measure(START(), 0);
    for (let i = 1; i <= 8; i += 1) {
      const real = axisAngle(0.2, 1, 0.1, 3);
      camera = camera.clone().multiply(real);
      s.rotate(real.clone().invert());
      s.measure(truth(START(), camera), i * 33);
    }
    s.measure(null, 400);
    s.frame(900); // expira
    s.measure(truth(START(), camera), 1000);
    for (let i = 1; i <= 5; i += 1) {
      const real = axisAngle(0.2, 1, 0.1, 3);
      camera = camera.clone().multiply(real);
      s.rotate(real.clone().invert());
      s.measure(truth(START(), camera), 1000 + i * 33);
    }
    expect(s.suspended).toBe(false); // 8 + 5 amostras não se somam: a janela recomeçou
  });
});
