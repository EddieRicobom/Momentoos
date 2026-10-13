# Roteiro de testes manuais (Etapa B)

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

## Critérios propostos para considerar o rastreamento validado

**Proposta para sua aprovação, não uma regra estabelecida.** O rastreamento só
deve ser dado como validado se, em pelo menos uma tatuagem real:

1. 2.6 passa (alvo reutilizado sem recompilar);
2. 3.2 e 3.3 passam (reconhece e a moldura coincide com a imagem);
3. 3.4 passa (acompanha o movimento sem escorregar de forma grave);
4. 4.1 a 4.3 passam (perde, avisa e recupera);
5. as condições da Parte 5 ficam documentadas, inclusive as que falharam.

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
- Observações gerais:
