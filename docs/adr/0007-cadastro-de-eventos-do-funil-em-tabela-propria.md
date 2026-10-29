# ADR-0007 — O cadastro de eventos do funil mora numa tabela própria, uma linha por evento

- **Status:** proposto. Decidido no debate de 29/10/2026 com o autor da feature; aguarda aprovação para ser aceito. Depois de aceito, não se edita: quem mudar de ideia escreve outra ADR que a substitua.
- **Data:** 2026-10-29
- **Contexto medido em:** `20963bb71` (topo da `main` local em 29/10/2026)
- **Doc que muda junto:** [`docs/design/eventos-do-funil.md`](../design/eventos-do-funil.md), seções 3, 4 e 6
- **Decisões irmãs:** [ADR-0008](0008-historico-e-a-fonte-de-verdade-do-pedido.md) (onde mora a verdade) e [ADR-0009](0009-evento-sem-cadastro-e-recusado.md) (o contrato com quem integra)

---

## Contexto

Sistemas de fora do CRM (cardápio digital, agenda online, portal de imóveis) sabem o que o cliente faz.
Hoje, para o funil refletir isso, quem integra precisa conhecer os ids das etapas, guardar a própria tabela de
"níveis" para o pedido não retroceder e juntar três chamadas MCP por fato. A regra *"este fato leva o card para esta
etapa"* é configuração do funil e hoje vive fora dele.

A decisão é **onde guardar essa configuração**. O que ela precisa carregar, por evento: a chave, o nome, a etapa de
destino, se respeita o movimento manual da equipe, onde guardar o último conteúdo, qual campo do JSON é o valor e em
que unidade, e qual campo identifica o fato de negócio. Cada funil tem os seus eventos, em número livre, e nada nasce
semeado (decisão do debate: não presumir que funis novos se parecerão).

O que o repositório já oferece para configuração de funil:

- `crm_stages.agent_stage_hint`: uma coluna na etapa, escrita por `app/api/v1/pipelines/[id]/agent-mapping/route.ts`.
  Serve a um conjunto **fixo de sete passos** do agente, um por etapa.
- `pipeline.settings.fields`: a declaração dos campos do lead num `jsonb` do funil, que a doutrina descreve como
  schema declarativo.

---

## Decisão

**Vamos guardar o cadastro de eventos de cada funil numa tabela própria, `crm_pipeline_events`, com uma linha por
evento e a etapa de destino como chave estrangeira para `crm_stages`.**

---

## Alternativas consideradas

| # | Alternativa | Prós | Contras | Veredito |
|---|---|---|---|---|
| A | **Coluna em `crm_stages`**, como `agent_stage_hint` | Padrão já conhecido; sem tabela nova | Um evento por etapa. Não cabe evento customizado, nem comportamento por evento (valor, repetição, flag). Dois eventos para a mesma etapa (`view_item` e `view_category`) são impossíveis | Rejeitada |
| B | **`jsonb` em `pipeline.settings`**, como os campos do lead | Sem migration de tabela; edição de uma vez só | A etapa de destino viraria um id solto dentro de JSON, sem FK: apagar a etapa deixa o cadastro apontando para o vazio. Sem unicidade da chave por funil e sem RLS por linha. É o anti-pattern 6 do `CLAUDE.md` (a UI lê o caminho direto) | Rejeitada |
| C | **Tabela própria `crm_pipeline_events`** | FK real para a etapa (`on delete set null`); `unique (pipeline_id, key)`; RLS por organização; um evento por linha, sem teto; a v2 (customizados) não exige nova migration | Uma tabela, uma tela e uma API a mais para manter | **Escolhida** |
| D | **Lista fixa no código**, por nicho | Zero configuração | Contraria o debate (o funil decide, não o produto); cada nicho novo vira PR no núcleo | Rejeitada |

A razão de B perder, apesar de o repositório já guardar os campos do lead em `jsonb`: o campo do lead é uma declaração
**sem referência a outra tabela**. O evento aponta para uma etapa, e referência é exatamente o que um `jsonb` não
garante.

---

## Consequências

**Positivas**
- A configuração é consultável e tem integridade: etapa apagada anula o destino em vez de deixar um id morto.
- Eventos customizados por funil entram sem mudar o schema.
- O isolamento entre organizações se prova com o teste que o repositório já exige para tabela tenant-aware.

**Negativas / trade-offs**
- Mais uma tabela no baseline que todo self-hoster recebe, mesmo quem nunca usar. Aceito: ela nasce vazia e a operação comum
  não depende dela.
- Duas formas de configuração de funil convivem (coluna do agente, tabela de eventos). A tela deixa claro que são
  mapas diferentes: "cada passo" é do agente; "cada evento" é de quem integra.

**Obrigações**
- Migration em tripla: arquivo em `supabase/migrations/`, apêndice idempotente em `supabase/baseline.sql` e linha
  `-- manifest:`. O número sai de `pnpm checar:colisao-de-migration`.
- RLS `tenant_isolation_crm_pipeline_events_all`, com escrita de `manager` para cima, no padrão de `crm_stages`.
- Teste de isolamento entre duas organizações em `pnpm test:db`.
- Auditoria das mutações de cadastro e `requireSupportWrite(` antes do efeito em cada handler.
- Instalações existentes ficam com **zero** eventos; nenhuma linha é semeada.
