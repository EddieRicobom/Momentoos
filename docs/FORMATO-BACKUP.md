# Formato de armazenamento e de backup

Este documento descreve como o app guarda os projetos no aparelho (IndexedDB) e
o formato do arquivo de backup (`.tattoo-ar.zip`). Ele descreve o que o código
das Etapas C e D1 faz hoje; foi conferido contra o código e os testes automatizados,
**não** contra um navegador real (ver "O que não foi validado").

## 1. Armazenamento local (IndexedDB)

Banco `tattoo-ar`, esquema versão 1, com dois stores:

| Store | Chave | Conteúdo |
|---|---|---|
| `projects` | `id` | Metadados do projeto (JSON): nome, datas, descrição do alvo e da foto e a **cena** (lista de itens com seus ajustes). **Sem** os arquivos. |
| `files` | `"<id>/anchor"`, `"<id>/referenceImage"` ou `"<id>/item:<itemId>"` | Os bytes (`ArrayBuffer`) e o tipo MIME do alvo `.mind`, da foto de referência e de cada item da cena. |

Regras:

- Registro e arquivos de um projeto são gravados **na mesma transação**: ou
  entra tudo ou nada. Um erro de gravação (por exemplo, falta de espaço) não
  deixa projeto pela metade.
- Excluir apaga o registro e **todos** os arquivos do projeto (alvo, foto e itens, achados pelo prefixo `<id>/`) na mesma transação.
- Adicionar, remover ou duplicar um item grava o registro e o arquivo do item juntos, também numa transação só.
- O `id` tem 32 caracteres hexadecimais aleatórios (`crypto.getRandomValues`).
- Cada arquivo tem tamanho e SHA-256 no registro. Ao abrir o alvo, o app
  confere tamanho, hash e versão do `.mind` antes de usá-lo. Se algo não
  confere, o app não abre o alvo e oferece **recompilar** a partir da foto de
  referência (quando existir).

### Versões

Há duas versões independentes:

- **Esquema do IndexedDB** (`DB_VERSION`, hoje 1): estrutura de stores.
- **Formato do projeto** (`formatVersion` em cada registro, hoje 3): conteúdo
  do registro. Existe uma cadeia de migrações; a 1→2 troca o antigo campo
  `content` (que nunca guardou nada além de "nenhum") por uma `scene` vazia; a 2→3
  acrescenta `options.intervalMs` e `options.fade` (carrossel) aos itens
  existentes, com os valores padrão (3000 ms, transição ligada). Um registro
  de versão **mais nova** que a do app não é alterado nem apagado: aparece na
  lista como "Versão mais nova" e o app manda atualizar.

Um registro que não passa na validação aparece como "Ilegível" e é mantido; só
some se você mandar excluir.

### A cena (itens)

`scene.items` é a lista, em ordem, dos itens ancorados na tatuagem. Cada item:

| Campo | Significado |
|---|---|
| `id` | 1 a 64 caracteres `A-Za-z0-9_-` (o app gera 16 hexadecimais) |
| `type` | `image`, `gif`, `video`, `model` (GLB), `audio` (mp3, ogg, wav, m4a) ou `carousel` (várias imagens que se alternam) |
| `name`, `visible` | Nome de exibição e se aparece |
| `file` | `mimeType`, `size`, `sha256`, `fileName` e, quando conhecidos, `width`, `height`, `durationMs` |
| `transform` | `scale`, `rotation` (graus, x y z), `position` (x y z, em larguras do alvo) e `offset` (x y z, em larguras do alvo) |
| `options` | `opacity`, `loop`, `muted`, `volume`, `animate`, `clip` (nome da animação do GLB ou `null`), `intervalMs` (500 a 60000; só vale para carrossel) e `fade` (só carrossel). Campos opcionais: `motion` (`none`, `float`, `orbit`, `sway`) e `motionSpeed` (0,25 a 2). Ausência equivale a parado e velocidade 1. |
| `slides` | Só em `carousel`: lista ordenada de imagens, cada uma com `slot` (inteiro 0 a 9999, único no item; identifica o arquivo e não muda quando outras imagens saem) mais os campos de `file` |

No carrossel, `file` é uma cópia da primeira imagem de `slides` (sem `slot`) e é
validado como igual a ela. Cada imagem é PNG, JPG ou WebP (GIF e vídeo não).
Limites do carrossel: 30 imagens e 100 MiB somados (cada imagem também respeita
os 48 MiB por arquivo). Cada imagem fica guardada no banco sob a chave
`item:<itemId>~<slot>`.

Limites: até 100 itens por projeto (um carrossel conta como um) e 48 MiB por arquivo de item. O tipo vem da
extensão do arquivo e o conteúdo é conferido pela "assinatura" (primeiros
bytes) do formato; isso evita extensão trocada, mas **não** garante que o
navegador consiga decodificar o arquivo. YouTube/links não são itens (precisam
de internet e de um iframe, que não entra na cena 3D).

O sistema de coordenadas é o do MindAR: origem no centro do alvo, 1 unidade =
largura do alvo, +z para fora da pele.

### Situação de cada projeto

| Situação | Quando | O que o app oferece |
|---|---|---|
| Pronto | Há alvo no formato atual e o arquivo existe | Abrir câmera |
| Precisa recompilar | Alvo ausente ou em formato incompatível, mas há a foto de referência | Recompilar |
| Incompleto | Sem alvo utilizável e sem foto | Só renomear/excluir |

"Pronto" significa que os arquivos existem e a versão confere. A conferência de
hash acontece ao abrir (e pode revelar corrupção que a lista não mostra).

## 2. Arquivo de backup

Extensão `.tattoo-ar.zip`; é um ZIP comum (compressão deflate). Estrutura:

```
manifest.json
projects/
  <id>/
    project.json
    anchor.mind               (se houver alvo íntegro)
    reference-image.png|jpg|webp|bin   (se houver foto de referência)
    items/<itemId>.<ext>      (formato 2: um arquivo por item da cena)
    items/<itemId>~<slot>.<ext>  (formato 3: uma imagem de carrossel)
```

A extensão da foto vem do tipo MIME (`image/png`→png, `image/jpeg`→jpg,
`image/webp`→webp, qualquer outro→bin). A de cada item também (png, jpg, webp,
gif, mp4, webm, glb, mp3, ogg, wav, m4a; `bin` para tipo inesperado).

### manifest.json

```json
{
  "format": "tattoo-ar-backup",
  "formatVersion": 3,
  "createdAt": "2026-10-13T18:30:00.000Z",
  "app": { "name": "momentoos", "version": "0.1.0" },
  "projects": [
    {
      "id": "<32 hex>",
      "name": "Braço",
      "dir": "projects/<id>",
      "project":        { "path": "projects/<id>/project.json", "size": 812, "sha256": "<64 hex>" },
      "anchor":         { "path": "projects/<id>/anchor.mind", "size": 1234567, "sha256": "<64 hex>" },
      "referenceImage": { "path": "projects/<id>/reference-image.png", "size": 345678, "sha256": "<64 hex>" },
      "items": [
        { "id": "<itemId>", "file": { "path": "projects/<id>/items/<itemId>.glb", "size": 98765, "sha256": "<64 hex>" } },
        { "id": "<carrosselId>", "slides": [
          { "slot": 0, "file": { "path": "projects/<id>/items/<carrosselId>~0.png", "size": 4321, "sha256": "<64 hex>" } },
          { "slot": 2, "file": { "path": "projects/<id>/items/<carrosselId>~2.jpg", "size": 5432, "sha256": "<64 hex>" } }
        ] }
      ]
    }
  ]
}
```

`items` só existe quando a cena tem itens. Um item de arquivo único traz `file`; um carrossel traz `slides` (nunca os dois). `anchor` e `referenceImage` são omitidos quando não há o arquivo (ou quando ele
foi deixado de fora por estar corrompido). `name` no manifesto é só para quem
abrir o arquivo à mão; o nome de verdade está em `project.json`.

### Exportação

- Só entra no ZIP o que está íntegro: um arquivo cujo tamanho ou SHA-256 não
  confere com o registro é deixado de fora **com aviso**, em vez de ser copiado
  corrompido sem ninguém saber. O mesmo vale para os itens: um item cujo
  arquivo falta ou não confere sai da cena exportada, com aviso, e o resto do
  projeto segue. Um alvo corrompido de um projeto que tem foto
  vira projeto "Precisa recompilar" no backup.
- Registros ilegíveis, de versão mais nova ou sem nenhum arquivo íntegro não
  entram, e são listados no resultado.
- Nome do arquivo: `tattoo-ar-backup-AAAAMMDD-HHMM.tattoo-ar.zip` (horário local).
- **O ZIP não é criptografado e contém a foto da tatuagem.** A tela de
  exportação avisa disso.

### Importação (o ZIP é tratado como entrada não confiável)

1. Limites antes de qualquer descompactação: ZIP até 256 MiB; manifesto até
   2 MiB; até 200 projetos; cada arquivo até 64 MiB; soma até 512 MiB;
   `project.json` até 256 KiB. Passou do limite: a importação é recusada.
2. Primeira passada: só o `manifest.json` é descompactado; qualquer outra
   entrada do ZIP é ignorada sem ser lida.
3. O manifesto é validado: formato e versão (versão mais nova → mensagem para
   atualizar o app), ids seguros (sem `/`, `..` etc.), caminhos **exatamente**
   iguais aos esperados para aquele id (nada de `../` ou caminho de outro
   projeto), extensão permitida (imagem ou item), tamanhos inteiros e hashes de 64
   hexadecimais, ids sem repetição.
4. Segunda passada: só os caminhos declarados, e só se o tamanho dentro do ZIP
   for igual ao declarado. Arquivos extras no ZIP nunca são lidos.
5. Por projeto: confere o SHA-256 do `project.json`, valida o conteúdo (mesma
   validação dos registros locais), confere o id contra o manifesto, e confere
   tamanho e SHA-256 do alvo, da foto e de cada item da cena (e, nos itens, a
   assinatura do formato). O cabeçalho do `.mind` também é
   verificado (versão do formato do MindAR). Arquivo que não confere é
   **descartado com aviso**; o projeto só entra se sobrar o alvo ou a foto. Um
   item descartado sai da cena do projeto importado (não fica item sem arquivo).
6. Um projeto ruim não impede a importação dos outros; ele aparece como "não
   importado" com o motivo.

Colisão de id (já existe um projeto com o mesmo id):

- Idêntico (mesma data de atualização e mesmos hashes): **não importa**, avisa
  que já existe. Importar o mesmo backup duas vezes é seguro.
- Diferente: entra como **cópia** com id novo e o nome ganha " (importado)".
  Nada do que já existe é sobrescrito.

Limitação conhecida: reimportar várias vezes um backup cujo projeto original
foi alterado depois cria uma nova cópia a cada vez.

### Compatibilidade

- O app lê backups dos formatos **1, 2 e 3**. Um backup 1 (sem itens) entra com
  cena vazia; o `project.json` antigo é migrado na leitura.
- Um carrossel só entra no backup (e só é importado) se **todas** as imagens
  estiverem íntegras; se uma falhar, o carrossel inteiro fica de fora, com aviso.
- Backups exportados pelo formato 3 **não** abrem em versões antigas do app
  (elas recusam por formato mais novo, sem perder nada).
- Backup de formato maior que o conhecido é recusado com pedido para atualizar.

## 3. O que não foi validado

- Tudo acima foi exercitado por testes automatizados com IndexedDB **simulado**
  (`fake-indexeddb`) e DOM **simulado** (`happy-dom`). Nenhum teste rodou em
  navegador ou celular reais.
- Não foi medido o comportamento com arquivos grandes (dezenas de MB) em celular,
  nem a cota real do navegador.
- O pedido de armazenamento persistente (`navigator.storage.persist()`) é um
  pedido; o navegador decide e pode negar. O backup é a proteção real.
- Não foi medido o custo de backups com muitos itens grandes (vídeos, GLB) em celular; o limite de 48 MiB por item e 512 MiB no total é uma salvaguarda, não um valor testado em aparelho.
- O download do ZIP e a escolha do arquivo na importação dependem do
  comportamento do navegador do celular (pasta de downloads, seletor de arquivos).
