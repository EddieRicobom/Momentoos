// node tools/ui-lab/run.mjs <pasta-de-saida> [tela...]   (ex.: out home projects editor)
// Requer playwright-core (PLAYWRIGHT_CORE=/caminho/playwright-core/index.mjs) e um Chromium (PLAYWRIGHT_CHROMIUM).
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

const [outDir = 'ui-shots', ...screens] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const pw = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const chromium = pw.chromium ?? pw.default.chromium;
const port = Number(process.env.LAB_PORT ?? 5198);

const server = await createServer({
  optimizeDeps: { entries: ['tools/ui-lab/index.html'], include: ['@tensorflow/tfjs', '@tensorflow/tfjs-backend-webgl', '@tensorflow/tfjs-core', 'ml-matrix', 'tinyqueue', '@msgpack/msgpack'] },
  server: { port, strictPort: true, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${port}/tools/ui-lab/index.html`);
await page.waitForFunction(() => window.labReady === true, null, { timeout: 90000 });

try {
  for (const name of screens.length ? screens : ['home', 'projects', 'create', 'settings', 'import', 'export', 'editor']) {
    await page.evaluate((n) => {
      if (n === 'editor') window.lab.setEditing(window.lab.projectId);
      window.lab.render(n);
    }, name);
    await page.waitForTimeout(name === 'editor' ? 2500 : 600);
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: process.env.FULL === '1' });
    if (name === 'editor') {
      // a folha de controles rola por dentro: captura também depois de rolar
      await page.evaluate(() => document.querySelector('.editor-sheet')?.scrollBy(0, 520));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${outDir}/${name}-2.png` });
      await page.evaluate(() => document.querySelector('.editor-sheet')?.scrollBy(0, 700));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${outDir}/${name}-3.png` });
    }
    console.log('ok', name);
  }
} finally {
  await browser.close();
  await server.close();
}
