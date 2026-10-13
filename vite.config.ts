import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

// `npm run dev:https` usa --mode https: sobe o servidor com certificado
// autoassinado para que o celular, acessando pelo IP da rede local, tenha um
// contexto seguro (obrigatório para getUserMedia / câmera).
export default defineConfig(({ mode }) => ({
  // Caminhos relativos: o build funciona em https://<usuario>.github.io/<repo>/
  // sem precisar saber o nome do repositório.
  base: './',
  // Versão do app gravada nos backups (só informativa; nada é enviado a lugar nenhum).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: mode === 'https' ? [basicSsl()] : [],
  optimizeDeps: {
    // O mind-ar é consumido pelo código-fonte (src/**), que usa as sintaxes
    // `?worker&inline` e `?raw` do Vite. O pré-empacotamento de dependências
    // não entende essas sintaxes, então ele precisa ficar de fora.
    exclude: ['mind-ar'],
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
