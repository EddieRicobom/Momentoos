# Roteiro de testes manuais (Etapas B, C e D, carrossel e giroscópio)

Estes testes precisam de um celular e de uma tatuagem real. Nenhum deles foi
executado ainda. Preencha a coluna **Resultado** conforme for testando: o que
você anotar aqui é a evidência que decide se o rastreamento está validado.

## Preparação

- **Aparelho:** celular Android com Chrome atualizado. Anote modelo e versão em
  "Registro do ambiente", no fim.
- **Acesso:** `npm run dev:https` (aceitar o aviso de certificado) ou USB com
  `localhost`. Detalhes no [README](../README.md#executar).
- **Tatuagem:** use a sua, de verdade. Não use imagem impressa, QR code nem
  marcador como substituto.
- **Foto-alvo:** tire com a tatuagem inteira no quadro, boa luz, sem reflexo e
  sem sombra forte. Anote data/hora e condições.
- **Dados pessoais:** a foto e o `.mind` ficam só no aparelho/computador. Guarde
  em uma pasta `private/` (já ignorada pelo Git).

## Parte 1: Interface e compatibilidade

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 1.1 | Abrir o app → Configurações | Lista mostra "Contexto seguro" ✓, "API de câmera" ✓, "WebGL" ✓, "Web Workers" ✓ | |
| 1.2 | Abrir o app por `http://<IP>:5173` (sem HTTPS) → Configurações | "Contexto seguro" ✕ com a orientação de usar HTTPS | |
| 1.3 | Início → tocar "Meus projetos", "Importar projeto", "Exportar backup" | Cada um avisa que ainda não está disponível (Etapa C) | |
| 1.4 | Início → "Abrir câmera" sem ter criado alvo | Avisa para criar uma âncora e vai para "Criar âncora" | |

## Parte 2: Compilar e reutilizar o alvo

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 2.1 | Criar âncora → "Escolher da galeria" → foto da tatuagem | Estado "Preparando imagem-alvo…" com barra de progresso subindo; prévia da imagem aparece | |
| 2.2 | Aguardar | Termina em "Alvo pronto" com dimensões, tamanho em KB e tempo de compilação. **Anote o tempo.** | |
| 2.3 | Criar âncora → "Fotografar" | Abre o app de câmera do celular (se não abrir, anote o que aconteceu); a foto tirada compila como em 2.1 | |
| 2.4 | Escolher uma imagem minúscula (< 128 px) | "Erro ao compilar ou carregar o alvo" com mensagem sobre o tamanho; alvo anterior continua disponível | |
| 2.5 | "Baixar alvo (.mind)" | Baixa um arquivo `.mind` | |
| 2.6 | **Fechar a aba por completo**, abrir o app de novo → Criar âncora → "Carregar alvo salvo (.mind)" → escolher o arquivo | Vai direto a "Alvo pronto" **sem barra de progresso e sem recompilar** (é o critério de reaproveitar a âncora) | |
| 2.7 | Carregar um arquivo qualquer que não seja `.mind` (ex.: uma foto renomeada) | "Erro ao compilar ou carregar o alvo" com mensagem de arquivo inválido | |

## Parte 3: Reconhecimento e acompanhamento

Use o alvo compilado de 2.2 e, depois, o carregado de 2.6 (o resultado deve ser
equivalente).

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 3.1 | "Testar rastreamento" → permitir a câmera | "Iniciando câmera e rastreador…" e depois "Procurando tatuagem…" (a primeira abertura pode levar vários segundos) | |
| 3.2 | Apontar para a tatuagem **no corpo** | "Tatuagem reconhecida"; moldura, cubo e eixos aparecem sobre ela. **Anote em quantos segundos reconheceu.** | |
| 3.3 | Olhar a moldura verde | Ela coincide com as bordas da imagem cadastrada? Anote deslocamento e proporção (se estiver torta ou deslocada, é problema de alinhamento) | |
| 3.4 | Mover o celular devagar (esquerda/direita, para cima/baixo) | O objeto acompanha. Anote atraso, tremor ou "escorregamento" | |
| 3.5 | Observar o contador "atualizações/s" | Anote o valor típico (indica a fluidez do rastreio no aparelho) | |

## Parte 4: Perda e recuperação

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 4.1 | Com a tatuagem reconhecida, tirar a câmera dela (apontar para outro lado) | O objeto some e o estado muda para **"Rastreamento perdido"**. Anote quanto tempo levou (o MindAR espera ~5 quadros) | |
| 4.2 | Apontar de novo para a tatuagem | Volta a "Tatuagem reconhecida"; "Recuperações" aumenta em 1 | |
| 4.3 | Repetir 4.1–4.2 cinco vezes | "Perdas" e "Recuperações" batem com o que você fez. Anote quantas vezes falhou em recuperar | |
| 4.4 | Cobrir a tatuagem com a mão | Perde. Descobrir → recupera? | |

## Parte 5: Qualidade (documentar cada condição)

Para cada linha, anote se reconheceu, se manteve, e a qualidade do alinhamento
(ótimo / aceitável / ruim / não reconheceu).

| # | Condição | Como testar | Resultado |
|---|---|---|---|
| 5.1 | Distância curta | Aproximar até a tatuagem quase preencher a tela | |
| 5.2 | Distância média | Tatuagem ocupando cerca de metade da largura da tela | |
| 5.3 | Distância longa | Afastar até deixar de reconhecer; anote a distância aproximada | |
| 5.4 | Ângulo | Inclinar o celular (30°, 45°, 60° em relação à pele). Anote o ângulo em que perde | |
| 5.5 | Rotação do celular | Girar entre retrato e paisagem com a tatuagem reconhecida. O objeto acompanha e continua alinhado? | |
| 5.6 | Iluminação variável | Luz forte, luz fraca, luz de lado criando sombra | |
| 5.7 | Oclusão parcial | Cobrir uma parte da tatuagem (10%, 30%, 50%). Anote o limite | |
| 5.8 | Poucos detalhes | Repetir 2.1–3.4 com uma tatuagem simples (traço fino, grandes áreas vazias) | |
| 5.9 | Muitos detalhes | Repetir 2.1–3.4 com uma tatuagem detalhada | |
| 5.10 | Curvatura da pele | Tatuagem em região curva (braço, perna). Reconhece? O objeto acompanha a curva? **Esperado pelo design: não acompanha a deformação.** | |
| 5.11 | Movimento da pele | Flexionar o músculo sob a tatuagem. Mantém ou perde? | |

## Parte 6: Erros de câmera

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 6.1 | Negar a permissão da câmera ao abri-la | Overlay "Permissão da câmera negada" com orientação; botão "Tentar de novo" | |
| 6.2 | Liberar a câmera nas permissões do site e tocar "Tentar de novo" | Segue normalmente para "Procurando tatuagem…" | |
| 6.3 | Abrir a câmera por HTTP simples (sem HTTPS) | "Câmera indisponível" com orientação de usar HTTPS | |
| 6.4 | Deixar outro app usando a câmera e abrir a câmera do app | "Câmera indisponível" (ou comportamento equivalente; anote) | |
| 6.5 | Tocar "Parar e voltar" e abrir a câmera de novo várias vezes | Sem travar; contadores zerados a cada sessão. Anote se o desempenho piora | |

## Parte 7: Projetos salvos e backup (Etapa C)

Estes testes verificam o que os testes automatizados **não** conseguem: o
IndexedDB, o download e a escolha de arquivos do navegador real. Use um projeto
criado a partir de uma tatuagem (ou de qualquer foto, se só quiser testar
armazenamento; para validar **rastreamento**, continue valendo a Parte 3 com
tatuagem real).

| # | Passo | Esperado | Resultado |
|---|---|---|---|
| 7.1 | Em "Criar âncora", compile uma foto, dê um nome e toque "Salvar projeto" | Aviso "Salvo neste aparelho"; o botão some | |
| 7.2 | Feche a aba/app por completo e abra de novo; vá em "Minhas lembranças" | A lembrança aparece com miniatura, nome, data e situação "Pronto" | |
| 7.3 | Toque "Rever na câmera" na lembrança | Abre sem recompilar (sem barra de progresso de compilação) e segue o fluxo da Parte 3 | |
| 7.4 | Reinicie o celular e repita 7.2 e 7.3 | Igual; anote se o projeto sumiu | |
| 7.5 | Renomeie o projeto (inclusive com acentos) | Novo nome aparece e persiste após recarregar | |
| 7.6 | Tente renomear com o nome em branco | Mensagem de erro; nome antigo mantido | |
| 7.7 | Em "Criar âncora", carregue um `.mind` baixado antes e salve como projeto | Salva; o aviso diz que não será possível recompilar (sem foto) | |
| 7.8 | Toque "Exportar" em um projeto | Baixa um `.tattoo-ar.zip`; anote onde ele foi parar e o tamanho | |
| 7.9 | Em "Exportar backup", marque só alguns projetos e gere | O ZIP contém só os marcados; o aviso de que não é criptografado aparece | |
| 7.10 | Abra o ZIP em um computador | Contém `manifest.json` e `projects/<id>/{project.json, anchor.mind, reference-image.*}` | |
| 7.11 | Exclua um projeto (confirme) e importe o ZIP em "Importar projeto" | Projeto volta; "Abrir câmera" funciona sem recompilar | |
| 7.12 | Importe o mesmo ZIP de novo | Informa que já existe; nada é duplicado | |
| 7.13 | Em outro aparelho/navegador, importe o ZIP | Projeto aparece e abre a câmera | |
| 7.14 | Escolha um arquivo qualquer que não é backup (ex.: uma foto renomeada para `.zip`) | Mensagem de erro clara; nada é salvo | |
| 7.15 | "Configurações" → armazenamento | Mostra uso e cota estimados; anote os valores | |
| 7.16 | Toque "Pedir armazenamento persistente" | Mostra concedido ou não concedido (anote qual); o texto não promete segurança | |
| 7.17 | Salve vários projetos (ex.: 5–10) e abra "Meus projetos" | Lista carrega sem travar; anote o tempo percebido e o uso de armazenamento | |
| 7.18 | Exclua um projeto e confira o uso de armazenamento | O uso tende a diminuir (a estimativa do navegador é aproximada e pode demorar a refletir; anote o que viu) | |

Anote também: no Android, se o ZIP baixado abre no gerenciador de arquivos e se
o seletor de arquivos da importação enxerga a pasta de downloads.

## Parte 8: Comparar recorte e contraste (A/B)

Objetivo: descobrir **se** recortar e realçar ajudam na SUA tatuagem. O app não
mede isso sozinho; esta parte é a medição. Mantenha tudo igual entre as
versões: mesma foto, mesma luz, mesma distância, mesmo aparelho.

1. Tire **uma** foto da tatuagem (Parte 2). Em "Criar âncora" ela fica na tela
   de ajuste e dá para compilar várias vezes a partir dela.
2. Crie e **salve** estas versões, uma por vez (o nome do projeto já indica o
   contraste; acrescente "inteira" ou "recorte" no nome):

   | Versão | Recorte | Contraste |
   |---|---|---|
   | V1 | foto inteira ("Usar a foto inteira") | Original |
   | V2 | só a tatuagem | Original |
   | V3 | só a tatuagem | Equilibrado |
   | V4 | só a tatuagem | Forte |

3. Para cada versão (abrindo por "Meus projetos"), faça o mesmo roteiro e anote:

   | Medida | Como medir | V1 | V2 | V3 | V4 |
   |---|---|---|---|---|---|
   | Tempo até reconhecer | Aponte de uma distância fixa; cronometre 5 vezes e anote a média | | | | |
   | Perdas em 30 s | Mova o celular devagar em círculo por 30 s; leia "Perdas" na tela | | | | |
   | Distância mínima/máxima | Afaste e aproxime até perder; anote em cm | | | | |
   | Ângulo máximo | Incline o celular até perder; anote os graus aproximados | | | | |
   | Tremor (sub. 1–5) | Quanto o objeto de teste treme com o celular parado | | | | |
   | Com pouca luz | Repita o tempo de reconhecimento com a luz do ambiente reduzida | | | | |

4. Anote o que **não** melhorou. Se V3/V4 forem piores que V2, o realce não
   ajuda nessa tatuagem e deve ficar desligado ("Original").

Observações: cinco repetições ainda é uma amostra pequena; diferenças pequenas
entre versões podem ser ruído. Só decida por diferenças claras.

## Parte 9: Cena 3D com vários itens (Etapa D)

Pré-requisito: um projeto salvo que já passou nas Partes 2 e 3 (reconhece a
tatuagem). Esta parte valida a **cena e o editor**, não o rastreamento. Tenha à
mão: um PNG com fundo transparente, uma foto JPG, um GIF animado, um MP4 com
som, um WebM, um GLB com animação (e, se possível, um sem animação), um MP3.
Use só arquivos que você tenha direito de usar.

| # | O que fazer | Resultado esperado |
|---|---|---|
| 9.1 | "Minhas lembranças" → **Adicionar lembranças**. Escolha um arquivo e confira a prévia antes de confirmar; repita e cancele uma vez. | A miniatura mostra a posição inicial no alvo; cancelar não grava; confirmar inclui a lembrança na lista. |
| 9.2 | Tente adicionar um `.mov`, um `.gltf`, um arquivo renomeado (um PNG chamado `.glb`) e um arquivo maior que 48 MB. | Cada um é recusado com mensagem clara; os demais itens do lote entram normalmente. |
| 9.3 | Cole um link HTTPS válido do YouTube em **Trilha para rever suas lembranças** e toque em Reproduzir YouTube. | O player incorporado abre; a música só inicia após o toque. Teste link inválido e falta de conexão; a organização deve continuar utilizável. |
| 9.4 | Na prévia, toque num item e arraste. Troque entre "De frente" e "Inclinada". Use a grade e os botões Alinhar X/Y. | O item acompanha o dedo; a caixa fica dentro do alvo quando seu tamanho permite; a grade encaixa em passos de 5%; tocar no vazio desmarca. |
| 9.4b | Com um item selecionado, ponha **dois dedos** na prévia (em qualquer lugar, até fora do item) e gire. Teste também com o primeiro dedo em área vazia. | O item gira no plano dele (giro em Z) acompanhando os dedos, no mesmo sentido; o controle "Giro" acompanha; o item continua selecionado; soltar um dedo encerra o giro sem mover o item. Anote se o sentido está natural, se a rolagem da página interfere e se o gesto fica ruim na vista inclinada. Afastar os dedos aumenta o item e aproximar diminui (limites 0,05× a 5×); o controle "Tamanho" acompanha. Gire e afaste ao mesmo tempo para conferir que os dois funcionam juntos. |
| 9.5 | Mexa em cada controle (posição, altura, giro, inclinação, tamanho, opacidade, volume, ajuste fino). | O item muda ao vivo; "Alterações não salvas" aparece; "Desfazer alterações" volta ao salvo. |
| 9.6 | Toque em "Reproduzir prévia". | GIF anima, vídeo toca, GLB anima, áudio toca. "Pausar prévia" para tudo. Anote o que não tocou. |
| 9.7 | Ajuste algo, toque em **Salvar**, saia do editor e volte. Depois ajuste de novo e saia com o botão voltar do aparelho SEM salvar. | O salvo permanece. O pendente é gravado ao sair (aviso "Ajustes da cena salvos"). |
| 9.8 | Duplique um item; remova outro (com a confirmação). | A cópia aparece deslocada e funciona independente; o removido some e, em Configurações, o uso de armazenamento diminui. |
| 9.9 | "Abrir câmera" a partir do projeto e aponte para a tatuagem. | Os itens carregam ("Carregando itens: x/y") e aparecem sobre a tatuagem quando ela é reconhecida. A posição relativa bate com o que você montou na prévia (dentro do recorte). O botão "Moldura de teste" liga/desliga a moldura. |
| 9.10 | Vídeo, áudio, GIF e animação do GLB: perca a tatuagem (cubra-a) e recupere. | Tocam ao reconhecer, **pausam ao perder** e continuam ao recuperar. Se o navegador bloquear o som, aparece "Tocar áudio e vídeo" e o toque libera. |
| 9.11 | Um modelo GLB: confira a orientação e o tamanho. | O modelo aparece "em pé" sobre a pele, com o maior lado do tamanho da metade do recorte (escala 1). Anote se está de cabeça para baixo ou girado. |
| 9.12 | Adicione 10 e depois 30 itens (misture imagens, 2–3 vídeos, 1–2 modelos). Abra a câmera e observe "atualizações/s" e a fluidez. | Anote o ponto em que fica lento, esquenta ou fecha o navegador. |
| 9.13 | Um GLB com compressão Draco (se tiver). | Item marcado com erro e mensagem explicando; os outros itens continuam. |
| 9.14 | Exporte um backup do projeto, apague o projeto, importe o backup. | O projeto volta com todos os itens, ajustes e arquivos; abre na câmera igual ao original. |
| 9.15 | Em um navegador sem WebGL ou sem `ImageDecoder` (se tiver como testar). | Sem WebGL, o editor mostra aviso e segue com os controles. Sem `ImageDecoder`, o GIF fica parado, com aviso. |

### 9.16 a 9.23: Carrossel automático

Tenha 5 ou mais fotos (de preferência de câmera, grandes) e 1 PNG com transparência.

| # | O que fazer | Resultado esperado |
|---|---|---|
| 9.16 | No editor, escolha **uma** foto. | Entra como imagem comum, sem perguntar nada. |
| 9.17 | Escolha **3 ou mais** fotos de uma vez. | Aparece a pergunta "Como quer guardar esse momento?" com *Criar sequência automática*, *Guardar como N lembranças* e *Cancelar*; nada é gravado antes da resposta. Cancelar descarta. Numa seleção mista (fotos + um GLB), só o GLB entra na hora. |
| 9.18 | Escolha *Criar sequência automática*. | Uma lembrança "Carrossel · N imagens" fica selecionada, com a lista de imagens na ordem escolhida, tempo de cada imagem (padrão 3 s) e transição suave ligada. |
| 9.19 | Na prévia, toque "Reproduzir prévia". Mude o tempo (ex.: 1 s e 10 s) e desligue a transição. | As imagens trocam sozinhas na ordem, dando a volta no fim; o tempo muda ao vivo; sem transição a troca é seca. Anote se há tela preta/vazia ou travada entre imagens. |
| 9.20 | Acrescente imagens ao carrossel e remova uma do meio e a primeira. Tente remover até sobrar uma. | A lista e a prévia acompanham; com uma imagem só, "Remover" fica desativado. |
| 9.21 | Abra a câmera e aponte para a tatuagem; cubra-a e recupere. | O carrossel aparece ancorado e troca de imagem **só enquanto a tatuagem é vista**, continuando de onde parou ao recuperar. |
| 9.22 | Monte um carrossel com 15 a 30 fotos grandes e deixe rodar 2 a 3 voltas na câmera. | Anote: engasgos ao trocar, aumento de memória/aquecimento, fechamento do navegador, imagens puladas com aviso. (As imagens são reduzidas a 1536 px e só a atual e a próxima ficam na memória.) |
| 9.23 | Com o PNG transparente no carrossel e a transição ligada, observe a troca. | Esperado e documentado: durante ~0,6 s a imagem anterior aparece por trás das áreas transparentes da seguinte. Anote se incomoda. Exporte backup, apague o projeto e importe: o carrossel volta com todas as imagens, tempo e transição. |

### 9.24 a 9.26: layouts e apresentação

| # | O que fazer | Resultado esperado |
|---|---|---|
| 9.24 | Experimente Mural, Arco, Composição livre e Roda de lembranças; cancele uma prévia e use outra, Desfazer e Refazer. | O cancelamento restaura a disposição anterior; confirmar preserva as lembranças e permite desfazer/refazer. |
| 9.25 | Inicie a apresentação; pause, avance, volte, altere o intervalo e comece a arrastar. | A câmera percorre os itens suavemente, o intervalo muda, e a apresentação pausa ao editar. |
| 9.26 | Repita seleção, arrasto, layouts e player com largura de celular; habilite movimento reduzido no sistema. | Barra de controles cabe na largura; dois dedos ajustam tamanho/giro; movimentos de foco ficam instantâneos com movimento reduzido. |

Não testado nem previsto: iOS/Safari. Se for o seu caso, anote tudo o que falhar.

## Parte 10: Giroscópio (estabilização opcional)

Pré-requisito: Partes 2 e 3 já passando (o rastreamento sem giroscópio reconhece a
tatuagem). Teste sempre **comparando ligado × desligado** na mesma tatuagem, mesma luz
e mesmos movimentos. Anote o aparelho, o navegador e o sistema.

| # | O que fazer | Resultado esperado |
|---|---|---|
| 10.1 | Abra a câmera. Veja se existe o botão "Giroscópio: desligado" (habilita quando a câmera fica pronta). Em PC/aparelho sem sensor ele não aparece. | Aparece só onde há sensor. Anote onde sumiu. |
| 10.2 | Toque no botão. | Android: liga direto. iOS: aparece a pergunta de permissão. Negar mostra "A permissão do giroscópio foi negada." e o botão fica desligado. Sensor sem dados mostra a mensagem de "sem dados". |
| 10.3 | Com a tatuagem reconhecida e o celular parado na mão, observe o item por 20 s: desligado × ligado. | Ligado deve tremer **menos**. Anote se notou diferença e se parece "pesado/atrasado". |
| 10.4 | Gire o celular devagar e depressa (panorâmica horizontal, vertical e girando a tela) mantendo a tatuagem à vista. | O conteúdo deve ficar colado na tatuagem, sem "nadar" entre as leituras. Se ele se **afasta** da tatuagem ao girar (sentido invertido) ou se movendo em outro eixo, anote o aparelho: indica eixo/sinal diferente do esperado. |
| 10.5 | Repita 10.4 com o celular em modo paisagem (e girando a tela entre retrato e paisagem). | Mesmo resultado nas duas orientações. |
| 10.6 | Aproxime e afaste o celular da tatuagem, e ande de lado (deslocamento, não giro). | Sem vantagem esperada (só rotação é compensada); confira que **não piora** em relação ao desligado. |
| 10.7 | Cubra a tatuagem por ~0,5 s e depois por ~3 s com a mão, e descubra. | Ligado: em 0,5 s o conteúdo segue o celular e volta sem piscar nem avisar "perdido"; em 3 s some após ~0,8 s e o aviso de perda aparece. Desligado: some logo. Anote se o conteúdo "flutua" para longe da tatuagem durante o 0,8 s. |
| 10.8 | Vídeo/áudio/GIF/carrossel no projeto: perca e recupere a tatuagem rapidamente (< 0,8 s) e demoradamente. | Em perdas curtas a mídia não pausa; em longas pausa depois do prazo. |
| 10.9 | Deixe ligado 5 minutos balançando o celular. | Se o app avisar "o giroscópio deste aparelho não concordou com a câmera", anote em que situação (o aviso é o mecanismo de segurança). Anote aquecimento e fluidez (atualizações/s) comparando com desligado. |
| 10.10 | Feche e reabra a câmera. | Android: religa sozinho quando a câmera fica pronta. iOS: pede um toque ("Toque em Giroscópio para religar"). |

Com base nisto dá para ajustar os números (peso 0,6; prazo 800 ms; limites 8° e 0,25)
ou concluir que o giroscópio não compensa naquele aparelho.

## Parte 11: Detecção flexível (ângulos, pele esticada, luz)

Compare **alvo novo (com variantes)** × **alvo antigo** (compilado antes deste recurso, ou
com a caixa de ângulos desmarcada) na MESMA tatuagem. Os números do laboratório são
sintéticos; aqui é que se descobre se vale na pele real. Anote aparelho, navegador e luz.

| # | O que fazer | Resultado esperado |
|---|---|---|
| 11.1 | Crie um alvo e olhe "Rastreio: N pontos de apoio". | N ≥ 8 sem aviso. Com aviso (poucos pontos), teste mesmo assim e anote se o conteúdo fixa. |
| 11.2 | Abra um projeto antigo. | Aparece a dica de recompilar; recompilar leva alguns segundos a mais e o arquivo cresce (~2×). |
| 11.3 | Incline o celular em relação à tatuagem: 30°, 45°, 60°, 70°. | O novo reconhece em ângulos maiores que o antigo. Anote o ângulo em que cada um falha. |
| 11.4 | Estique a pele (abrir a mão, flexionar braço/joelho, esticar o tecido onde a tatuagem está) e achate (dobrar/encolher). | O conteúdo acompanha a tatuagem esticada sem sumir; pode ficar deformado junto. Anote o quanto de esticada aguenta. |
| 11.5 | Sombra da sua mão/celular sobre metade da tatuagem; luz de lado; contra-luz; lanterna. | Reconhece e mantém. Anote o que derruba. |
| 11.6 | Pouca luz (ambiente escuro) e câmera com ruído. | Pode ficar pior que com luz boa; anote se piora em relação ao alvo antigo. |
| 11.7 | Deixe a câmera procurando (sem tatuagem à vista) por 2 min e olhe fluidez e calor. | Sem travar nem aquecer demais; compare com o alvo antigo. |
| 11.8 | Reconhecimento com a tatuagem parada: tempo até o conteúdo aparecer. | Algumas dezenas de quadros no máximo; anote se o novo demora mais que o antigo. |

## Parte 12: Estabilidade do rastreio, editor e visual novo

Nada disto foi medido em aparelho real. Anote aparelho, navegador e luz.

| # | O que fazer | Resultado esperado |
|---|---|---|
| 12.1 | Câmera parada apontando para a tatuagem (apoie o celular), 30 s. | O conteúdo fica firme: tremor de poucos pixels no máximo. Anote se ainda treme (e quanto). |
| 12.2 | Mova o celular devagar e depressa. | O conteúdo acompanha sem "arrastar" atrás. Anote se há atraso perceptível. |
| 12.3 | Cubra a tatuagem por ~0,3 s com a mão e descubra. | Nada pisca; vídeo/áudio não pausam e retomam. Cubra por 2 s: some e volta. |
| 12.4 | Olhe a tela da câmera: só o indicador de estado e dicas, sem números mudando. | "Diagnóstico" mostra perdas/recuperações/atualizações por segundo quando ligado. |
| 12.5 | Editor: a prévia fica fixa no topo enquanto você rola os controles. | Dá para ajustar tamanho/giro vendo o resultado. |
| 12.6 | Arraste um item perto do centro e das bordas do alvo. | Ele gruda; a cruz do centro acende; vibração curta (Android). |
| 12.7 | Setas: toque e segure; ligue "Passo fino". | Move 1% por passo (0,2% no fino) e repete ao segurar. |
| 12.8 | Botões +/− de Tamanho e Giro, "Centralizar", "−15°/+15°", "100%". | Cada um faz só o que diz. |
| 12.9 | Desfazer/refazer (setas no topo) depois de arrastar e de mexer em sliders. | Cada gesto contínuo volta de uma vez; um ajuste novo depois de desfazer apaga o "refazer". |
| 12.10 | Use o app com uma mão no celular: alcança os botões principais? | Anote o que ficou difícil de alcançar. |

## Critérios propostos para considerar o rastreamento validado

**Proposta para sua aprovação, não uma regra estabelecida.** O rastreamento só
deve ser dado como validado se, em pelo menos uma tatuagem real:

1. 2.6 passa (alvo reutilizado sem recompilar);
2. 3.2 e 3.3 passam (reconhece e a moldura coincide com a imagem);
3. 3.4 passa (acompanha o movimento sem escorregar de forma grave);
4. 4.1 a 4.3 passam (perde, avisa e recupera);
5. as condições da Parte 5 ficam documentadas, inclusive as que falharam.

As Partes 7 (projetos salvos e backup) e 9 (cena 3D e editor) são independentes: elas validam a
**persistência** e a **cena**, não o rastreamento. Passar nelas não valida o rastreamento, e
vice-versa.

Falhas na Parte 5 (por exemplo, curvatura) não impedem a validação, mas precisam
constar na documentação como limitação.

## Registro do ambiente

- Aparelho / modelo:
- Android / versão do Chrome:
- Commit testado (`git rev-parse --short HEAD`):
- Data:
- Tatuagem testada (região do corpo, tamanho aproximado, nível de detalhe):
- Tempo de compilação (2.2):
- Tamanho do `.mind`:
- Itens usados na Parte 9 (tipos, tamanhos):
- Observações gerais:
