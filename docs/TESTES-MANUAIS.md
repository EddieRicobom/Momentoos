# Roteiro de testes manuais (Etapas B, C e D)

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
| 7.2 | Feche a aba/app por completo e abra de novo; vá em "Meus projetos" | O projeto aparece com miniatura, nome, data e situação "Pronto" | |
| 7.3 | Toque "Abrir câmera" no projeto | Abre sem recompilar (sem barra de progresso de compilação) e segue o fluxo da Parte 3 | |
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
| 9.1 | "Meus projetos" → **Adicionar itens**. Adicione os arquivos acima (vários de uma vez). | Cada arquivo vira um item na lista, com o tipo certo; o último fica selecionado. Anote qualquer arquivo recusado ou que não apareceu na prévia. |
| 9.2 | Tente adicionar um `.mov`, um `.gltf`, um arquivo renomeado (um PNG chamado `.glb`) e um arquivo maior que 48 MB. | Cada um é recusado com mensagem clara; os demais itens do lote entram normalmente. |
| 9.3 | Leia o texto sobre YouTube na tela. | Avisa que YouTube/links não são suportados e como usar um vídeo. |
| 9.4 | Na prévia, toque num item e arraste. Troque entre "De frente" e "Inclinada". | O item acompanha o dedo; a vista inclinada mostra a profundidade; tocar no vazio desmarca. Anote se o arrasto é preciso e se atrapalha a rolagem da página. |
| 9.4b | Com um item selecionado, ponha **dois dedos** na prévia (em qualquer lugar, até fora do item) e gire. Teste também com o primeiro dedo em área vazia. | O item gira no plano dele (giro em Z) acompanhando os dedos, no mesmo sentido; o controle "Giro" acompanha; o item continua selecionado; soltar um dedo encerra o giro sem mover o item. Anote se o sentido está natural, se a rolagem da página interfere e se o gesto fica ruim na vista inclinada. Afastar os dedos aumenta o item e aproximar diminui (limites 0,05× a 5×); o controle "Tamanho" acompanha. Gire e afaste ao mesmo tempo para conferir que os dois funcionam juntos. |
| 9.5 | Mexa em cada controle (posição, altura, giro, inclinação, tamanho, opacidade, volume, ajuste fino). | O item muda ao vivo; "Alterações não salvas" aparece; "Desfazer alterações" volta ao salvo. |
| 9.6 | Toque em "Reproduzir mídia". | GIF anima, vídeo toca, GLB anima, áudio toca. "Pausar mídia" para tudo. Anote o que não tocou. |
| 9.7 | Ajuste algo, toque em **Salvar**, saia do editor e volte. Depois ajuste de novo e saia com o botão voltar do aparelho SEM salvar. | O salvo permanece. O pendente é gravado ao sair (aviso "Ajustes da cena salvos"). |
| 9.8 | Duplique um item; remova outro (com a confirmação). | A cópia aparece deslocada e funciona independente; o removido some e, em Configurações, o uso de armazenamento diminui. |
| 9.9 | "Abrir câmera" a partir do projeto e aponte para a tatuagem. | Os itens carregam ("Carregando itens: x/y") e aparecem sobre a tatuagem quando ela é reconhecida. A posição relativa bate com o que você montou na prévia (dentro do recorte). O botão "Moldura de teste" liga/desliga a moldura. |
| 9.10 | Vídeo, áudio, GIF e animação do GLB: perca a tatuagem (cubra-a) e recupere. | Tocam ao reconhecer, **pausam ao perder** e continuam ao recuperar. Se o navegador bloquear o som, aparece "Tocar áudio e vídeo" e o toque libera. |
| 9.11 | Um modelo GLB: confira a orientação e o tamanho. | O modelo aparece "em pé" sobre a pele, com o maior lado do tamanho da metade do recorte (escala 1). Anote se está de cabeça para baixo ou girado. |
| 9.12 | Adicione 10 e depois 30 itens (misture imagens, 2–3 vídeos, 1–2 modelos). Abra a câmera e observe "atualizações/s" e a fluidez. | Anote o ponto em que fica lento, esquenta ou fecha o navegador. |
| 9.13 | Um GLB com compressão Draco (se tiver). | Item marcado com erro e mensagem explicando; os outros itens continuam. |
| 9.14 | Exporte um backup do projeto, apague o projeto, importe o backup. | O projeto volta com todos os itens, ajustes e arquivos; abre na câmera igual ao original. |
| 9.15 | Em um navegador sem WebGL ou sem `ImageDecoder` (se tiver como testar). | Sem WebGL, o editor mostra aviso e segue com os controles. Sem `ImageDecoder`, o GIF fica parado, com aviso. |

Não testado nem previsto: iOS/Safari. Se for o seu caso, anote tudo o que falhar.

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
