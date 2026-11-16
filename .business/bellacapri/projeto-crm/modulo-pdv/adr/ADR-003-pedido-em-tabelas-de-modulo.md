# ADR-003: O pedido do PDV em tabelas próprias do módulo

Status: Aceito
Data: 2026-11-16
Aceito em: 2026-11-16, pelo dono do projeto, sem alterações no texto
Origem da decisão: proposta do Design Doc. O pedido como entidade do CRM, enviada ao ERP de forma idempotente, já era decisão do PRD pai.

## 1. Contexto

- O PRD pai define o pedido como entidade do CRM, com estados, enviada ao ERP de forma idempotente. O pedido terá vários canais ao longo do programa (PDV agora; WhatsApp e app depois).
- O pedido do PDV precisa de: origem (telefone ou balcão), tipo (balcão ou entrega), loja, endereço copiado, itens com composição (tamanho, meio a meio, adicionais, ingredientes removidos), valores vindos do ERP e rastro de cada tentativa de envio.
- Pelo que foi lido no código do CRM:
  - a tabela `orders` é espelho de e-commerce: o `check` do provedor aceita só `nuvemshop`, `vtex` e `shopify`, não tem itens, e não há escrita por tela;
  - o módulo Comandas (`sales`, `sale_items`) é de serviço, com agendamento, comissão e fidelidade, sem origem, endereço nem envio a sistema externo.
- A doutrina do CRM (ADR-0002) manda que um módulo oficial com dados próprios **não** ponha tabelas no baseline de todos: elas nascem por uma função provisionadora quando o módulo é instalado. O código do módulo fica só no fork da rede.

## 2. Decisão

Vamos criar o pedido do PDV como **tabelas próprias do módulo `pdv`** (`pdv_orders`, `pdv_order_items`, `pdv_order_item_options`, `pdv_order_attempts`), provisionadas na instalação do módulo, com a composição do item normalizada, o endereço copiado no pedido e o estado `recusado` além dos quatro do PRD.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | Estender o módulo Comandas | Menos tabelas; já existe tela de venda | Domínio diferente (serviço, comissão, fidelidade); acopla dois módulos de ciclos distintos; falta origem, endereço e envio ao ERP | Rejeitada |
| 2 | Reaproveitar `orders` alterando o `check` do provedor | Já aparece na lateral do inbox | Espelho de e-commerce, sem itens; altera tabela de núcleo para um módulo opcional, o que a doutrina evita | Rejeitada |
| 3 | **Tabelas próprias do módulo `pdv`** | Domínio limpo; o módulo desligado não deixa rastro; segue o caminho de Honorários e Comandas | Mais tabelas e migrations no fork; o pedido de outros canais pode precisar migrar para o núcleo no futuro | **Escolhida** |

## 4. Consequências

**Positivas**
- O núcleo do CRM não muda; módulo desligado significa ausência total das tabelas.
- A composição do item é normalizada (sem `jsonb` lido pela tela), o que evita o anti-padrão de `jsonb` sem esquema central.
- Estados e invariantes ficam sob testes próprios.

**Negativas e trade-offs**
- Cada migration no fork disputa numeração com o upstream, e a doutrina cobra a tripla (migration, apêndice no baseline, linha `-- manifest:`) e a checagem de colisão.
- Os pedidos de WhatsApp e app (FR-003, FR-007, FR-011 a FR-013) dependerão de um módulo opcional. Se isso for um problema, uma nova decisão moverá a entidade para o núcleo, com migração.
- Duas entidades de "pedido" convivem no CRM (`orders` do e-commerce e `pdv_orders`), com a lateral do inbox lendo só a primeira.

**Obrigações criadas**
- Função provisionadora `fn_pdv_provisionar`, com RLS por tenant, revogação de `PUBLIC` e `anon` e teste de isolamento.
- Máquina de estados do pedido, com testes.
- Registro do módulo: flag desligada, texto no catálogo de recursos, porta de navegação e gate de ferramentas.
- Decidir, nos PRDs dos canais de conversa, como eles criam e leem o pedido.
