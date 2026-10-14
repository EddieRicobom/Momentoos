// Depuração de um caso: node tools/detect-lab/debug.mjs <desenho> '<geometria json>' '<luz json>' ['<variantes json>']
import { createServer } from 'vite';
const [design, geometry = '{}', look = '{}', variants = 'false'] = process.argv.slice(2);
const seeds = { mandala: 11, blackwork: 22, script: 33 };
const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const server = await createServer({ optimizeDeps: { entries: ['tools/detect-lab/index.html'], include: ['@tensorflow/tfjs', '@tensorflow/tfjs-backend-webgl', '@tensorflow/tfjs-core', 'ml-matrix', 'tinyqueue', '@msgpack/msgpack'] }, server: { port: 5199, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5199/tools/detect-lab/index.html');
await page.waitForFunction(() => window.labReady === true, null, { timeout: 60000 });
try {
  await page.evaluate((x) => window.lab.setup(x), { design, seed: seeds[design], variants: JSON.parse(variants), debug: true, enhance: process.env.LAB_ENHANCE ?? 'none' });
  const out = await page.evaluate(([g, l]) => window.lab.debugCase(g, l), [JSON.parse(geometry), JSON.parse(look)]);
  console.log(JSON.stringify(out.r));
  console.log('rastreio:', JSON.stringify(await page.evaluate(() => window.__trk)));
  for (const d of out.dbg) {
    const best = d.frames.map((f, i) => [i, f]).filter(([, f]) => f && f.i2 > 0).sort((a, b) => b[1].i2 - a[1].i2).slice(0, 4);
    console.log(`crop ${d.k}: pontos=${d.pts} achou=${d.found} melhores(keyframe,inliers2)=${best.map(([i, f]) => `${i}:${f.i2}(m${f.m}/h${f.h}/i${f.i})`).join(' ')}`);
  }
} finally {
  await browser.close();
  await server.close();
}
