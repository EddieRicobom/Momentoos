// Laboratório de detecção: node tools/detect-lab/run.mjs [--quick] [--out arquivo.json] [--label texto]
// Requer: `npm i --no-save playwright-core` (ou PLAYWRIGHT_CORE=/caminho/para/playwright-core)
// e um Chromium (PLAYWRIGHT_CHROMIUM=/caminho/do/executavel, se não for o padrão).
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { suite } from './suite.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;

const server = await createServer({ optimizeDeps: { entries: ['tools/detect-lab/index.html'], include: ['@tensorflow/tfjs', '@tensorflow/tfjs-backend-webgl', '@tensorflow/tfjs-core', 'ml-matrix', 'tinyqueue', '@msgpack/msgpack'] }, server: { port: Number(process.env.LAB_PORT ?? 5199), strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(`http://127.0.0.1:${process.env.LAB_PORT ?? 5199}/tools/detect-lab/index.html`);
await page.waitForFunction(() => window.labReady === true, null, { timeout: 60000 });

try {
  const results = await suite(page, { quick: flag('--quick'), info: flag('--info'), label: val('--label', '') });
  const out = val('--out', null);
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await server.close();
}
