# Prova ao vivo de `crm_track_event` pelo MCP (US-012)

**Data:** 29/10/2026 · **Ambiente:** stack local (banco do Supabase local, organização RPA - Abrão Thomé), código da branch `ralph/eventos-do-funil` servido por `next dev -p 3100`, endpoint real `POST /api/mcp` com **token temporário** (`mcp:read` e `mcp:write`) que foi apagado ao final.

**Como foi montado.** O cadastro de eventos do funil Pedidos entrou por SQL (a tela de cadastro vem na US-014): `page_view`→Visitas, `view_item`→Visualizações, `cart_sync`→Carrinho (guarda `cart`), `begin_checkout`→Revisão (guarda `checkout`), `purchase`→Compras (guarda `pedido`, valor em `value`/reais, repetição por `order_id`, **não** respeita movimento manual). Os pedidos de teste nasceram em Conversas para o contato de teste; o movimento manual foi simulado gravando um `stage_changed` com `actor_kind = 'user'`.

**Limpeza.** Ao final, pedidos de teste, atividades, eventos cadastrados e token foram apagados e conferidos: **0 | 0 | 0**.

Cada passo abaixo mostra o resultado devolvido pela ferramenta por evento, na forma `evento/event_id: resultado [estado, valor, movimento→etapa]`, e o que o banco tinha depois (`pedido: etapa|status|value_cents|carrinho guardado|pedido guardado`).

```text
## S0 tools/list
crm_track_event: True | crm_list_pipeline_events: True

## S1a crm_list_pipeline_events (funil sem cadastro)
{"pipeline_id": "7443d257-0d1b-4d92-89bb-cb3a2db37a9d", "eventos": []}

## S1b evento com funil sem cadastro
page_view/s1-1: recusado (evento_nao_cadastrado)
O evento "page_view" não está cadastrado neste funil. Este funil não tem eventos ativos; cadastre-os em Configurações › Funis.

## S2 cadastro e leitura
begin_checkout→Revisão guarda_estado=True define_valor=False respeita=True
cart_sync→Carrinho guarda_estado=True define_valor=False respeita=True
page_view→Visitas guarda_estado=False define_valor=False respeita=True
purchase→Compras guarda_estado=True define_valor=True respeita=False
view_item→Visualizações guarda_estado=False define_valor=False respeita=True
'stage_id' no JSON? False

## S3 sequência completa (1 chamada, 8 eventos)
page_view/a1: registrado [sem_state_key,sem_campo,movido→Visitas]
page_view/a2: registrado [sem_state_key,sem_campo,ja_na_etapa_ou_adiante]
view_item/a3: registrado [sem_state_key,sem_campo,movido→Visualizações]
view_item/a4: registrado [sem_state_key,sem_campo,ja_na_etapa_ou_adiante]
cart_sync/a5: registrado [ignorado_antigo,sem_campo,movido→Carrinho]
cart_sync/a6: registrado [aplicado,sem_campo,ja_na_etapa_ou_adiante]
begin_checkout/a7: registrado [aplicado,sem_campo,movido→Revisão]
purchase/a8: registrado [aplicado,aplicado,movido→Compras]
pedido no banco: Compras|won|7390|true|true  | linhas external_event: 8

## S3b projeção
cart tem 2 itens e pedido.order_id: t|PED-US012

## S4 reenvio idêntico do lote inteiro
page_view/a1: repetido [sem_state_key,sem_campo,pedido_encerrado]
page_view/a2: repetido [sem_state_key,sem_campo,pedido_encerrado]
view_item/a3: repetido [sem_state_key,sem_campo,pedido_encerrado]
view_item/a4: repetido [sem_state_key,sem_campo,pedido_encerrado]
cart_sync/a5: repetido [ignorado_pedido_encerrado,sem_campo,pedido_encerrado]
cart_sync/a6: repetido [ignorado_pedido_encerrado,sem_campo,pedido_encerrado]
begin_checkout/a7: repetido [ignorado_pedido_encerrado,sem_campo,pedido_encerrado]
purchase/a8: repetido [ignorado_pedido_encerrado,ignorado_pedido_encerrado,pedido_encerrado]
linhas antes/depois: 8/8 | pedido: Compras|won|7390|true|true

## S5 mesma compra (order_id) com outro event_id
purchase/a8-bis: repetido [-,-,-]
pedido: Compras|won|7390|true|true

## S6 evento atrasado no mesmo lote
cart_sync/b1: registrado [aplicado,sem_campo,movido→Carrinho]
cart_sync/b2: registrado [ignorado_antigo,sem_campo,ja_na_etapa_ou_adiante]
carrinho no pedido: novo | linhas: 2

## S7 desconhecido e valor inválido no meio do lote
view_item/c1: registrado [sem_state_key,sem_campo,ja_na_etapa_ou_adiante]
view_category/c2: recusado (evento_nao_cadastrado)
purchase/c3: recusado (valor_invalido)
page_view/c4: registrado [sem_state_key,sem_campo,ja_na_etapa_ou_adiante]
O evento "view_category" não está cadastrado neste funil. Eventos ativos: begin_checkout, cart_sync, page_view, purchase, view_item.
linhas c2/c3 gravadas: 0

## S8 movimento manual no meio
begin_checkout/d1: registrado [aplicado,sem_campo,respeita_movimento_manual]
pedido (depois de begin_checkout): Carrinho|open|-|false|false
purchase/d2: registrado [aplicado,aplicado,movido→Compras]
pedido (depois de purchase): Compras|won|1000|false|true

## S9 evento de nível menor com o card em Revisão
page_view/e1: registrado [sem_state_key,sem_campo,ja_na_etapa_ou_adiante]
view_item/e2: registrado [sem_state_key,sem_campo,ja_na_etapa_ou_adiante]
pedido: Revisão|open|-|false|false

## S10 desvio por 'Chamar humano' não trava a compra
purchase/f1: registrado [aplicado,aplicado,movido→Compras]
pedido: Compras|won|2000|false|true

## S11 pedido inexistente / de outra organização
{'_erro': 'Pedido não encontrado.'}

## S12 ator dos movimentos feitos pelo evento
actor_kind: system

## LIMPEZA — sobras (pedidos, eventos cadastrados, tokens): 0|0|0
```

## O que a prova mostra

- **S0:** as duas ferramentas aparecem em `tools/list`.
- **S1:** funil sem cadastro devolve lista vazia, e o evento é recusado com a mensagem que explica onde cadastrar.
- **S3:** 8 eventos numa chamada levam o pedido de Conversas a Compras (`won`), com `value_cents` 7390 (R$ 73,90), o carrinho e o pedido guardados, e 8 linhas no histórico. O carrinho mais antigo (`a5`) fica `ignorado_antigo` e o mais novo (`a6`) vence, qualquer que seja a ordem.
- **S4:** reenviar o lote inteiro não grava nada (8 linhas antes e depois) e devolve `repetido`; com o pedido ganho, estado e valor não mudam.
- **S5:** a mesma compra com outro `event_id` mas o mesmo `order_id` volta `repetido` e não altera o pedido.
- **S6:** evento atrasado no mesmo lote: o carrinho do pedido fica com o conteúdo de hora mais nova.
- **S7:** evento desconhecido e compra com valor negativo são recusados, **não gravam linha**, e os eventos válidos do mesmo lote são registrados.
- **S8:** com o último movimento feito por uma pessoa, `begin_checkout` registra e grava o estado mas não move (`respeita_movimento_manual`); a compra, cadastrada para não respeitar, move o card para Compras com o valor.
- **S9:** com o card em Revisão, eventos de nível menor não retrocedem.
- **S10:** o card parado em "Chamar humano" (fora do mapa) vai para Compras.
- **S11:** pedido inexistente ou de outra organização: "Pedido não encontrado.".
- **S12:** os movimentos feitos pelo evento gravam `actor_kind = system`.

## O que esta prova não cobre

- O cadastro foi feito por SQL; a API e a tela de cadastro são das US-013 a US-018.
- A corrida de dois eventos simultâneos (`conflito`) está provada em teste unitário e de banco, não aqui.
- Não foi exercitada a recusa do funil por campo obrigatório ou motivo de ganho (o funil Pedidos da loja piloto não os exige).
