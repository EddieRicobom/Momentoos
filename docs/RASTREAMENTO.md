# Rastreamento com MindAR: o que foi verificado e o que não foi

Este documento separa três coisas: o que foi **lido no código-fonte** do
`mind-ar@1.2.5`, o que foi **executado** neste projeto e o que **depende de teste
em celular**. Não afirma nada além disso.

## 1. API real usada (lida no código-fonte do pacote 1.2.5)

O pacote publicado no npm foi baixado e lido em `src/image-target/`. A
documentação web do MindAR é focada em A-Frame e não detalha a API de
compilação no navegador, por isso a fonte de verdade foi o código.

| Necessidade | API | Arquivo |
|---|---|---|
| Compilar imagem no navegador | `new Compiler().compileImageTargets(imgs, onProgress)` | `compiler-base.js` |
| Salvar o resultado | `compiler.exportData()` → `Uint8Array` (MessagePack, `v: 2`) | `compiler-base.js` |
| Reaproveitar sem recompilar | `compiler.importData(buffer)` | `compiler-base.js` |
| Rastrear com Three.js | `new MindARThree({ container, imageTargetSrc, ... })` | `three.js` |
| Eventos de reconhecimento | `anchor.onTargetFound` / `onTargetLost` / `onTargetUpdate` | `three.js` |
| Carregar alvo sem URL | `controller.addImageTargetsFromBuffer(buffer)` | `controller.js` |

Conclusões que saem do código (não de execução):

- **Compilar dinamicamente é suportado.** O `Compiler` de navegador processa
  imagens em runtime (parte em Web Worker, parte na thread principal com
  TensorFlow.js/WebGL). O `OfflineCompiler` (Node, com node-canvas) é outro
  caminho e **não** é usado aqui.
- **Salvar e reutilizar é suportado**, via `exportData()`/`importData()`.
- **`MindARThree` só aceita o alvo por URL** (faz `fetch`). Este projeto cria uma
  `blob:` URL a partir do buffer em memória a cada sessão. Não há dependência de
  URL que sobreviva ao fechamento do app.
- **Versão do formato:** `importData` aceita só `v: 2`. Com outra versão ele
  escreve um erro no console e devolve lista **vazia** (sem lançar exceção); o
  rastreador então "funcionaria" sem reconhecer nada. Por isso `inspectTargetBuffer`
  valida o arquivo antes de abrir a câmera.
- **`MindARThree` engole o erro da câmera:** em falha de `getUserMedia` só faz
  `console.log` e rejeita sem valor. Por isso `probeCamera` abre a câmera antes,
  para diferenciar "permissão negada" de "indisponível".
- **O compilador usa `img.width`/`img.height`**, não as dimensões naturais.
  A imagem entregue é sempre um `HTMLImageElement` já decodificado no tamanho final.

## 2. Convenção de coordenadas (lida em `three.js` e `controller.js`)

O grupo de cada âncora tem a origem no **centro do alvo** e **1 unidade = largura
do alvo**. O objeto de teste usa um plano `1 × (altura/largura)`, que deve cobrir
exatamente a imagem cadastrada. Se, em teste real, a moldura aparecer deslocada
ou com proporção errada, o problema é de alinhamento do rastreamento (ou do
cálculo do FOV do MindAR), não do desenho.

## 3. Parâmetros padrão do MindAR (lidos em `controller.js`)

- `warmupTolerance = 5`: quadros rastreados seguidos antes de mostrar o objeto.
- `missTolerance = 5`: quadros perdidos seguidos antes de esconder o objeto.
- Filtro de suavização (One Euro): `filterMinCF = 0.001`, `filterBeta = 1000`.
- Câmera virtual com FOV vertical fixo de 45° (a calibração real da câmera do
  aparelho não é usada).

Consequência: logo após a tatuagem sair de vista, o objeto continua desenhado por
até ~5 quadros antes de a interface mostrar "Rastreamento perdido". O app não
esconde isso.

## 4. Limitação central: alvo plano

O MindAR estima a pose de **uma imagem plana** (homografia). Isso significa:

- Pele curva (braço, perna, costela) deforma a imagem em relação ao alvo
  cadastrado; o reconhecimento pode ser pior e o objeto não acompanhará a curva.
- Movimento da pele (flexionar o músculo) também.
- **O app não acompanha a deformação da pele e não deve ser descrito assim.**

A arquitetura isola o rastreador em `src/tracking/arSession.ts`, atrás de
callbacks (`onReady/onFound/onLost`), para permitir avaliar depois técnicas
adicionais (pontos locais, fluxo óptico) **somente se** os testes mostrarem que
elas melhoram o resultado. Nada disso foi implementado.

## 5. O que foi executado neste projeto

| Verificação | Resultado |
|---|---|
| `npm install` em Node 22.22.0 | OK (após as correções do README) |
| `tsc --noEmit` (TypeScript 7.0.2) | OK; confirmado que o `tsc` lê os arquivos e detecta erro proposital |
| `vitest run` | 4 arquivos, 53 testes, todos passaram |
| `vite build` | OK; 1,7 MB de JS (440 KB comprimido) |
| Build sem CDN | Conferido: nenhuma referência a CDN no `dist/` |
| Workers embutidos | Conferido: 2 workers inline (`data:`) no bundle |

## 6. O que NÃO foi executado

Um navegador não pôde ser instalado no ambiente de desenvolvimento (download do
Chromium bloqueado pela rede). Portanto **nunca foi executado**, em navegador real:

- compilação de uma imagem pelo MindAR;
- `exportData()` → `importData()` com o resultado real;
- abertura da câmera, reconhecimento, acompanhamento, perda e recuperação;
- o alinhamento do objeto virtual sobre a imagem.

Todos esses itens estão no roteiro [TESTES-MANUAIS.md](TESTES-MANUAIS.md).
Enquanto ele não for executado em um celular com uma tatuagem real, o rastreamento
**não está validado**.
