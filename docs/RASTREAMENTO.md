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

## Preparo da imagem: recorte e contraste

A foto passa por dois ajustes antes de virar alvo. **Nenhum deles foi medido em
tatuagens reais**: são hipóteses fundamentadas no código do `mind-ar@1.2.5`
(arquivos citados abaixo, dentro de `node_modules/mind-ar/src/image-target/`).
Por isso o modo "Original" e a foto inteira continuam disponíveis, para
comparar (roteiro: Parte 8 de [TESTES-MANUAIS.md](TESTES-MANUAIS.md)).

### O que o MindAR faz por dentro (conferido no código)

- **Cinza do alvo ≠ cinza da câmera.** O compilador converte a foto em cinza
  pela média `(R+G+B)/3` (`compiler-base.js`). A câmera ao vivo é convertida
  com `0,299·R + 0,587·G + 0,114·B` (`input-loader.js`). Em tinta preta sobre
  pele a diferença é pequena; em tinta colorida (vermelho, azul) ela existe.
- **Os pontos de interesse são distribuídos em grade.** O detector reparte a
  imagem em 10×10 células e guarda até 5 pontos por célula
  (`detector/detector.js`, `NUM_BUCKETS_PER_DIMENSION`, `MAX_FEATURES_PER_BUCKET`).
  Células sobre pele lisa ou fundo gastam o orçamento de pontos fora da tatuagem.
- **Os limiares de detecção são absolutos** (por exemplo `LAPLACIAN_THRESHOLD = 3`
  e `SD_THRESH = 8`, em níveis de cinza 0–255). Foto lavada ou de baixo contraste
  tende a render menos pontos. O rastreador (`tracker/extract.js`) escolhe os 2%
  de maior gradiente, o que também depende do contraste.

### O que o app faz

1. **Recorte** na área da tatuagem, escolhido na tela (com sugestão automática
   que procura tinta mais escura que a pele). Todas as células da grade passam
   a cobrir a tatuagem. Consequência: o sistema de coordenadas do alvo passa a
   ser o do **recorte**, não o da foto inteira (relevante para posicionar
   conteúdo virtual, Etapa D), e, na câmera, a tatuagem precisa ser enquadrada
   por inteiro, como o recorte.
2. **Cinza com os pesos da câmera.** A imagem é convertida com 0,299/0,587/0,114
   e salva com R=G=B; assim a média do compilador devolve exatamente esse cinza.
3. **Contraste**, em três níveis:
   - *Original*: nada é alterado.
   - *Equilibrado* (pré-selecionado): cinza + esticamento linear por percentil
     (1% e 99% viram 0 e 255). É global e não troca a ordem dos tons; imagem
     quase lisa (faixa útil < 8 níveis) é deixada como está, para não amplificar
     só ruído.
   - *Forte*: além disso, CLAHE (equalização adaptativa com limite de contraste,
     grade 8×8, limite 3). Realça traços finos, mas também textura de pele e
     ruído, e é uma transformação local que afasta a imagem do que a câmera vê.
     Tratado como experimental.

### Por que não preto e branco puro

Binarizar (cada pixel vira 0 ou 255) apaga os gradientes de que o detector
(extremos de Laplaciano) e o rastreador (gradiente) dependem, cria bordas
serrilhadas que a câmera não reproduz e desperdiça os tons intermediários do
sombreado da tinta. "Contraste máximo" sem binarizar é o que o modo *Forte*
aproxima. Se os testes mostrarem que vale a pena, dá para acrescentar.

### Imagem guardada

O projeto guarda a imagem **exatamente como foi compilada** (recortada e
realçada), em PNG. Recompilar reproduz o mesmo alvo. A foto original não é
guardada, o que também reduz a quantidade de imagem pessoal no aparelho e nos
backups. Consequência: não dá para refazer o recorte depois; é preciso tirar
a foto de novo.

### O que ainda não existe

- Ajuste do **rastreamento ao vivo** pelos parâmetros do próprio MindAR (tolerância
  a perdas, filtro). Os valores atuais são os padrões (`warmupTolerance = 5`,
  `missTolerance = 5`, filtro One Euro). A única camada extra é a estabilização
  opcional por giroscópio (seção abaixo).
- Pré-processamento do **quadro da câmera**: o MindAR lê o vídeo direto, e
  filtrá-lo antes custaria desempenho no celular.

## Estabilização por giroscópio (opcional)

Botão "Giroscópio" na tela da câmera (escondido se o aparelho não expõe o sensor).
**Desligado por padrão e nunca testado em aparelho real.**

Como funciona (`gyro.ts`, `poseStabilizer.ts`, `anchorAssist.ts`):

1. O evento `devicemotion` dá a velocidade angular (`rotationRate`: `beta` em torno
   de x, `gamma` em torno de y, `alpha` em torno de z, graus/s). Cada amostra vira uma
   pequena rotação da câmera, no quadro da página (girado pelo ângulo da tela,
   `screen.orientation.angle`) e acumulada. O tempo vem do relógio entre amostras,
   não do campo `interval` (que varia entre navegadores).
2. A cada quadro desenhado, a última pose do alvo (no quadro da câmera) é girada pelo
   **inverso** da rotação da câmera. Isto só vale para rotação pura: deslocamentos do
   celular não são medidos.
3. A cada pose nova do MindAR, a pose prevista e a medida são misturadas
   (peso da medida 0,6). Se previsão e medida diferem mais de 8° ou 0,25 largura do
   alvo, vale só a medida.
4. Se o MindAR perde a tatuagem, a pose é mantida girando só com o giroscópio por até
   800 ms; o aviso de "perdido" (e a pausa de mídia) só acontece depois disso. Se a
   tatuagem volta antes, nada é informado.
5. **Verificação de concordância**: a cada leitura com giro ≥ 1,5°, compara-se se a
   previsão aproximou ou afastou a pose da medida. Se, nas últimas 16 comparações
   (mínimo 10), ≥ 70% afastaram, o giroscópio é suspenso (poses passam sem
   alteração), o botão desliga e a tela avisa. Isto pega sinal/eixo trocados, mas
   também pode desligar um sensor correto em movimento muito brusco ou com translação
   dominante.

Fórmulas conferidas em teste com uma câmera simulada que gira: a pose prevista bate
com a pose verdadeira para giros em x, y, z e eixos livres. O que **não** foi verificado:
as convenções reais de `rotationRate` em cada navegador, o atraso entre o quadro da câmera
e a leitura do sensor (não compensado), o ganho de suavidade no mundo real e o efeito
em celulares específicos.

Permissão: iOS 13+ exige `DeviceMotionEvent.requestPermission()` num toque e HTTPS; o
app só pede quando o botão é tocado. Em Android/Chrome não há pergunta; o app confirma que
chegam amostras com dados em até 1,5 s, senão informa "sem dados".

## Posicionando conteúdo virtual (Etapa D)

Os itens da cena são filhos do grupo da âncora do MindARThree (conferido em
`src/image-target/three.js` do mind-ar 1.2.5):

- **Origem no centro do alvo**; **1 unidade = largura do alvo**; +x para a
  direita, +y para cima na imagem, **+z para fora da pele**.
- O "alvo" é o **recorte** (já com o contraste aplicado) que foi compilado, e é
  exatamente a foto de referência guardada no projeto. A prévia do editor
  desenha essa foto num plano de 1 × (altura/largura) e coloca os itens por
  cima, com o mesmo sistema de coordenadas.
- Cada item é uma cadeia de nós: posição → giro (graus, ordem X, Y, Z) →
  deslocamento no eixo do próprio item → escala uniforme → conteúdo.
- Tamanho com escala 1: imagem, GIF e vídeo têm **metade da largura do alvo**
  (proporção do arquivo mantida); um modelo GLB tem o **maior lado** igual a essa
  largura, centralizado e com a base na pele. O glTF usa Y para cima; o app gira
  o modelo 90° em X para que o "alto" dele aponte para fora da pele.
- A pose (e a suavização) vem do MindAR. A cena **não** tem noção de pele
  curva: tudo é preso ao plano do alvo. Itens longe do centro ou muito altos
  sobre a pele podem "escorregar" mais quando a pose treme (efeito de
  alavanca, hipótese não medida).
- Ao reconhecer (`onTargetFound`) o app toca vídeo, áudio, GIF e animação do
  modelo; ao perder (`onTargetLost`) pausa. O MindAR esconde o grupo da âncora
  sozinho depois de alguns quadros perdidos; o app não controla essa tolerância.
- **Recompilar com outro recorte muda o sistema de coordenadas** e, com ele, a
  posição dos itens sobre a tatuagem.

