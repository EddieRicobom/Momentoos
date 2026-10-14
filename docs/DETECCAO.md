# Detecção flexível (luz, esticar/achatar, ângulos fortes)

Pedido: o reconhecimento da tatuagem precisa tolerar luz diferente, pele esticada ou
achatada e ângulos estranhos. Este documento diz **o que mudou, como foi medido e o que
continua sem comprovação**.

> **Aviso honesto.** Todos os números abaixo vêm de um laboratório com imagens
> **sintéticas** (desenhos gerados por código sobre "pele" artificial, câmera simulada)
> rodando o MindAR real num Chromium **sem GPU** (SwiftShader). Servem para comparar
> "antes × depois". **Nada disto foi testado numa tatuagem real num celular real.**
> O roteiro para isso é a Parte 11 de `TESTES-MANUAIS.md`.

## O que o MindAR original faz e onde falhava

1. **Reconhecimento** (casar pontos da câmera com os do alvo): os descritores aguentam
   escala e giro no plano, mas pouco esticar/achatar e inclinações fortes (a imagem do
   alvo é plana e de frente).
2. **Confirmação pelo rastreador**: o conteúdo só aparece depois de 5 quadros rastreados.
   O rastreador usa uma **pose rígida** (corpo rígido). Pele esticada não é rígida, então
   o rastreador perdia a tatuagem mesmo depois de reconhecê-la.
3. **Pontos de rastreio**: ele rastreia sempre na versão de 128 px do alvo. Desenhos de
   linha fina ou com padrões repetidos ficavam com 0 a 4 pontos (os de traço grosso têm
   12 a 30) e **nunca fixavam**, mesmo sendo reconhecidos.
4. **Luz**: limiares absolutos de contraste; sombra, contra-luz e mão na frente
   apagavam os pontos da parte escura.

## O que foi feito

| Mudança | Onde | Custo |
|---|---|---|
| **Variantes deformadas do alvo**: ao compilar, o alvo também é comprimido (1,8× e 3×) em 4 direções; no reconhecimento, se o alvo de frente não casa, tenta as variantes e converte o resultado de volta para as coordenadas do alvo original. (Esticar 1,6× equivale a comprimir o outro eixo.) | `targetVariants.ts`, `variantKeyframes.ts`, `variantMatcher.ts`, `patch/controllerWorker.ts` | `.mind` ~2,3× maior; compilar ~3× mais lento; mais trabalho no worker enquanto procura |
| **Pose flexível**: homografia (8 graus de liberdade) guardando o esticar/achatar; só substitui a pose rígida quando ela não se ajusta (erro > 2,5 px). Vale na detecção e no rastreio contínuo. | `flexPose.ts`, `patch/controllerWorker.ts` | desprezível |
| **Resolução do rastreio adaptativa**: sobe de 128 → 192 → 256 → 384 px só se faltarem pontos (< 16). Modelos de comparação levemente suavizados (2 passadas; casam melhor com quadros reais). | `trackingScales.ts`, `patch/compilerWorker.ts` | compilação um pouco maior; janela de busca cobre menos do alvo quando a resolução sobe |
| **Normalização local de contraste do quadro**, alternando quadro normalizado e cru (um cobre o que o outro perde). | `frameNormalize.ts`, `patch/inputLoader.ts` | contas na GPU a cada 2 quadros |
| **Diagnóstico no app**: mostra os pontos de rastreio e avisa se são poucos; sugere recompilar alvos antigos. Caixa para desligar as variantes. | `targetInfo.ts`, `createView.ts` | — |

O MindAR é consumido como código-fonte; os arquivos internos trocados estão listados no
plugin `mindarPatches` de `vite.config.ts` (`controller.worker.js`, `compiler.worker.js`,
`input-loader.js`). A versão do pacote é fixa (1.2.5); ao atualizar, revise esses
arquivos. `.mind` antigos continuam funcionando (sem variantes).

## Laboratório

    npm i --no-save playwright-core
    PLAYWRIGHT_CHROMIUM=/caminho/chrome node tools/detect-lab/run.mjs [--quick] [--out r.json]
    LAB_VARIANTS='{"tilts":[1.8,3],"directions":4,"scaleStride":3}' ...   # compila com variantes
    MINDAR_PATCHES=off ...                                                  # mede o MindAR original

Gera 4 desenhos (traço grosso, script, linha fina irregular e um mandala periódico),
distorce com homografia 3D de câmera (escala, giro, inclinação, esticar, achatar),
aplica luz (ganho, gama, contraste, rampa, sombra de mão, reflexo, tinta, desfoque,
ruído) e, por caso, emula o MindAR: 9 recortes que se revezam, e a pose só vale se o
rastreador a confirmar por 6 quadros. A régua desconta o erro **inevitável** de uma
pose rígida em pele esticada (calculado com correspondências perfeitas).

### Resultado (172 casos = 4 desenhos × 43 condições, confirmados pelo rastreador)

| Grupo | MindAR original | + pose flexível + rastreio adaptativo | + variantes |
|---|---|---|---|
| de frente / escala / giro | 15/28 | 27/28 | 27/28 |
| ângulos (25° a 75°) | 8/24 | 14/24 | 22/24 |
| esticada (1,3× a 2,6×) | 1/16 | 8/16 | 16/16 |
| achatada (0,75× a 0,33×) | 1/20 | 9/20 | 18/20 |
| luz (43 variações) | 35/64 | 57/64 | 57/64 |
| combinações | 4/20 | 12/20 | 17/20 |
| **Total** | **64/172** | **127/172** | **157/172** |

Rastreio já travado, até onde segura (desenhos de traço grosso): esticar até ≥3,2× (antes
1,05–2,05×), achatar até ~0,2× (antes ~0,8×), inclinar até ~75–85°.

A última coluna é a rodada completa **sem** a normalização de contraste do quadro. A
normalização e o desfoque dos modelos foram medidos à parte (subconjuntos de 24–52
casos): luz difícil 14 → 32 de 36 com normalização; 43 → 47 de 52 com o desfoque de 2
passadas. **A rodada completa com tudo ligado ao mesmo tempo não foi concluída**; não há
número total para a combinação final.

### Custos medidos (SwiftShader, não é celular)

- Casar por quadro: média 19 ms (original) → 35 ms (com variantes).
- Compilar: 1,5 s → 4,2 s (traço grosso); o padrão repetitivo chegou a 25 s.
- `.mind`: ~0,45 MB → ~1,1 MB.

## Limites conhecidos

- **Padrões muito repetidos** (anéis concêntricos, hachuras): o rastreio quase não acha
  pontos únicos. O app avisa; recorte uma área com mais variedade.
- **Linha muito fina** (< ~0,5 mm) com pouca resolução na foto: poucos pontos.
- Inclinação acima de ~70°, achatar abaixo de ~0,35×, desfoque forte (3 px num quadro de
  640) e pouca luz com muito ruído ainda falham em parte dos casos.
- A pose flexível ancora o conteúdo à pele esticada; objetos 3D acompanham o esticar
  (ficam deformados junto), o que é coerente com a pele, mas pode surpreender.
- O app **não** modela pele 3D: o MindAR trata a tatuagem como imagem plana.
- Sem medição em aparelho real: desempenho (FPS, calor), efeito no giroscópio e ganho em
  tatuagens reais são desconhecidos.
