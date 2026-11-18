# Casos de uso — Histórico e recompra no PDV

> **Rascunho anterior ao protótipo (2026-11-18).** O protótipo `cart-craft-counter` é a especificação do produto
> ([especificacao-prototipo.md](../prototipo/especificacao-prototipo.md)); onde este documento difere dela, vale a
> especificação. Este rascunho segue útil só para o que o protótipo não tem por ser local: integração com o ERP (envio,
> recusa, reenvio) e validação das ações do assistente.

> **Fora do protótipo:** o protótipo não tem histórico por cliente nem "Repetir último pedido" (só "Pedidos do dia", global). Fica em backlog até o dono do projeto decidir.

Escopo: ver os pedidos anteriores do cliente na ficha e repetir o último pedido. Fora deste documento: montar o pedido
novo (ver "Fazer o pedido"), cadastro, assistente. Os dados vêm do ERP por MCP (hoje, por um mock, ADR-009).

## UC01 — Ver o histórico de pedidos do cliente

**Atores:** primário Atendente; secundário ERP (MCP).

**Objetivo:** ver o que o cliente costuma pedir e quando foi a última compra, sem sair da ficha.

**Pré-condições:** ficha do cliente aberta.

**Pós-condições:** lista de pedidos anteriores exibida, ou o estado vazio.

**Fluxo principal**
1. O Atendente abre a ficha do cliente.
2. O sistema pede ao ERP o histórico da ficha aberta e mostra, do mais recente ao mais antigo, data, tipo, loja, itens e total.
3. O sistema destaca a última compra.

**Fluxos alternativos e de exceção**
- 2a. Cliente sem histórico: o sistema mostra "Este cliente ainda não fez pedidos" e não oferece sugestão.
- 2b. Falha ao carregar o histórico: o sistema mostra o erro com "Tentar de novo" e o resto da ficha continua utilizável.
- 2c. ERP fora do ar: igual a 2b.
- 2d. Cliente com várias fichas no mesmo contato: o histórico é o **da ficha aberta**, nunca a soma das fichas.

## UC02 — Repetir o último pedido

**Atores:** primário Atendente; secundário ERP (MCP).

**Objetivo:** montar o carrinho com os mesmos itens do último pedido, conferidos contra o cardápio atual do ERP.

**Pré-condições:** o cliente tem histórico (UC01); cliente identificado.

**Pós-condições:** carrinho montado com os itens ainda válidos, e o Atendente ciente de qualquer diferença.

**Fluxo principal**
1. O Atendente aciona "Repetir último pedido".
2. O sistema confere cada item contra o cardápio atual do ERP (existência, disponibilidade e preço).
3. O sistema monta o carrinho com os itens válidos.
4. O sistema mostra o resultado item a item (mantido, preço novo, indisponível).
5. O Atendente segue para revisar o carrinho (UC02 de "Fazer o pedido").

**Fluxos alternativos e de exceção**
- 2a. Item indisponível ou que não existe mais: o sistema o deixa fora do carrinho e o aponta com o motivo.
- 2b. Item com preço novo: o sistema entra com o preço atual do ERP e avisa o valor anterior e o novo.
- 3a. O carrinho já tinha itens: o sistema pergunta se substitui ou soma (`[A DEFINIR]`).
- 3b. Nenhum item continua válido: o sistema não monta o carrinho e informa.
- 2c. ERP fora do ar: o sistema informa e não monta o carrinho.

## Relacionamentos
- UC02 `<<include>>` UC01 (o último pedido é o primeiro da lista).
- UC02 desemboca em "Revisar o carrinho" (Fazer o pedido, UC02).

## Diagrama
Ver [diagrama-casos-de-uso.mmd](diagrama-casos-de-uso.mmd).

## Decisões registradas
- O histórico é da ficha aberta, não do contato.
- O PDV não calcula preço: o item repetido entra com o preço atual do ERP.

## Pendências `[A DEFINIR]`
1. **Quantos pedidos** a ficha lista (os últimos N, com "ver mais"?).
2. **O que conta como "último pedido":** só pedidos aceitos pelo ERP, ou também recusados e cancelados?
3. **Carrinho com itens ao repetir:** substitui ou soma?
