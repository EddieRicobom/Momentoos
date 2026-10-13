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
| C | Salvar projetos (IndexedDB), recarregar, exportar/importar ZIP | Não iniciada |
| D | Conteúdos virtuais (imagem, GIF, vídeo, GLB) e editor | Não iniciada |
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
- Baixar o alvo compilado (`.mind`) e recarregá-lo depois sem recompilar.
- Abrir a câmera, procurar a tatuagem e desenhar um objeto de teste (moldura,
  cubo e eixos) sobre ela.
- Indicar claramente: câmera indisponível, permissão negada, preparando alvo,
  alvo pronto, procurando, reconhecida, **perdida**, erro. Contar perdas e
  recuperações.

Botões que ainda não fazem a ação (Meus projetos, Importar projeto, Exportar
backup) dizem na tela que ainda não estão disponíveis.

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
da imagem e o store. **Não** cobrem compilação do MindAR, câmera nem
rastreamento, que dependem de navegador e hardware. Para isso, siga
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
- **Sem CDN.** Tudo (MindAR, TensorFlow.js, Three.js, workers) é empacotado no
  build. Conferido no `dist/`: nenhuma referência a CDN.

## Privacidade

- Fotos, alvos e projetos ficam no aparelho. Nada é enviado a terceiros.
- Sem telemetria, analytics, anúncios, contas ou chaves de API.
- A câmera só é pedida quando você abre a tela da câmera.
- `.gitignore` bloqueia `*.mind`, `private/` e `*.tattoo-ar.zip`, para você não
  versionar fotos de tatuagem ou alvos por engano.
- Limpar os dados do navegador pode apagar projetos locais (a partir da Etapa C).
  Faça backups exportados com frequência.

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

## Estrutura

```
src/
  main.ts                 inicialização e navegação
  styles.css              visual escuro, mobile-first
  capabilities.ts         checagem de compatibilidade do navegador
  tracking/
    state.ts              máquina de estados (pura, testada)
    store.ts              store mínimo
    camera.ts             classificação de erros e checagem prévia da câmera
    imagePrep.ts          leitura e redução da foto
    targetCompiler.ts     compilação e validação do .mind
    arSession.ts          sessão MindARThree (câmera + rastreio)
    virtualObject.ts      objeto de teste ancorado
  ui/                     telas e componentes
  types/mind-ar.d.ts      tipos escritos à mão para o MindAR
tests/                    testes automatizados
docs/                     rastreamento e roteiro de testes manuais
stubs/canvas/             pacote vazio que substitui o node-canvas
```
