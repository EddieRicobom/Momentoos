// Grade de condições do laboratório. Cada caso: [grupo, rótulo, geometria, luz].
export const DESIGNS = [
  { design: 'mandala', seed: 11 },
  { design: 'blackwork', seed: 22 },
  { design: 'script', seed: 33 },
  { design: 'fine', seed: 44 },
];

const G = (o) => o;
export const CASES = [
  ['base', 'de frente', G({}), {}],

  ['escala', 'longe (150px)', G({ widthPx: 150 }), {}],
  ['escala', 'longe (200px)', G({ widthPx: 200 }), {}],
  ['escala', 'perto (450px)', G({ widthPx: 450 }), {}],
  ['escala', 'muito perto (700px)', G({ widthPx: 700 }), {}],

  ['giro', 'giro 45°', G({ rotZ: 45 }), {}],
  ['giro', 'giro 180°', G({ rotZ: 180 }), {}],

  ['ângulo', 'inclinada 25°', G({ tilt: 25 }), {}],
  ['ângulo', 'inclinada 40°', G({ tilt: 40 }), {}],
  ['ângulo', 'inclinada 55°', G({ tilt: 55 }), {}],
  ['ângulo', 'inclinada 65°', G({ tilt: 65 }), {}],
  ['ângulo', 'inclinada 75°', G({ tilt: 75 }), {}],
  ['ângulo', 'incl. 55° eixo 60°', G({ tilt: 55, tiltAxis: 60 }), {}],

  ['esticada', 'esticada x1.3', G({ stretchX: 1.3 }), {}],
  ['esticada', 'esticada x1.6', G({ stretchX: 1.6 }), {}],
  ['esticada', 'esticada x2.0', G({ stretchX: 2.0 }), {}],
  ['esticada', 'esticada x2.6', G({ stretchX: 2.6 }), {}],

  ['achatada', 'achatada x0.75', G({ stretchX: 0.75 }), {}],
  ['achatada', 'achatada x0.6', G({ stretchX: 0.6 }), {}],
  ['achatada', 'achatada x0.45', G({ stretchX: 0.45 }), {}],
  ['achatada', 'achatada x0.33', G({ stretchX: 0.33 }), {}],
  ['achatada', 'achatada y0.5 + giro 30°', G({ stretchY: 0.5, rotZ: 30 }), {}],

  ['luz', 'escura (ganho 0.55)', G({}), { gain: 0.55 }],
  ['luz', 'muito escura (0.3)', G({}), { gain: 0.3 }],
  ['luz', 'estourada (ganho 1.7)', G({}), { gain: 1.7 }],
  ['luz', 'superexposta (2.3)', G({}), { gain: 2.3 }],
  ['luz', 'gama 0.55 (lavada)', G({}), { gamma: 0.55 }],
  ['luz', 'gama 1.9 (pesada)', G({}), { gamma: 1.9 }],
  ['luz', 'contraste 0.5', G({}), { contrast: 0.5 }],
  ['luz', 'contraste 0.3', G({}), { contrast: 0.3 }],
  ['luz', 'sombra lateral (rampa 0.8)', G({}), { ramp: 0.8 }],
  ['luz', 'sombra diagonal (rampa 1.1)', G({ rotZ: 20 }), { ramp: 1.1, rampAngle: 45 }],
  ['luz', 'luz quente', G({}), { tint: [1.2, 1.0, 0.7] }],
  ['luz', 'luz fria', G({}), { tint: [0.8, 1.0, 1.25] }],
  ['luz', 'desfoque 1.5px', G({}), { blur: 1.5 }],
  ['luz', 'desfoque 3px', G({}), { blur: 3 }],
  ['luz', 'ruído 8', G({}), { noise: 8 }],
  ['luz', 'ruído 18', G({}), { noise: 18 }],

  ['luz+', 'sombra forte (rampa 1.6)', G({}), { ramp: 1.6, rampAngle: 30 }],
  ['luz+', 'sombra de mão (mancha escura)', G({}), { blobs: [{ x: 300, y: 230, rx: 110, ry: 90, gain: 0.2, add: 0 }] }],
  ['luz+', 'brilho/reflexo', G({}), { blobs: [{ x: 330, y: 215, rx: 60, ry: 45, gain: 1, add: 0.9 }] }],
  ['luz+', 'pouca luz + ruído + desfoque', G({}), { gain: 0.35, noise: 14, blur: 1.2 }],
  ['luz+', 'contra-luz (rampa 1.2, contraste 0.6)', G({}), { ramp: 1.2, contrast: 0.6, rampAngle: 90 }],
  ['luz+', 'sombra de mão + incl. 35°', G({ tilt: 35, tiltAxis: 70 }), { blobs: [{ x: 270, y: 250, rx: 120, ry: 80, gain: 0.25, add: 0 }], ramp: 0.5 }],
  ['combo', 'escura + ruído + incl. 30°', G({ tilt: 30 }), { gain: 0.45, noise: 10 }],
  ['combo', 'esticada 1.5 + incl. 35°', G({ stretchX: 1.5, tilt: 35, tiltAxis: 30 }), {}],
  ['combo', 'achatada 0.6 + incl. 35° + sombra', G({ stretchX: 0.6, tilt: 35, tiltAxis: 90 }), { ramp: 0.7 }],
  ['combo', 'incl. 45° + contraste 0.5 + desfoque 1.5', G({ tilt: 45, tiltAxis: 120 }), { contrast: 0.5, blur: 1.5 }],
  ['combo', 'giro 70° + esticada 1.4 + luz quente + ruído', G({ rotZ: 70, stretchX: 1.4 }), { tint: [1.2, 1, 0.7], noise: 8 }],
];

export const HOLD = [
  ['inclinação', 'tilt', 0, 85, 34, {}, {}],
  ['esticar', 'stretchX', 1, 3.2, 44, {}, {}],
  ['achatar', 'stretchX', 1, 0.2, 40, {}, {}],
  ['escurecer', 'gain', 1, 0.15, 34, {}, {}],
];

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

export async function suite(page, { quick = false, label = '', info: infoOnly = false } = {}) {
  const only = process.env.LAB_ONLY ? process.env.LAB_ONLY.split(',') : null;
  const designs = (quick ? DESIGNS.slice(0, 1) : DESIGNS).filter((d) => !only || only.includes(d.design));
  const filter = process.env.LAB_CASES ? new RegExp(process.env.LAB_CASES) : null;
  const cases = (infoOnly ? [] : quick ? CASES.filter((c, i) => i % 4 === 0) : CASES).filter((c) => !filter || filter.test(`${c[0]} ${c[1]}`));
  const rows = [];
  const info = [];
  for (const d of designs) {
    const s = await page.evaluate((x) => window.lab.setup(x), { ...d, enhance: process.env.LAB_ENHANCE ?? 'none', variants: process.env.LAB_VARIANTS ? JSON.parse(process.env.LAB_VARIANTS) : false, lcn: process.env.LAB_LCN ? JSON.parse(process.env.LAB_LCN) : null });
    info.push({ ...d, ...s });
    console.log(`\n== ${d.design} (alvo ${s.width}x${s.height}, .mind ${(s.bytes / 1024).toFixed(0)} KiB, compilou em ${(s.compileMs / 1000).toFixed(1)} s, variantes=${s.variantKeyframes}, pontos de rastreio 256px/128px=${s.trackingPoints.join('/')}) ${label}`);
    for (const [group, name, geometry, look] of cases) {
      const t0 = Date.now();
      const r = await page.evaluate(([g, l]) => window.lab.detectCase(g, l), [geometry, look]);
      rows.push({ design: d.design, group, name, ...r });
      const mark = r.good ? 'OK ' : r.found ? 'ERR' : '-- ';
      console.log(
        `${mark} ${pad(group, 8)} ${pad(name, 44)} frames=${r.frames ?? '-'}  casar=${(r.matchMs / (r.frames ?? 9)).toFixed(0)}ms pts=${pad(r.nFeat, 4)} rej=${r.rejected} ${r.found ? `canto=${(r.cornerErr * 100).toFixed(1)}% (piso ${(r.floorCorner * 100).toFixed(1)}%)` : ''}  (${Date.now() - t0} ms)`,
      );
    }
  }
  console.log('\n== Resumo (reconhecimento correto por grupo)');
  const groups = [...new Set(rows.map((r) => r.group))];
  for (const g of groups) {
    const rs = rows.filter((r) => r.group === g);
    console.log(`${pad(g, 9)} ${rs.filter((r) => r.good).length}/${rs.length}`);
  }
  console.log(`TOTAL     ${rows.filter((r) => r.good).length}/${rows.length}`);

  const holds = [];
  if (!quick && !infoOnly && !filter) {
    console.log('\n== Rastreio: até onde o rastreador segura depois de travar (de frente -> variando)');
    for (const d of designs) {
      await page.evaluate((x) => window.lab.setup(x), { ...d, enhance: process.env.LAB_ENHANCE ?? 'none', variants: process.env.LAB_VARIANTS ? JSON.parse(process.env.LAB_VARIANTS) : false, lcn: process.env.LAB_LCN ? JSON.parse(process.env.LAB_LCN) : null });
      for (const [name, param, from, to, steps, base, look] of HOLD) {
        const r = await page.evaluate((a) => window.lab.holdSweep(...a), [param, from, to, steps, base, look]);
        holds.push({ design: d.design, name, ...r });
        console.log(`${pad(d.design, 10)} ${pad(name, 12)} ${r.locked ? `segurou até ${r.lastGood.toFixed(2)} (perdeu em ${r.lostAt === null ? 'nunca' : r.lostAt.toFixed(2)}; ${r.reason ?? ''})` : 'não travou de frente'}`);
      }
    }
  }
  return { label, info, rows, holds };
}
