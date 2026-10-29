# ADR-0008 — O histórico é a fonte de verdade do que um sistema externo contou sobre o pedido; os campos do pedido são projeção

- **Status:** proposto. Decidido no debate de 29/10/2026 com o autor da feature; aguarda aprovação para ser aceito.
- **Data:** 2026-10-29
- **Contexto medido em:** `20963bb71` (topo da `main` local em 29/10/2026)
- **Doc que muda junto:** [`docs/design/eventos-do-funil.md`](../design/eventos-do-funil.md), seções 2, 3 e 4
- **Decisões irmãs:** [ADR-0007](0007-cadastro-de-eventos-do-funil-em-tabela-propria.md) e [ADR-0009](0009-evento-sem-cadastro-e-recusado.md)

---

## Contexto

Quando o cardápio conta ao CRM que o cliente montou o carrinho ou comprou, a informação tem duas casas possíveis:

- **O histórico do pedido**, em `crm_lead_activities` (tipo `external_event`), uma linha por fato, com a hora do fato em
  `performed_at`. A ferramenta `crm_add_lead_events` (`lib/leads/eventos-externos.ts`) já grava ali.
- **O próprio pedido**: `custom_fields` (carrinho, checkout, pedido) e `value_cents`, que a ficha, os totais por coluna do funil
  e os relatórios leem direto.

Com a decisão de registrar **todos** os eventos no histórico (inclusive os de estado), a mesma informação passa a existir
duas vezes. O `CLAUDE.md` proíbe, nos anti-patterns, a *duplicação sem source of truth declarado*. Sem declarar qual é a
verdade, duas coisas dão errado: um reenvio ou uma entrega fora de ordem deixa o pedido com o carrinho velho e ninguém sabe
qual dos dois lados está certo; e, se o estado for o único lugar, o histórico de como o carrinho evoluiu se perde.

Fatos medidos que pesam na escolha:
- O Audit Log trunca textos acima de 500 caracteres, então não serve para reconstruir um carrinho.
- A ficha do pedido só mostra campos escalares declarados; o JSON fica em chave não declarada.
- A ordem do "o mais novo vence" precisa de uma hora de evento por pedido, e `performed_at` já a guarda.

---

## Decisão

**Vamos tratar `crm_lead_activities` como a fonte de verdade dos fatos externos de um pedido, e `custom_fields` e
`value_cents` como projeção do último evento de cada tipo.**

---

## Alternativas consideradas

| # | Alternativa | Prós | Contras | Veredito |
|---|---|---|---|---|
| A | **O pedido é a verdade; o histórico é só registro** | Simples de ler; é como funciona hoje com `crm_update_lead` | Nada decide qual dos dois está certo quando divergem. Um carrinho velho que chega atrasado sobrescreve o novo e o histórico não consegue corrigir. Ordenação por hora não tem onde se apoiar | Rejeitada |
| B | **Só o histórico; o pedido não guarda cópia** | Uma só verdade, nada duplicado | A ficha, os totais e os relatórios teriam de consultar o histórico a cada leitura. O valor da venda precisa estar em `value_cents` para a conversão de anúncio e para a previsão do funil | Rejeitada |
| C | **Histórico é a verdade; o pedido é projeção** | A ordem (`performed_at`) e a idempotência (`event_id`) saem do histórico; a ficha e os relatórios leem a projeção; a projeção é recriável | Duas gravações por evento; a projeção pode ficar defasada se uma falhar | **Escolhida** |
| D | **Tabela de estado própria por pedido**, separada de ambos | Isola o estado externo | Uma terceira casa para a mesma informação; a ficha ainda precisaria lê-la | Rejeitada |

---

## Consequências

**Positivas**
- "O mais novo vence" é calculado a partir de `performed_at`, sem coluna extra de controle: um evento atrasado perde para um
  mais novo já aplicado.
- Cada passo do processamento (histórico, estado, valor, movimento) é idempotente por conta própria, então uma queda no meio
  se recupera no reenvio, porque o histórico diz o que já aconteceu.
- A projeção pode ser recomputada do histórico se um dia divergir.

**Negativas / trade-offs**
- Duas gravações por evento de estado, com a projeção podendo ficar um passo atrás da verdade se a segunda falhar. Aceito:
  o reenvio converge.
- **Edição manual de um campo projetado é sobrescrita pelo próximo evento.** Por isso a chave de estado de um evento não pode
  coincidir com a chave de um campo declarado do funil (a tela e a API bloqueiam), para a equipe não editar à mão o que é
  projeção.
- A apuração de relatórios que precisem do histórico depende das atividades existirem. Se uma política de retenção as apagar,
  a projeção continua, mas a verdade se perdeu.

**Obrigações**
- Testes que provam que a projeção é igual ao último evento e que um evento atrasado não a sobrescreve.
- A documentação do guia e da spec do MCP declara a regra: o histórico decide, o pedido espelha.
- A retenção de `crm_lead_activities` precisa constar na documentação do recurso, porque define até quando a verdade existe.
