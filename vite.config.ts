import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

/**
 * Troca arquivos internos do mind-ar por versões nossas (src/tracking/patch).
 * O pacote é consumido como código-fonte e não oferece ponto de extensão para
 * o casamento de pontos (que roda dentro de um worker). A troca é por caminho
 * resolvido, então vale para o bundle principal e para o do worker.
 */
const mindarRoot = fileURLToPath(new URL('./node_modules/mind-ar/src/image-target/', import.meta.url));
const mindarReplacements: Record<string, string> = {
  'compiler.worker.js': fileURLToPath(new URL('./src/tracking/patch/compilerWorker.ts', import.meta.url)),
  'input-loader.js': fileURLToPath(new URL('./src/tracking/patch/inputLoader.ts', import.meta.url)),
  'controller.worker.js': fileURLToPath(new URL('./src/tracking/patch/controllerWorker.ts', import.meta.url)),
};
function mindarPatches(): Plugin {
  // MINDAR_PATCHES=off só serve ao laboratório (tools/detect-lab) para medir o MindAR original.
  if (process.env.MINDAR_PATCHES === 'off') return { name: 'momentoos-mindar-patches-off' };
  return {
    name: 'momentoos-mindar-patches',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null;
      // o controller importa o worker como './controller.worker.js?worker&inline'
      const [path, ...query] = source.split('?');
      const resolved = resolve(dirname(importer.split('?')[0]!), path!);
      const key = relative(mindarRoot, resolved).split('\\').join('/');
      const replacement = mindarReplacements[key];
      return replacement ? (query.length ? `${replacement}?${query.join('?')}` : replacement) : null;
    },
  };
}

// `npm run dev:https` usa --mode https: sobe o servidor com certificado
// autoassinado para que o celular, acessando pelo IP da rede local, tenha um
// contexto seguro (obrigatório para getUserMedia / câmera).
export default defineConfig(({ mode }) => ({
  // Caminhos relativos: o build funciona em https://<usuario>.github.io/<repo>/
  // sem precisar saber o nome do repositório.
  base: './',
  // Versão do app gravada nos backups (só informativa; nada é enviado a lugar nenhum).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [mindarPatches(), ...(mode === 'https' ? [basicSsl()] : [])],
  worker: { plugins: () => [mindarPatches()] },
  optimizeDeps: {
    // O mind-ar é consumido pelo código-fonte (src/**), que usa as sintaxes
    // `?worker&inline` e `?raw` do Vite. O pré-empacotamento de dependências
    // não entende essas sintaxes, então ele precisa ficar de fora.
    exclude: ['mind-ar'],
    // O mind-ar carrega o TensorFlow.js a partir do código-fonte excluído.
    // Pré-empacote suas dependências CommonJS que o navegador não executa
    // diretamente como módulos ES (Long e seedrandom).
    include: ['long', 'seedrandom'],
  },
  build: {
    target: 'es2022',
    // TensorFlow.js (dependência do MindAR) é grande por natureza.
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
