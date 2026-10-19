# Tattoo AR (Momentoos)

Aplicativo pessoal de realidade aumentada que associa conteúdo digital a uma
**tatuagem real**, usando a câmera do celular para reconhecê-la e acompanhá-la,
sem QR code, marcador artificial ou imagem impressa.

Roda 100% no navegador (PWA), sem backend, sem conta, sem telemetria. A foto da
tatuagem nunca sai do aparelho.

## Estado atual

| Etapa | O quê | Situação |
|---|---|---|
| A | Ambiente, estrutura, documentação | Concluída |
| B | Câmera, compilação do alvo, demo de rastreamento | **Implementada, ainda NÃO validada em celular** |
| C | Salvar projetos (IndexedDB), recarregar, exportar/importar ZIP | **Implementada, testada só com simulações; ainda NÃO validada em celular** |
| D | Cena 3D ancorada com N itens (imagem, GIF, vídeo, GLB, áudio) e editor | **Implementada, testada só com simulações; nada disso rodou em navegador/celular reais** |
| E | PWA offline, otimização, publicação | Não iniciada (há um fluxo de publicação manual, ainda não executado) |

**O rastreamento em tatuagens reais NÃO está validado.** O que existe é o código
da demonstração, que compila, passa nos testes automatizados e gera o build.
Se o MindAR reconhece uma tatuagem de verdade, e com que qualidade, só se sabe
rodando o roteiro de [docs/TESTES-MANUAIS.md](docs/TESTES-MANUAIS.md) em um
celular. Nenhum teste em navegador com câmera foi executado até agora.

## O que já funciona (no código)

- Escolher uma foto da galeria ou fotografar (o botão usa o atributo `capture`
  do HTML, que no Android costuma abrir o app de câmera; não testado em aparelho).
- Reduzir a foto e compilar o alvo no navegador com o compilador do MindAR.
- **Recortar na tatuagem** (com sugestão automática) e escolher o contraste interno
  (Original, Equilibrado ou Forte) antes de compilar, com prévia de como o
  rastreador vai enxergar a imagem. **O efeito disso no reconhecimento NÃO foi
  medido**: a justificativa técnica está em
  [docs/RASTREAMENTO.md](docs/RASTREAMENTO.md) e a comparação A/B, na Parte 8 de
  [docs/TESTES-MANUAIS.md](docs/TESTES-MANUAIS.md).
- Baixar o alvo compilado (`.mind`) e recarregá-lo depois sem recompilar.
- Abrir a câmera, procurar a tatuagem e desenhar um objeto de teste (moldura,
  cubo e eixos) sobre ela.
- Indicar claramente: câmera indisponível, permissão negada, preparando alvo,
  alvo pronto, procurando, reconhecida, **perdida**, erro. Contar perdas e
  recuperações.

Etapa C (persistência):

- Salvar o alvo compilado (e a foto de referência) como **projeto** no
  aparelho (IndexedDB), com nome, e reabri-lo depois **sem recompilar**.
- "Minhas lembranças": listar cada tatuagem com seu conteúdo associado, rever na câmera, renomear, excluir (com confirmação),
  exportar um projeto e **recompilar** a partir da foto guardada quando o alvo
  estiver corrompido ou em formato antigo.
- Exportar e importar **backup em ZIP** (`.tattoo-ar.zip`), com verificação de
  integridade (SHA-256) e tratamento do arquivo como entrada não confiável.
  Formato: [docs/FORMATO-BACKUP.md](docs/FORMATO-BACKUP.md).
- Em Configurações: uso de armazenamento estimado e pedido de armazenamento
  persistente (o navegador decide se concede).

Tudo da Etapa C foi verificado por testes automatizados com **IndexedDB e DOM
simulados**. Não foi executado em navegador nem em celular reais: a Parte 7 de
[docs/TESTES-MANUAIS.md](docs/TESTES-MANUAIS.md) cobre isso.

Etapa D (cena 3D ancorada):

- Cada projeto tem uma **cena com quantos itens quiser** (limite de segurança:
  100 por projeto, 48 MB por arquivo): imagem (PNG, JPG, WebP), **GIF animado**,
  **vídeo local** (MP4, WebM), **modelo 3D GLB** com animações e **áudio**
  (MP3, OGG, WAV, M4A). Cada item tem posição, altura, giro, inclinação,
  tamanho, deslocamento, opacidade e opções próprias (repetir, mudo, volume,
  animação do modelo).
- Organizar lembranças ("Minhas lembranças" → "Adicionar lembranças"): adicionar vários arquivos,
  duplicar, remover, ocultar, e ajustar cada item numa **prévia 3D sobre a foto de
  referência** (de frente ou inclinada; tocar seleciona, arrastar com um dedo posiciona e
  com **dois dedos** o item selecionado gira (torcendo) e muda de tamanho
  (afastando ou aproximando os dedos).
- **Prévia antes de adicionar**: os arquivos não são gravados até confirmar; a
  tela mostra uma miniatura e a posição inicial no alvo. É possível cancelar.
- **Formas de reunir lembranças**: Mural, Arco, Composição livre e Roda de lembranças
  reorganizam os conteúdos visuais e preservam arquivos e nomes. A prévia pode ser
  confirmada, cancelada ou desfeita. A Roda organiza os conteúdos; "Rever lembranças"
  inicia a apresentação automática separadamente.
- **Rever lembranças**: iniciar, pausar, avançar, voltar e escolher intervalos de 2 a
  8 segundos. A câmera centraliza cada memória com transição suave; ao organizar, a
  apresentação pausa, e movimento reduzido desativa as transições.
- **Alinhamento**: a grade opcional usa passos de 5%; os botões Alinhar X/Y alinham
  com o item visual mais próximo. O arrasto mantém os limites do objeto dentro do
  alvo, quando o tamanho do objeto permite.
- **Carrossel automático**: ao escolher **duas ou mais imagens** (PNG, JPG, WebP) de
  uma vez, o editor pergunta se você quer um **carrossel** (um item só que troca de
  imagem sozinho, na ordem escolhida) ou itens separados. Cada carrossel tem o tempo
  de cada imagem (0,5 a 60 s), transição suave opcional, e dá para acrescentar ou
  remover imagens depois (até 30 imagens e 100 MB por carrossel). O tempo só corre
  enquanto a tatuagem está sendo vista; as imagens são abertas sob demanda (a atual e a
  próxima) e reduzidas a no máximo 1536 px no maior lado para poupar memória.
  GIF e vídeo não entram no carrossel. Reordenar imagens ainda não existe (remova e
  adicione de novo).
- **Giroscópio (opcional)**: na tela da câmera, o botão "Giroscópio" usa o sensor de
  movimento do aparelho para suavizar o rastreamento: entre uma leitura do MindAR e a
  seguinte, a pose é girada conforme o giro do celular; as leituras novas são misturadas
  com essa previsão (menos tremor); e, se a tatuagem sair de vista por um instante, o
  conteúdo segue o giro do celular por até 0,8 s antes de sumir. Desligado por padrão; a
  escolha fica salva (no iOS é preciso tocar de novo para dar a permissão). Se o sensor
  discordar da câmera, o app o desliga sozinho e avisa. **Nunca foi testado em aparelho
  real**: se ajuda de verdade, só se sabe testando (roteiro Parte 10).
- **Detecção flexível**: o alvo também é compilado em versões esticadas/inclinadas, a
  pose aceita pele esticada ou achatada, o rastreio sobe de resolução quando o desenho tem
  poucos pontos e o quadro da câmera é normalizado em contraste local (sombras, contra-luz).
  O app mostra quantos pontos de rastreio o alvo tem e avisa se são poucos. Em imagens
  **sintéticas** o reconhecimento confirmado foi de 64 para 157 de 172 casos (sem a normalização de contraste, medida à parte); **não foi
  testado em tatuagem real** (ver `docs/DETECCAO.md` e a Parte 11 do roteiro). Alvos
  antigos continuam funcionando; recompile para ganhar as variantes.
- **Rastreio mais firme**: suavizador de pose próprio (o filtro do MindAR vem praticamente
  desligado), graça de 450 ms ao perder a tatuagem (sem piscar) e contraste normalizado só
  durante a busca. Só testado com ruído sintético, **não em aparelho real** (ver
  `docs/RASTREAMENTO.md`, "Estabilidade da pose").
- **Editor mais fácil**: prévia fixa e grande no topo, ímãs e guias no centro e nas bordas do alvo,
  setas de mover (passo fino), botões +/−, foco da câmera e desfazer/refazer. Interface refeita
  (tela inicial, projetos, editor, câmera com menos poluição).
- Na câmera, os itens aparecem ancorados quando a tatuagem é reconhecida;
  vídeo, áudio, GIF e animações **tocam ao reconhecer e pausam ao perder**.
  Se o navegador bloquear o autoplay, aparece "Tocar áudio e vídeo".
- Os arquivos dos itens ficam no IndexedDB e entram no backup ZIP (formato 3;
  backups do formato 1 continuam importando).
- **Trilha para rever lembranças**: escolha um áudio local da lembrança ou cole um link
  HTTPS do YouTube (watch, youtu.be, Shorts, live ou embed). A faixa só começa ao
  tocar em Reproduzir; YouTube exige internet e segue as restrições do próprio serviço.
  O player aparece no editor, fora da foto ancorada.

Tudo da Etapa D foi verificado por testes automatizados (montagem da cena com
carregadores falsos, contas de posicionamento, armazenamento, backup, telas com
prévia falsa). **Os carregadores reais de mídia, a prévia WebGL e a câmera com
cena nunca rodaram em navegador ou celular**: a Parte 9 de
[docs/TESTES-MANUAIS.md](docs/TESTES-MANUAIS.md) cobre isso.

## Requisitos

- Node.js **22.12 ou superior** (testado com 22.22.0) e npm (testado com 10.9.4).
  O Vite 8 aceitaria também o Node 20.19+, mas o Vitest 5 (usado nos testes)
  exige 22.12+. Valores lidos do campo `engines` dos pacotes instalados.
- Git
- Para testar a câmera: um celular Android com Chrome

## Instalar

```bash
git clone https://github.com/EddieRicobom/Momentoos.git
cd Momentoos
npm install
```

Se o `npm install` reclamar do pacote `canvas`, veja
[Dependências e decisões](#dependências-e-decisões).

## Executar

```bash
npm run dev          # http://localhost:5173
```

A câmera só funciona em **contexto seguro** (HTTPS ou `localhost`). No
computador, `localhost` basta. No celular há duas formas:

**Opção 1: HTTPS na rede local**

```bash
npm run dev:https
```

Abra no celular o endereço `https://<IP-do-computador>:5173` que o Vite mostra
(celular e computador na mesma rede Wi-Fi). O certificado é autoassinado: o
navegador vai avisar, e é preciso aceitar o aviso para continuar.

**Opção 2: USB com `localhost`** (sem aviso de certificado)

1. Ative a depuração USB no Android e conecte ao computador.
2. No Chrome do computador, abra `chrome://inspect/#devices`.
3. Em "Port forwarding", encaminhe a porta `5173` para `localhost:5173`.
4. Rode `npm run dev` e abra `http://localhost:5173` no Chrome do celular.

## Testar

```bash
npm run typecheck    # verificação de tipos
npm test             # testes automatizados (sem câmera)
```

Os testes automatizados cobrem a máquina de estados do rastreamento (inclusive
perda e recuperação), a classificação dos erros de câmera, o cálculo de redução
da imagem e o store; e, na Etapa C, o modelo e a validação de projetos, o
repositório (IndexedDB simulado, incluindo atomicidade e registros corrompidos),
o backup ZIP (inclusive arquivos adulterados, caminhos maliciosos e limites de
tamanho) e a lógica das telas (DOM simulado); na Etapa D, o modelo da cena, a
classificação de arquivos, as operações sobre itens, o backup com itens, o
posicionamento (contas puras e árvore de nós do Three.js), o estabilizador por giroscópio (simulação física de câmera girando, mistura, perda, suspensão), o carrossel (tempo e transição, carregador com decodificação simulada, armazenamento e backup) e a lógica do editor e da tela da câmera. **Não** cobrem compilação do
MindAR, câmera, rastreamento, decodificação de mídia, WebGL, que dependem de navegador e hardware, nem o
comportamento real do IndexedDB, do download e do seletor de arquivos do celular. Para isso, siga
[docs/TESTES-MANUAIS.md](docs/TESTES-MANUAIS.md).

## Gerar o build

```bash
npm run build        # saída em dist/
npm run preview      # serve o build localmente
```

## Publicar no GitHub Pages

O repositório já existe e está configurado como `origin`. A publicação **não é
automática**; ela só acontece quando você dispara o fluxo manualmente:

1. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Aba **Actions → "Publicar no GitHub Pages" → Run workflow**.
3. O endereço final será `https://eddiericobom.github.io/Momentoos/` (confirme
   na própria página de Pages; o GitHub usa o nome do repositório).

O GitHub Pages serve HTTPS, que a câmera exige. O `base: './'` do Vite faz o
build funcionar em qualquer subcaminho sem configuração.

O fluxo (`.github/workflows/pages.yml`) **ainda não foi executado**. As versões
das actions foram conferidas na documentação do GitHub, exceto `setup-node`.

## Como funciona

```
foto ─► imagePrep (reduz p/ ≤1024 px) ─► Compiler (MindAR, no navegador)
                                          │
                                          ├─► exportData() ─► buffer .mind (memória / download)
                                          ▼
.mind (blob: URL) ─► MindARThree ─► câmera + rastreador ─► matriz de pose
                                          │                       │
                                   onTargetFound/Lost    objeto Three.js na âncora
                                          ▼
                              máquina de estados ─► interface
```

Detalhes da API do MindAR efetivamente usada, convenções de coordenadas e
limitações: [docs/RASTREAMENTO.md](docs/RASTREAMENTO.md).

## Dependências e decisões

- **`three` fixado em 0.160.0.** O `MindARThree` do `mind-ar@1.2.5` importa
  `sRGBEncoding`, que foi removido do Three.js a partir da r162. Conferido:
  existe na 0.160.0 e é `undefined` na 0.186.1. Atualizar o Three exige
  substituir o `MindARThree` (ou usar o `Controller` do MindAR diretamente).
- **`canvas` substituído por um pacote vazio (`stubs/canvas`, via `overrides`).**
  O `mind-ar` declara o `canvas` (node-canvas) como dependência, usada só pelo
  compilador offline em Node, que este projeto não usa. Sem binário
  pré-compilado para o Node 22, o `npm install` tentava compilar código nativo
  e falhava. No navegador esse pacote nunca é carregado.
- **`vitest` 5.** Com o `vitest` 4 junto do Vite 8, o npm 10.9.4 travou ao
  resolver dependências (erro interno do resolvedor); com o 5 instala normalmente.
- **`mind-ar` importado por caminho profundo (`mind-ar/src/image-target/...`).**
  O `main` do pacote é um `index.js` vazio e não há tipos. O código-fonte usa
  `?worker&inline` e `?raw`, que só o Vite entende, por isso `optimizeDeps.exclude`.
  Os tipos estão escritos à mão em `src/types/mind-ar.d.ts`.
- **Bibliotecas da Etapa C, todas empacotadas (sem CDN):** `fflate` 0.8.3 (ZIP),
  `@msgpack/msgpack` 2.8.0 (leitura do cabeçalho do `.mind`, o mesmo formato
  que o MindAR usa). Só nos testes: `fake-indexeddb` (IndexedDB simulado) e
  `happy-dom` (DOM simulado). Versões fixadas.
- **`npm audit`: 4 avisos de severidade moderada, sem correção disponível.** Vêm
  de uma cadeia transitiva do MindAR (`mind-ar → @tensorflow/tfjs → argparse →
  sprintf-js`, negação de serviço por precisão ilimitada em `sprintf`). Uma
  busca por "sprintf" no `dist/` não encontrou nada, então esse código não parece
  ir para o navegador; isso é uma verificação textual do bundle, não uma análise
  completa. Não foi aplicado `npm audit fix --force` (forçaria trocar o MindAR).
- **Sem CDN.** Tudo (MindAR, TensorFlow.js, Three.js, workers) é empacotado no
  build. Conferido no `dist/`: nenhuma referência a CDN.

## Privacidade

- Fotos, alvos e projetos ficam no aparelho. Nada é enviado a terceiros.
- Sem telemetria, analytics, anúncios, contas ou chaves de API.
- A câmera só é pedida quando você abre a tela da câmera.
- `.gitignore` bloqueia `*.mind`, `private/` e `*.tattoo-ar.zip`, para você não
  versionar fotos de tatuagem ou alvos por engano.
- Limpar os dados do navegador ou do site pode apagar os projetos locais. Faça
  backups exportados com frequência.
- O backup `.tattoo-ar.zip` **não é criptografado** e contém a foto da tatuagem:
  guarde-o em lugar seu.

## Limitações conhecidas

- Rastreamento em tatuagem real: **não validado** (ver acima).
- O MindAR trata o alvo como uma **imagem plana**. Tatuagens em pele curva ou em
  movimento podem rastrear mal; **não há acompanhamento da deformação da pele**.
- A pose é suavizada por filtro, e o objeto some só depois de alguns quadros
  perdidos (padrão do MindAR: 5), então por instantes ele pode aparecer fora do
  lugar antes de "Rastreamento perdido".
- O tamanho de redução da foto (1024 px) é um valor inicial, não calibrado.
- Cada vez que a tela da câmera é aberta e fechada, o MindARThree deixa um
  ouvinte de `resize` na janela (ele não expõe como removê-lo). Efeito pequeno,
  mas existe.
- Sem modo offline ainda (Etapa E).
- **Cena 3D (Etapa D):** o MindAR trata a tatuagem como imagem plana, então os
  itens ficam presos a esse plano; não acompanham a deformação da pele.
- Os itens se posicionam no sistema de coordenadas do **recorte** da tatuagem
  (origem no centro, 1 unidade = largura do recorte, +z para fora da pele). Se
  recompilar com outro recorte, a posição dos itens muda junto: reposicione-os.
- GIF animado usa `ImageDecoder` (WebCodecs); em navegador sem ele, o GIF
  aparece parado no primeiro quadro, com aviso.
- GLB: sem compressão Draco, Meshopt ou texturas KTX2 (mensagem explica);
  só `.glb` (um arquivo), não `.gltf` com arquivos soltos.
- Vídeo com som e áudio podem exigir um toque (regra de autoplay do navegador,
  mais rígida no iOS, que não foi considerado nos testes).
- **Giroscópio**: só compensa **rotação** do celular; deslocá-lo (andar, aproximar) não
  é medido, então nesses casos vale a leitura do rastreador. O sensor acumula erro
  (por isso o "segurar" após perder a tatuagem é curto, 0,8 s, e durante ele o conteúdo
  segue o celular, não a tatuagem). Os eixos e sinais de `devicemotion` seguem a
  especificação, mas variam entre navegadores/aparelhos: o app compara o giroscópio com a
  câmera e se desliga sozinho se discordarem de forma consistente (isso é um paliativo, não
  prova de que está certo). Valores de mistura (peso 0,6; limites de 8° e 0,25 largura)
  são **chutes razoáveis, não calibrados**. No iOS a permissão exige toque e HTTPS.
  Nada disso foi medido em aparelho real; pode até piorar em alguns celulares.
- Carrossel: durante a transição suave a imagem seguinte aparece **por cima** da atual
  (a atual não some antes), então PNGs com transparência deixam a imagem anterior
  aparecer por trás durante ~0,6 s. Imagem que não abre é pulada com aviso. Nada
  disso foi visto em navegador real: a troca, a memória com 30 imagens grandes e a
  fluidez no celular são **não validadas**.
- Transparência (PNG, WebP, GIF) é desenhada pelo código, mas **não foi testada**; vídeo não tem canal alfa.
- Muitos itens pesados ao mesmo tempo (vídeos, modelos grandes) podem travar
  celulares modestos; os limites de 100 itens e 48 MB são salvaguardas, não
  valores medidos em aparelho.
- Ajustes do editor sem Salvar são gravados ao sair da tela (inclusive pelo
  botão voltar do aparelho); não há "descartar ao sair", só "Desfazer
  alterações" antes.
- Armazenamento no navegador não é garantia de guarda: o navegador pode apagar
  dados do site em situações de pouco espaço, e "armazenamento persistente" é
  só um pedido que ele pode negar. O backup em ZIP é a proteção real.
- Reimportar várias vezes um backup cujo projeto original foi alterado depois
  cria uma nova cópia a cada vez (nada é sobrescrito).

## Estrutura

```
src/
  main.ts                 inicialização e navegação
  styles.css              visual escuro, mobile-first
  capabilities.ts         checagem de compatibilidade do navegador
  storage/                Etapa C: persistência e backup
    model.ts              registro do projeto, validação, migrações, saúde
    repository.ts         IndexedDB (projetos + arquivos, transações)
    projects.ts           criar, abrir (com verificação), recompilar, renomear
    backup.ts             exportar/importar ZIP (entrada não confiável)
    scene.ts              adicionar/editar/remover/duplicar itens da cena
    itemFiles.ts          tipo por extensão + assinatura dos bytes
    storageInfo.ts        uso/cota e armazenamento persistente
    errors.ts, hash.ts    erros tipados, SHA-256 e ids
  scene/                  Etapa D: cena 3D ancorada
    placement.ts          escala base, ajuste de GLB, quadro de GIF e de carrossel (puro)
    runtime.ts            monta a cena, toca/pausa ao reconhecer/perder
    loaders.ts            imagem, GIF, vídeo, GLB, áudio e carrossel (precisam de navegador)
    editorModel.ts        controles, limites e alterações do editor (puro)
    picking.ts            raio × plano, câmera da prévia e matemática do giro (puro)
    gestures.ts           gestos de 1 e 2 dedos da prévia (puro, testado)
    summaryText.ts        textos de andamento e erros
  tracking/
    mindFormat.ts         leitura do cabeçalho do .mind
    state.ts              máquina de estados (pura, testada)
    store.ts              store mínimo
    camera.ts             classificação de erros e checagem prévia da câmera
    imagePrep.ts          leitura, recorte, redução e realce da foto
    targetPixels.ts       cinza, contraste, CLAHE e sugestão de recorte (puro)
    cropGeometry.ts       geometria do recorte (puro)
    targetCompiler.ts     compilação e validação do .mind
    targetVariants.ts     variantes esticadas/inclinadas do alvo (puro)
    variantKeyframes.ts   keyframes de reconhecimento das variantes (usa o detector do MindAR)
    variantMatcher.ts     casamento com variantes (puro, roda no worker)
    flexPose.ts           pose flexível: homografia com esticar/achatar (puro)
    trackingScales.ts     resolução adaptativa do rastreio e suavização (puro)
    frameNormalize.ts     normalização local de contraste do quadro
    targetInfo.ts         texto de diagnóstico do alvo
    patch/                arquivos do MindAR trocados pelo plugin do vite.config.ts
    arSession.ts          sessão MindARThree (câmera + rastreio)
    gyro.ts               giroscópio (devicemotion) como fonte de rotação da câmera
    poseSmoother.ts       suavizador de pose (tremor) por distância dos cantos do alvo (puro)
    frameMode.ts          modo do quadro: procurando (normaliza) × rastreando (cru)
    poseStabilizer.ts     previsão por giroscópio + mistura + "segurar" a pose (puro, testado)
    anchorAssist.ts       cola entre a âncora do MindAR e o estabilizador
    virtualObject.ts      objeto de teste ancorado
  ui/                     telas e componentes (editorView.ts, previewStage.ts: editor e prévia 3D)
  types/mind-ar.d.ts      tipos escritos à mão para o MindAR
tests/                    testes automatizados
tools/detect-lab/         laboratório de detecção (Chromium headless; ver docs/DETECCAO.md)
tools/ui-lab/             renderiza as telas reais num Chromium com projeto de exemplo (capturas de tela)
docs/                     rastreamento, formato de backup e roteiro de testes manuais
stubs/canvas/             pacote vazio que substitui o node-canvas
```
