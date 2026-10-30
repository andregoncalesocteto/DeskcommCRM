# Integração do cardápio digital com o CRM via MCP — Bella Capri

Guia para o time do cardápio. O cardápio avisa o CRM do que o cliente faz (abriu, viu produto, pôs no carrinho,
revisou, comprou, cancelou) e o CRM move o card do pedido no funil.

> Tudo aqui foi **testado contra uma instalação local em 28 e 29/10/2026** (token temporário, depois apagado). O que
> não foi testado está marcado como **não testado**.

> ⚠️ **`crm_add_lead_events` ainda não está no produto publicado.** É a ferramenta que guarda `page_view` e
> `view_item` sem substituir o anterior. Ela está no código da instalação local da Bella Capri (commit
> `ce188709d` na `main` local, sem push nem PR) e roda nessa instalação. Numa instalação sem ela, `tools/list` não a
> mostra e a chamada falha. Enquanto isso, o plano B está na seção 5 ("Enquanto a ferramenta não está instalada").

---

## 1. Visão geral

```
Cliente ──WhatsApp──► Bella (CRM) ──► link  https://rpa.bellacapri.com.br/?idtrack=<id do contato>
                                                        │
Cliente abre o link ────────────────────────────────────┘
        │
        ▼
Cardápio (SERVIDOR) ──POST /api/mcp (Bearer dsk_…)──► CRM
   1. crm_get_contact        → telefone (login do cardápio sem digitar de novo)
   2. crm_list_leads         → acha o pedido (negócio) aberto desse contato
   3. crm_add_lead_events    → page_view e view_item: cada um vira UMA linha nova (nunca substitui)
   4. crm_update_lead        → cart_sync, begin_checkout e purchase: o ESTADO atual, com o JSON guardado
   5. crm_move_lead_stage    → Visitas → Visualizações → Carrinho → Revisão → Compras | Cancelado
```

- O **`idtrack` é o id do contato** no CRM (UUID), não o id do pedido. O link é estável: o mesmo cliente recebe
  sempre o mesmo `idtrack`, mesmo em pedidos diferentes.
- O **pedido** (negócio) nasce no CRM, na etapa **Conversas**, quando o cliente escreve e ainda não tem pedido
  aberto. O cardápio **não cria** negócio: ele só o encontra e o move.
- **Valide o `idtrack` antes de usar:** ele tem que ser um UUID. Se vier outra coisa (um telefone, vazio), não
  consulte o CRM nem grave nada: caia no login manual. Já aconteceu de a Bella montar o link com o telefone no lugar
  do id (29/10); o telefone na URL também vaza dado pessoal em log. Para isso não se repetir, o motor da Bella
  passou a preencher o id no envio (marcador `{{id_do_contato}}` no prompt), em vez de o modelo copiá-lo.
- Toda chamada ao CRM sai do **servidor** do cardápio. O token **nunca** vai para o navegador do cliente nem para a
  URL.

---

## 2. Pré-requisitos (uma vez por loja)

Cada loja é um tenant isolado no CRM, com seu próprio token e seus próprios ids de etapa.

1. No CRM, entre como administrador da loja e abra **API Tokens** (`/app/settings/api-tokens`).
2. **Criar token**: dê um nome (ex.: `Cardápio digital`), marque os escopos
   **"Agentes de IA podem LER o CRM (MCP)"** (`mcp:read`) e **"Agentes de IA podem AGIR no CRM (MCP)"** (`mcp:write`).
   Não marque `role:manager` nem `role:admin`: não são necessários. Expiração é opcional.
3. **Copie o token na hora**: ele (`dsk_…`) só é mostrado uma vez. O CRM guarda apenas o hash.
4. Guarde em variável de ambiente do servidor do cardápio, por loja, por exemplo `CRM_MCP_TOKEN`.
   Nunca no repositório, no front-end ou em query string.
5. Anote o **id do funil** e os **ids das etapas** da loja (seção 5). Eles são diferentes em cada loja.

---

## 3. O protocolo

O endpoint é **MCP sobre HTTP** (JSON-RPC 2.0, transporte "Streamable HTTP"), **sem estado**: cada requisição é
independente.

| Item | Valor |
|---|---|
| URL | `POST {base_url}/api/mcp` (local: `http://localhost:3000/api/mcp`) |
| `Authorization` | `Bearer dsk_…` |
| `Content-Type` | `application/json` |
| `Accept` | **`application/json, text/event-stream`** — obrigatório (sem os dois, 406) |
| Corpo | envelope JSON-RPC: `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"…","arguments":{…}}}` |

Pontos que pegam quem usa o protocolo pela primeira vez:

- **A resposta vem em SSE**, não em JSON puro. O corpo é assim:
  ```
  event: message
  data: {"result":{…},"jsonrpc":"2.0","id":1}
  ```
  Leia a linha que começa com `data: ` e faça `JSON.parse` do que vem depois.
- **Não precisa de `initialize` antes.** Foi testado: `tools/list` e `tools/call` funcionam direto, e cada
  requisição é autônoma. (Se o seu cliente MCP insistir em `initialize`, funciona também.)
- O resultado de uma ferramenta vem em `result.structuredContent` (objeto) e também, como texto JSON, em
  `result.content[0].text`. Use o `structuredContent`.
- **Erro de ferramenta** não é erro HTTP: vem com status 200 e `result.isError = true`, e a mensagem em
  `result.content[0].text`. Erro de **autenticação** é HTTP (401/403/429) com envelope
  `{"jsonrpc":"2.0","error":{"code":-32001,"message":"…"},"id":null}`.

### Exemplo mínimo (Node 18+)

```js
async function mcp(name, args) {
  const r = await fetch(`${process.env.CRM_BASE_URL}/api/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CRM_MCP_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!r.ok) throw new Error(`MCP HTTP ${r.status}: ${await r.text()}`);
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  const msg = JSON.parse(line.slice(6));
  if (msg.error) throw new Error(msg.error.message);
  if (msg.result.isError) throw new Error(msg.result.content[0].text);
  return msg.result.structuredContent;
}
```

---

## 4. As ferramentas que o cardápio usa

Todas aceitam o token com `mcp:read` (leitura) ou `mcp:write` (escrita).

### 4.1 `crm_get_contact` — telefone do cliente
Entrada: `{ "contact_id": "<idtrack>" }`
Saída (`structuredContent`), campos úteis: `id`, `name`, `phone` (formato `+5517982290042`), `is_personal`, `is_blocked`.

- Use o `phone` para o **login do cardápio**, sem pedir o número de novo.
- **Contato marcado como "pessoal"** (família/equipe da loja) é **recusado**: `isError: true`, mensagem "este
  contato foi marcado como pessoal…". Nesse caso, caia no login manual.
- Não grave o telefone em log nem na URL (LGPD).

### 4.2 `crm_list_leads` — acha o pedido aberto do contato
Entrada: `{ "status": "open", "stage_id": "<id da etapa>", "limit": 100, "cursor": "<opcional>" }`
Saída: `{ "leads": [ … ], "cursor": "…", "has_more": false }`. Cada item traz `id` (**o id do pedido**),
`contact_id`, `status`, `stage` (`{id, name}`), `pipeline_id` etc.

⚠️ **Não existe filtro por contato.** O cardápio filtra do lado dele: percorra `leads` e escolha o de
`contact_id == idtrack`. Por isso:

1. Na primeira visita, o pedido está em **Conversas**: consulte `stage_id = <Conversas>`.
2. Se não achar (visita repetida, ou o pedido já avançou), consulte as outras etapas abertas
   (Visitas, Visualizações, Carrinho, Revisão, Chamar Humano), ou guarde o `id` do pedido no seu lado assim que o
   achar (cache por `idtrack`) e reuse nas visitas seguintes.
3. Se `has_more = true`, siga com `cursor` até acabar.
4. Se houver mais de um pedido aberto do mesmo contato, vale o **mais recente** (`created_at`).
5. **Não achou nenhum aberto** → o cliente já concluiu/cancelou o pedido anterior e ainda não escreveu de novo
   (um pedido novo só nasce quando ele escreve). Não crie nada: ignore o evento. O cardápio pode seguir normal.

### 4.3 `crm_move_lead_stage` — move o pedido
Entrada:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `lead_id` | sim | id do **pedido** (o `id` de `crm_list_leads`), não o `idtrack` |
| `to_stage_id` | sim | id da etapa de destino |
| `reason` | não | texto livre (até 500), vai para a auditoria — ex.: `page_view` |
| `won_reason` | não | desligado nesta loja; não precisa mandar |
| `lost_reason` | **sim, para Cancelado** | um dos motivos da lista (abaixo) |
| `position_in_stage` | não | posição no quadro; deixe de fora |

Saída: `{ "lead": { …o pedido atualizado… } }`.

Comportamentos **testados**:
- Mover para a etapa **em que o pedido já está** é aceito e devolve o pedido (não dá erro): é seguro repetir.
- **Cancelado sem `lost_reason`** → `isError`, "Informe o motivo da perda…". O pedido não muda.
- **`lost_reason` fora da lista** → `isError`, "Esse motivo de perda não está na lista deste funil…".
- Mover um pedido **já encerrado** para outra etapa **é aceito**: testado em 29/10, Compras → Cancelado passou sem
  erro e o pedido virou perdido. O CRM **não** impede isso por este caminho. A trava está no cardápio: depois de
  `purchase` ou `cancel`, não mova mais. (O guia dizia que seria recusado com `reabertura_cria_novo`; isso não
  acontece com este token.)

Motivos de perda aceitos (lista canônica; esta loja não tem lista própria): `requested_by_customer`, `price`,
`no_response`, `product_unavailable`, `cancelled_by_store`, `cancelled_by_customer`, `payment_failed`, `other`.
Para o evento `cancel`: use `cancelled_by_customer` (cliente desistiu) ou `payment_failed` (pagamento recusado).

### 4.4 `crm_update_lead` — grava os dados do item, do carrinho e da compra no pedido

O `crm_move_lead_stage` **não carrega dados**: o campo `reason` dele é só um texto curto de auditoria. Valor, itens e
detalhes da compra vão nesta segunda chamada (`mcp:write`).

Entrada (todos os campos, exceto `lead_id`, são opcionais; mande só o que mudou):

| Campo | Tipo | Para quê |
|---|---|---|
| `lead_id` | UUID | id do **pedido** (de `crm_list_leads`) |
| `value_cents` | inteiro ≥ 0 | valor do pedido em **centavos** (R$ 68,90 = `6890`) |
| `currency` | 3 letras | `BRL` |
| `description` | texto, até 2000 | resumo legível, ex.: `Carrinho: 1x Calabresa G (R$ 59,90) + 1x Guaraná 2L (R$ 9,00)` |
| `tags` | lista de textos | etiquetas para filtro, ex.: `["cardapio","add_to_cart"]` |
| `custom_fields` | objeto | campos personalizados do funil (abaixo) |
| `title`, `expected_close_date` | texto, `AAAA-MM-DD` | raramente úteis aqui |

Saída: `{ "lead": { …o pedido atualizado… } }`.

**Testado:** valor, descrição, tags e dois campos personalizados foram gravados; a atualização também funciona com o
pedido já **encerrado** (Compras). A linha do tempo do card registra só `lead_edited` com os **nomes** dos campos
alterados, não os valores: o dado está no pedido, não na timeline.

Cuidados:

- **`custom_fields` aparecem na ficha só se estiverem declarados** no funil (CRM › Ver tudo em CRM › Etapas do
  funil › campos). Chaves não declaradas **são aceitas e guardadas**, mas ficam invisíveis na tela. Declare antes.
  Tipos disponíveis: texto, texto longo, número, moeda, data, seleção, seleção múltipla, booleano, e-mail,
  telefone, URL e arquivo (até 50 campos por funil).
  Os campos a declarar para esta loja estão na seção 5 ("Campos a declarar").
- **JSON em `custom_fields`: testado, aceita objeto e array de verdade.** Um objeto ou array numa chave (declarada ou
  não) é gravado como JSON nativo (`jsonb`), e 20 mil caracteres cabem. Duas ressalvas: **o CRM não valida o tipo** pelo
  MCP (um texto numa chave declarada como Número foi gravado), e **a tela só mostra campo escalar**. Por isso o desenho
  usa as duas coisas: o JSON inteiro numa chave **não declarada** (invisível na ficha, consultável por SQL) e um
  resumo legível num campo declarado.
- **`tags`:** mande sempre a lista **completa** que o pedido deve ter. Não testei se a chamada soma ou substitui.
- **Dinheiro:** a fonte do valor é `value_cents`. Evite duplicar o total em um campo personalizado.
- **Pedido (ordem de registro) com itens, pagamento e entrega:** existe uma tabela `orders` no CRM, mas o MCP só
  **lê** (`crm_list_contact_orders`); não achei ferramenta de escrita. Se a loja quiser o registro completo do
  pedido dentro do CRM, é um recurso novo no núcleo, fora desta integração.
- **Comanda financeira ao ganhar** (`comanda_no_ganho`): opção do funil, desligada. **Deixe desligada**: o pedido do
  cardápio já chega pago, e a comanda ficaria aberta sem nada a cobrar.

### 4.5 `crm_add_lead_events` — registro que só cresce (page_view, view_item)

> **Para evento cadastrado no funil, prefira `crm_track_event` (seção 5-A).** Esta ferramenta continua existindo e é a
> certa para o fato que o funil não cadastrou: ela aceita qualquer nome, só grava no histórico e **não** move o pedido.

`crm_update_lead` **substitui** o campo; para o que precisa de **histórico** (cada visita, cada item visto) existe
esta ferramenta. Cada evento vira uma **linha nova** na linha do tempo do pedido, com a hora em que aconteceu e o JSON
que você mandou. Uma chamada nunca apaga nem substitui as anteriores.

Entrada:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `lead_id` | sim | id do **pedido** |
| `events` | sim | lista de 1 a **50** eventos, do mais antigo ao mais novo |
| `events[].event` | sim | nome do fato: minúsculas, números e `_`, começando por letra (`page_view`, `view_item`) |
| `events[].at` | não | quando aconteceu, ISO-8601 com fuso (ex.: `2026-10-28T17:59:00-03:00`). Ausente = agora. Aceita até 30 dias atrás e 5 min no futuro |
| `events[].event_id` | não, **recomendado** | id estável do fato no cardápio. Com ele, reenviar o lote **não duplica** |
| `events[].data` | não | o JSON do fato, como o cardápio o tem |

Saída: `{ "lead_id": "…", "registrados": 3, "repetidos": 0 }`.

Limites: 8 KB por evento, 64 KB por chamada. A chamada inteira conta **uma** escrita no teto do token (30/min),
qualquer que seja o lote.

**Testado ao vivo (28/10/2026, branch com a ferramenta):**
- 3 eventos enviados → `registrados: 3`; os 3 ficaram com a **hora do evento** (não a do envio) e o JSON intacto;
- o **mesmo lote reenviado** → `registrados: 0, repetidos: 3` (graças ao `event_id`);
- pedido inexistente → erro "Pedido não encontrado."; 51 eventos e nome de evento fora do padrão → recusados com a
  mensagem de validação;
- `last_activity_at` do pedido **não mudou**: estes registros não "esquentam" o negócio no Radar de Risco;
- cada chamada fica no Audit Log (`mcp.tool_called`).

**Testado de ponta a ponta (29/10/2026):** as requisições da pasta 3 da collection, rodadas em sequência contra a
instalação com a ferramenta: 2 `page_view` e 3 `view_item` viraram 5 linhas separadas, cada uma com o JSON; `cart`,
`checkout` e `pedido` ficaram completos em `custom_fields`; o pedido terminou em **Compras** (`won`) com
`value_cents` 7390. As consultas 7 e 11 do arquivo de relatórios devolveram os dados desse pedido.

**Onde os eventos ficam:** na tabela `crm_lead_activities` (a linha do tempo do pedido), em linhas com
`type = 'external_event'`. Não há tabela própria.

| Coluna | O que guarda |
|---|---|
| `payload->>'event'` | nome do fato (`page_view`, `view_item`) |
| `payload->'data'` | o JSON que o cardápio mandou |
| `payload->>'event_id'` | o id que impede registrar o mesmo fato duas vezes |
| `performed_at` | a hora do **evento** (o `at`) |
| `created_at` | a hora em que o CRM **recebeu** |
| `lead_id`, `contact_id`, `organization_id` | de quem e de qual loja é a linha |

Cuidados:
- **Sem `event_id`, o reenvio duplica.** O CRM não tem como saber que dois eventos iguais são o mesmo fato. Gere o id
  **na hora do evento** (por exemplo, `${sessao}-${contador}` ou um UUID) e reaproveite-o no reenvio.
- Duas chamadas **simultâneas** com o mesmo `event_id` podem gravar as duas (a checagem é ler e depois inserir, sem
  trava). Reenvie só depois de a primeira resposta chegar ou falhar.
- Pedido de contato marcado como **pessoal** é recusado (403 `contato_pessoal`).
- Pedido já **encerrado** (Compras/Cancelado) aceita registro: o histórico continua valendo (testado).
- Cada linha aparece na **linha do tempo do pedido** com o rótulo "Registro de uma integração". Um pedido com muitas
  visitas terá muitas linhas (não conferi como a tela lida com dezenas).

### 4.6 Consulta de ids em vez de fixá-los (opcional)
- `crm_list_pipelines` `{}` → `{ "pipelines": [ { "id", "name", "slug", "is_default" … } ] }`. Use o funil
  `is_default = true` ("Pedidos").
- `crm_list_stages` `{ "pipeline_id": "<id>" }` → `{ "etapas": [ { "id", "name", "slug", "is_won", "is_lost",
  "position" … } ] }`, na ordem do quadro. **Atenção ao nome da chave: `etapas`.**

⚠️ **Resolva etapa por `id` ou por `name`, nunca por `slug`.** Os slugs não acompanham os nomes (o funil foi renomeado
a partir de um modelo de loja virtual: "Conversas" tem slug `carrinho_abandonado`, "Compras" tem `pago`).

---

## 5. Etapas do funil e eventos do cardápio

> **Há duas formas de contar um evento ao CRM, e a seção 5-A é a recomendada.** A forma anterior (a ferramenta de cada
> etapa chamada à mão, com o mapa e a trava de "não retrocede" no cardápio) continua funcionando e está descrita logo
> depois da 5-A. Quem já a usa não precisa mudar de uma vez.

### 5-A. A forma recomendada: `crm_track_event` com os eventos cadastrados no funil

Em vez de o cardápio decidir, a cada evento, qual ferramenta chamar e para que etapa mover, **a loja cadastra uma vez,
na tela, os eventos que o funil aceita e para onde o pedido vai quando cada um chega**. O cardápio só conta o que
aconteceu, numa ferramenta só: `crm_track_event`. O CRM grava no histórico, guarda o último conteúdo, aplica o valor e
move o pedido, e **nunca o faz retroceder**.

> **Pelo navegador em vez do servidor.** Os mesmos cinco eventos podem ser contados por um script colado no site do
> cardápio (chave pública, sem token secreto), com as travas de segurança do navegador. O manual para o time do cardápio
> é o `manual-rastreador-cardapio.md`, nesta pasta. Escolha **uma** porta para a compra: o CRM não percebe a mesma
> compra chegando pelas duas.

**Cadastro (uma vez por loja):** `/app/settings/tenant/pipelines` › o funil **Pedidos** › seção **Para onde o card vai em
cada evento** › **Cadastrar um evento**. Nada vem pronto: cadastre à mão os cinco abaixo. Opções avançadas ficam
escondidas atrás de «Mostrar as opções avançadas».

| Nome na tela | Chave que o cardápio envia | O card vai para | Guardar o último conteúdo em | Campo do valor | Reconhecer o mesmo fato por | Respeitar o que a equipe moveu à mão |
|---|---|---|---|---|---|---|
| Visita | `page_view` | Visitas | — | — | — | ligado |
| Item visto | `view_item` | Visualizações | — | — | — | ligado |
| Carrinho | `cart_sync` | Carrinho | `cart` | — | — | ligado |
| Início do pagamento | `begin_checkout` | Revisão | `checkout` | `value` (em reais) | — | ligado |
| Compra concluída | `purchase` | Compras | `pedido` | `value` (em reais) | `order_id` | **desligado** |

Por que a compra é a única com «respeitar» desligado: ela precisa fechar a venda mesmo que alguém da equipe tenha movido
o pedido à mão depois (por exemplo, para Chamar Humano). Nos outros, se uma pessoa mexeu por último, o evento é gravado
mas não move.

Cuidados no cadastro:
- «Guardar em» **não pode** ter o mesmo nome de um campo da ficha (`cupom`, `itens`, `qtd_itens`…); `cart`, `checkout`
  e `pedido` são chaves livres, como na forma anterior. A tela bloqueia o conflito.
- Dois eventos guardando no **mesmo** «guardar em» só geram um aviso: o último que chegar sobrescreve o outro.
- O «Compra concluída» fecha a venda, então **precisa** do campo do valor; sem ele a tela avisa que a venda não será
  enviada como conversão.
- A chave de um evento que já recebeu algo não muda mais. Para parar de aceitar, **desative** (não apaga o histórico).
- O destino não oferece etapa de perda: o **cancelamento** continua por `crm_move_lead_stage` com `lost_reason`
  (seção 4.3), chamado só pelo servidor do cardápio.

**A chamada** (uma por lote, até 50 eventos, do mais antigo ao mais novo):

```json
{
  "lead_id": "<id do pedido>",
  "events": [
    { "event": "purchase", "event_id": "<id estável do fato>", "at": "2026-10-29T18:28:00-03:00",
      "data": { "order_id": "P-1042", "value": "73.90", "delivery_type": "delivery", "items": [] } }
  ]
}
```

`event_id` é **obrigatório** (diferente do `crm_add_lead_events`). `at` e `data` são opcionais. O valor aceita número ou
texto decimal («73.90»), sem teto.

**A resposta** traz **um resultado por evento**, na ordem enviada; um evento recusado nunca derruba os outros do lote:

| `resultado` | Significa | O que fazer |
|---|---|---|
| `registrado` | gravado; veja `estado`, `valor` e `movimento` (e `etapa` quando o pedido se moveu) | nada |
| `repetido` | o mesmo `event_id` (ou o mesmo `order_id`) já tinha chegado | nada: não é erro |
| `recusado` | não foi gravado; vem com `codigo` e `mensagem` | **não reenvie** (abaixo) |

> **A recusa é definitiva: não reenvie o mesmo evento esperando outro resultado.** Os códigos são
> `evento_nao_cadastrado` (a mensagem lista as chaves ativas do funil), `evento_inativo`, `evento_grande`,
> `hora_fora_da_janela` e `valor_invalido`. Reenviar devolve a mesma recusa e gasta uma escrita do teto. O conserto é
> **cadastrar ou ativar o evento na tela**, ou corrigir o dado no cardápio, e só então mandar um fato **novo**. Erro de
> rede ou 5xx é outra coisa: repita com o **mesmo** `event_id`, que é seguro.

`movimento` diz o que aconteceu com a etapa: `movido`, `ja_na_etapa_ou_adiante` (o pedido já estava naquela etapa ou
além: **não retrocede**), `respeita_movimento_manual`, `pedido_encerrado`, `sem_destino`, `etapa_arquivada`, `conflito`
ou `recusado_pelo_funil`. Pedido já em **Compras** ou **Cancelado** não muda de etapa, de valor nem de estado, mas o
histórico continua sendo gravado.

**Quando usar cada ferramenta de escrita de evento**

| Situação | Ferramenta |
|---|---|
| O funil cadastrou o evento (os cinco acima) | **`crm_track_event`** |
| Fato que o funil **não** cadastrou e que só interessa guardar no histórico | `crm_add_lead_events` (permissiva: aceita qualquer nome válido, não move, não guarda estado nem valor) |
| Campos da ficha (`itens`, `qtd_itens`, `tipo_entrega`, `cupom`, `forma_pagamento`, `subtotal_cents`, `frete_cents`, `desconto_cents`, `id_pedido_cardapio`) | `crm_update_lead` — o `crm_track_event` **não** preenche esses campos, só o conteúdo em «guardar em» e o valor |
| Cancelamento | `crm_move_lead_stage` com `lost_reason` |

Ou seja: quem quer a ficha legível (itens em texto, tipo de entrega…) segue mandando um `crm_update_lead` junto, ou lê o
JSON guardado em `cart`, `checkout` e `pedido`. Cada chamada de `crm_track_event` conta **uma** escrita (teto de 30/min por
token), qualquer que seja o tamanho do lote.

**Comparação rápida:** pela forma anterior, um pedido típico gasta ~9 escritas e a trava de "não retrocede" mora no
cardápio; com o `crm_track_event`, o mesmo pedido pode ser contado em ~5 chamadas (uma por evento, ou menos se agrupar) e a
trava mora no CRM. Medido ao vivo em 29/10/2026 (`evidence/eventos-do-funil/prova-mcp-direto-us012.md`), 12 passos, e
pela tela em `evidence/eventos-do-funil/verificacao-no-navegador-us016-us017.md`.

### 5-B. A forma anterior (continua válida)

Funil **Pedidos**. Quem avança cada etapa é o cardápio, exceto Conversas (nasce lá) e Chamar Humano (passagem da
Bella para a equipe).

**Ids da loja RPA - Abrão Thomé** (instalação de teste; em outra loja/instalação os ids mudam):

| Etapa | id |
|---|---|
| Funil Pedidos | `7443d257-0d1b-4d92-89bb-cb3a2db37a9d` |
| Conversas | `6a3a1d29-e054-4f33-b406-dcb90ff9c948` |
| Visitas | `f80a9492-01a1-4ae7-8220-498c76a17bf8` |
| Visualizações | `d5f2f5f4-1a68-43bc-baa3-a7fe47072d77` |
| Carrinho | `2f0ccfbd-d090-4b50-8f72-ca222c2e951b` |
| Revisão | `374d3ec8-b50d-46a7-888a-42a1d97be457` |
| Compras | `9652f450-7bb7-48c7-889f-ae258cabb8cc` |
| Chamar Humano | `663985b4-5b70-46da-85e6-ca306c7d22c2` |
| Cancelado | `927c63d1-e91a-4c43-9791-6dc19640b8a3` |

### Os dois tipos de evento

| | **Registro** (só cresce) | **Estado** (o último vale) |
|---|---|---|
| Eventos | `page_view`, `view_item` | `cart_sync`, `begin_checkout`, `purchase` |
| Regra do cardápio | "cada vez que chamar é uma nova visualização; não pode substituir a anterior" | "atualiza a última" |
| Ferramenta | `crm_add_lead_events` | `crm_update_lead` |
| Onde fica o JSON | uma linha de `external_event` por evento (`payload.data`) | uma chave de `custom_fields`: `cart`, `checkout`, `pedido` |
| Histórico | completo, com a hora de cada um | só o último; as mudanças ficam no Audit Log (trechos longos truncados em 500 caracteres) |

### Mapeamento: payload do evento do cardápio → CRM

**Regra geral de dinheiro:** dentro dos blocos JSON (`cart`, `checkout`, `pedido`, `data` dos eventos) os valores ficam
**como o cardápio mandou**, na unidade original. Já os campos do CRM que guardam dinheiro (`value_cents` e os `*_cents`)
são em **centavos inteiros**: se `price`, `value`, `subtotal`, `shipping` e `discount` estão em reais (`59.9`),
converta com `Math.round(valor * 100)` (`5990`). Confirme a unidade com quem escreveu o cardápio.

| Evento | Payload do cardápio | Vai para o CRM | Mover para |
|---|---|---|---|
| `page_view` | `{ screen_name }` | `crm_add_lead_events`: `event: "page_view"`, `data: { screen_name }` | Visitas (só na 1ª vez) |
| `view_item` | `{ item_id, item_name, price, category }` | `crm_add_lead_events`: `event: "view_item"`, `data: { item_id, item_name, price, category }` | Visualizações (só na 1ª vez) |
| `cart_sync` | `{ items: [{ item_id, item_name, price, quantity, category }] }` (o **carrinho inteiro**) | `crm_update_lead`: `custom_fields.cart` = o payload inteiro; `custom_fields.itens` = texto legível; `custom_fields.qtd_itens` = soma das `quantity` | Carrinho (na 1ª vez com `items` não vazio) |
| `begin_checkout` | `{ value, item_count, delivery_type, coupon }` | `crm_update_lead`: `custom_fields.checkout` = o payload inteiro; `value_cents` (= `value` em centavos); `qtd_itens` (= `item_count`); `tipo_entrega`; `cupom` | Revisão (na 1ª vez) |
| `purchase` | `{ order_id, value, delivery_type, subtotal, shipping, discount, payment_method, coupon, items }` | `crm_update_lead`: `custom_fields.pedido` = o payload inteiro; `value_cents` (= `value`, **total final pago**); `id_pedido_cardapio`; `tipo_entrega`; `subtotal_cents`; `frete_cents`; `desconto_cents`; `forma_pagamento`; `cupom`; `itens` | Compras |
| `cancel` | — | opcional | Cancelado (+ `lost_reason`) |

O `cart_sync` **substitui** o `add_to_cart` (carrinho inteiro em vez de um item): o cardápio não precisa mais montar o
carrinho a partir de eventos soltos.

Notas:

- **`page_view` e `view_item` vão em lote.** Guarde os eventos no servidor do cardápio, cada um com `at` (a hora do
  evento) e `event_id` (gerado **na hora do evento**), e envie num `crm_add_lead_events` a cada ~30 a 60 segundos ou
  junto do próximo evento que avança a etapa. Um cliente que vê dez itens vira **uma** escrita, não dez.
- **`cart_sync` dispara a cada mudança do carrinho:** aplique um *debounce* de poucos segundos (mande só o último estado
  da rajada). Carrinho esvaziado atualiza `cart` (com `items: []`), mas **não retrocede** o pedido.
- **O `purchase` que você descreveu tem `items` aninhado duas vezes** (`items: [{ items: [{…}] }]`). Parece engano de
  digitação. O CRM guarda o JSON **como vier** em `custom_fields.pedido`, mas os relatórios assumem `items: [{ item_id… }]`
  (plano). Confirme o formato real antes de ir ao ar; os relatórios têm uma nota sobre o aninhado.
- **O `value_cents` só nasce em `begin_checkout`.** Antes disso o payload não traz o total. Se a equipe quiser o valor
  do carrinho já no `cart_sync`, o cardápio soma `price × quantity` e manda `value_cents` na mesma chamada (opcional).
- **Campo vazio:** omita a chave (por exemplo, `coupon` sem cupom). Não mande `null` nem texto vazio.
- **Atualize ANTES de mover.** O valor e os itens ficam gravados quando o pedido avança, e o fechamento (Compras) já
  enxerga o total certo.

### O pedido não retrocede (regra do cardápio)

O CRM **aceita** mover para trás (testado), então a trava está no cardápio. Cada etapa significa "chegou pelo menos
uma vez", e o card mostra até onde o cliente chegou.

| Evento | Nível |
|---|---|
| `page_view` → Visitas | 1 |
| `view_item` → Visualizações | 2 |
| `cart_sync` (não vazio) → Carrinho | 3 |
| `begin_checkout` → Revisão | 4 |
| `purchase` → Compras · `cancel` → Cancelado | 5 (encerra) |

- O cardápio guarda, por `idtrack`, o **maior nível já enviado** e só chama `crm_move_lead_stage` quando o novo evento
  tem nível **maior**. Eventos no mesmo nível ou abaixo não movem (o registro e o estado ainda são gravados).
- **Chamar Humano fica fora dos níveis.** É um desvio que o CRM faz (a Bella passa a conversa para a equipe) e tem
  posição *depois* de Revisão no quadro. Se a regra for "só posição maior", um pedido que passou por humano **nunca mais
  avança**. Pela regra dos níveis ele segue: o próximo evento com nível maior que o já enviado move o pedido a partir de
  Chamar Humano normalmente.
- **Cache perdido** (reinício, outra instância)? Consulte o pedido com `crm_get_lead` e use a etapa atual dele como
  piso. Se estiver em Chamar Humano, não há piso: aceite o evento.
- **Mover para a mesma etapa** é aceito (devolve o pedido), mas gera um evento de mudança de etapa sem efeito na
  timeline. Evite: ele só atrapalha os relatórios de tempo entre etapas.
- **Depois de Compras ou Cancelado** o pedido está encerrado: não mova mais (o CRM aceitaria, então a trava é sua). Na próxima vez que o cliente escrever no
  WhatsApp, o CRM abre um **pedido novo** em Conversas, e o cardápio passa a usar esse.

### Campos a declarar no funil (uma vez por loja)

Em **CRM › Ver tudo em CRM › Etapas do funil › Editar vocabulário e campos › Campos do lead neste funil** (a tela
é `/app/settings/tenant/pipelines`; salve em "Salvar vocabulário e campos", que regrava a lista inteira). A chave
tem que ser exatamente esta:

| Chave | Rótulo | Tipo |
|---|---|---|
| `qtd_itens` | Quantidade de itens | Número |
| `itens` | Itens | Texto longo |
| `forma_pagamento` | Forma de pagamento | Texto curto |
| `id_pedido_cardapio` | Pedido no cardápio | Texto curto |
| `tipo_entrega` | Tipo de entrega | Texto curto |
| `cupom` | Cupom | Texto curto |
| `subtotal_cents` | Subtotal | Número |
| `frete_cents` | Taxa de entrega | Número |
| `desconto_cents` | Desconto | Número |

São **9** campos (conferidos no banco da loja piloto em 29/10: os três antigos já foram removidos). Os JSON (`cart`, `checkout`, `pedido`) ficam em chaves **não declaradas**, de propósito: a ficha mostra
só o resumo legível, e o JSON fica guardado para consulta. Os campos `tela`, `itens_vistos` e `qtd_itens_vistos` (da
versão anterior, que guardava só o último) **deixam de ser necessários**: o histórico agora vive nos registros de
`crm_add_lead_events`. Se a sua loja ainda os tem, remova os três.

Não marque nenhum campo como obrigatório ("Exigir em…", "Ao ganhar", "Ao perder"): um campo obrigatório vazio pode
fazer o `crm_move_lead_stage` ser recusado.

### Custo em escritas (teto de 30 por minuto por token)

Cada chamada de `crm_add_lead_events`, `crm_update_lead` e `crm_move_lead_stage` conta como **uma** escrita.

| Momento | Chamadas |
|---|---|
| Registros (`page_view`, `view_item`) | 1 por lote (a cada ~30–60 s ou junto do próximo avanço) |
| Cada avanço de etapa | 1 `crm_move_lead_stage` |
| `cart_sync` | 1 `crm_update_lead` por rajada (com debounce) |
| `begin_checkout` | 1 `crm_update_lead` |
| `purchase` | 1 `crm_update_lead` |

Um pedido típico (visita e itens vistos, carrinho, checkout, compra) gasta cerca de **9 escritas**: 1 lote de
registros, 2 movimentos iniciais (Visitas e Visualizações), e atualizar mais mover em Carrinho, Revisão e Compras. Com o
teto de 30/min, cabem uns **3 pedidos completos por minuto** por loja. Se a loja tiver pico maior, aumente o intervalo
dos lotes, combine eventos próximos ou peça um teto maior.

### Enquanto a ferramenta não está instalada (plano B)

Se `crm_add_lead_events` ainda não existe na instalação, o histórico pode ser guardado **acumulando no cardápio**: ele
mantém o array de visitas e de itens vistos por `idtrack` e envia o **array inteiro** em
`crm_update_lead.custom_fields.visitas` e `custom_fields.itens_vistos` (JSON nativo, testado). Cada envio substitui o
anterior, mas como o cardápio manda o array completo nada se perde. Os limites: uma escrita por envio, o array
cresce no registro do pedido, e uma perda de cache do cardápio apaga o histórico sozinho (leia o campo antes de
acrescentar). Troque pelo `crm_add_lead_events` assim que ele estiver instalado.

**Onde isso aparece no CRM** (pelo código; não conferi na tela): o valor do pedido (`value_cents`) alimenta o card,
os totais por coluna do funil e a previsão (`crm_get_pipeline_forecast`); campos e tags servem para filtro e relatório
(ticket médio, conversão por etapa). Também permite um **follow-up de carrinho abandonado**: o Follow-up tem gatilho
por mudança de etapa, e um fluxo pode disparar quando o pedido entra em Carrinho ou Revisão e não chega a Compras.

## 6. Fluxo completo por evento

```
evento do cardápio (idtrack, tipo, payload, hora do evento)
│
├─ acha o pedido: cache do idtrack → senão crm_list_leads(status=open, stage_id=Conversas)
│    e escolhe contact_id == idtrack (se não achar: tenta as outras etapas abertas; ainda não: ignora o evento)
│
├─ page_view / view_item  → põe o evento (com at e event_id) no buffer do idtrack
│                            └─ a cada ~30–60 s, ou antes de um avanço: crm_add_lead_events(lead_id, events[])
├─ cart_sync              → debounce; crm_update_lead(custom_fields.cart, itens, qtd_itens[, value_cents])
├─ begin_checkout         → crm_update_lead(custom_fields.checkout, value_cents, qtd_itens, tipo_entrega, cupom)
└─ purchase               → crm_update_lead(custom_fields.pedido, value_cents, id_pedido_cardapio, … )
│
├─ o nível do evento é MAIOR que o maior nível já enviado para este idtrack?
│    não → termina (o registro/estado já foi gravado)
│    sim → crm_move_lead_stage(lead_id, to_stage_id, reason=<evento>[, lost_reason])   (depois do update)
│
└─ atualiza o cache (lead_id, maior nível enviado)
```

Login do cardápio, na primeira visita de cada idtrack: `crm_get_contact(idtrack)` → `phone`. Se a ferramenta
recusar (contato pessoal) ou falhar, peça o telefone ao cliente.

---

## 7. Limites e erros

Limites do MCP (por minuto): **60 por token**, **600 por organização**, **30 escritas por token**. Estourou →
`429`, código `-32004`. Como a escrita é o limite mais apertado (30/min), agrupe os registros em lote e evite mover ou atualizar o pedido a
cada evento repetido. `crm_add_lead_events`, `crm_update_lead` e `crm_move_lead_stage` contam como escrita, cada um.

| Situação | O que você vê |
|---|---|
| Falta `Authorization` / formato ruim | HTTP 401, `-32001`, "Missing or malformed Authorization header." |
| Token desconhecido, revogado ou expirado | HTTP 401, `-32001`, "Token not recognized." (ou "Token revoked." / "Token expired.") |
| Muitas tentativas com token inválido | HTTP 429, `-32004`, "Too many failed token attempts…" |
| Falta o escopo | `isError: true`, "Token missing required scope 'mcp:write'." |
| Empresa suspensa | HTTP 403, `-32002`, "Organization suspended…" |
| `Accept` incompleto | HTTP 406, "Not Acceptable: Client must accept both application/json and text/event-stream" |
| Cancelado sem motivo | `isError: true`, "Informe o motivo da perda…" |
| Motivo de perda inválido | `isError: true`, "Esse motivo de perda não está na lista deste funil…" |
| Contato pessoal | `isError: true`, "este contato foi marcado como pessoal…" |
| Lote de eventos inválido (vazio, mais de 50, evento grande, hora no futuro ou com mais de 30 dias) | `isError: true`, a mensagem diz qual evento (`Evento #2 …`) |
| Nome de evento fora do padrão / chave desconhecida | `isError: true`, "Input validation error…" |
| Pedido de outra loja ou inexistente | `isError: true`, "Pedido não encontrado." |
| `crm_track_event` com evento não cadastrado, inativo, grande, fora da janela ou com valor inválido | **não** é `isError`: a resposta vem com `resultado: "recusado"` naquele evento e um `codigo` (definitivo: não reenvie) |

Boas práticas:
- Trate o 401 como **alarme** (token revogado ou expirado) e não como "tente de novo".
- Registre `X-Request-Id` (cabeçalho de resposta) nos seus logs: ele correlaciona com a auditoria do CRM
  (`api_audit_log`), onde cada chamada de ferramenta fica registrada.
- Falha de rede/5xx: repita com espera crescente. As leituras são seguras de repetir. `crm_add_lead_events` só é
  seguro de repetir se **cada evento levou `event_id`**; sem ele, o reenvio duplica.

`Idempotency-Key`: o endpoint aceita o cabeçalho (precisa ser um UUID, senão 400), mas **não testei** que ele
deduplica as ferramentas. Não dependa dele: use `event_id` nos eventos e as regras de avanço da seção 5.

---

## 8. Checklist por loja nova

- [ ] Token criado em **API Tokens** com `mcp:read` + `mcp:write`, guardado só no servidor
- [ ] `tools/list` mostra `crm_add_lead_events` (senão a instalação ainda não tem a ferramenta: use o plano B)
- [ ] `crm_list_pipelines` → id do funil padrão
- [ ] `crm_list_stages` → ids de Conversas, Visitas, Visualizações, Carrinho, Revisão, Compras, Cancelado
- [ ] Os **9** campos da seção 5 declarados em **Etapas do funil** (chaves idênticas; nenhum obrigatório; `tela`,
      `itens_vistos` e `qtd_itens_vistos` removidos)
- [ ] Unidade do dinheiro confirmada (reais → converter para centavos antes de enviar)
- [ ] Formato real do `items` do `purchase` confirmado (plano ou aninhado)
- [ ] Cada evento de registro leva `at` e `event_id` gerados na hora do evento
- [ ] Trava de nível implementada (o pedido não retrocede; Chamar Humano fora dos níveis)
- [ ] Link do cardápio da loja no prompt da Bella com o `idtrack` (já é feito pelo agente)
- [ ] Teste de ponta a ponta: escrever no WhatsApp → abrir o link → conferir o pedido indo de Conversas a Visitas →
      ver itens → montar carrinho → finalizar uma compra → pedido em **Compras** com o valor final, o JSON em
      `pedido` e os registros na linha do tempo
- [ ] Contato "pessoal" cai no login manual

## 9. Referências

- Collection do Postman (importa tudo de uma vez): `mcp-bellacapri.postman_collection.json` (nesta pasta)
- Os mesmos pedidos em curl, um por bloco: `mcp-requests-postman.curl.txt` (nesta pasta)
- Consultas de relatório sobre esses dados: `relatorios-bellacapri.sql` (nesta pasta)
- Pacote de implantação da loja piloto: `pacote-bellacapri-rpa.md`
- Implementação de `crm_add_lead_events`: `lib/leads/eventos-externos.ts` (commit `ce188709d` na `main` local do repositório; a branch de desenvolvimento foi mesclada e removida)
