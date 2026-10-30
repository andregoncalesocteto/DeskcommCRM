# Design Doc — Eventos do funil

**Status:** proposta · **Data:** 29/10/2026 · **Etapa:** 1 de 3 (núcleo)
**Fonte do debate e das regras de negócio:** [`docs/superpowers/specs/2026-10-29-eventos-do-funil-design.md`](../superpowers/specs/2026-10-29-eventos-do-funil-design.md).
Este documento organiza a arquitetura; o detalhe campo a campo e a lista de testes vivem na spec e não se repetem aqui.

---

## 1. Contexto

Sistemas externos ao CRM (cardápio digital, agenda online, portal de imóveis) sabem o que o cliente faz: abriu, viu um
item, montou o carrinho, comprou. Para o CRM refletir isso no funil, hoje o integrador:

- conhece os **ids das etapas** do funil;
- guarda a **própria tabela de níveis** para o pedido não retroceder;
- junta **três chamadas** MCP por fato (`crm_add_lead_events`, `crm_update_lead`, `crm_move_lead_stage`);
- converte reais para centavos e decide o que é "compra".

Medido na Bella Capri: cerca de 9 escritas por pedido típico, com o teto de 30 por minuto por token, e a regra reescrita por
quem integra. A regra "este fato leva o card para esta etapa" é **configuração do funil**, e hoje vive fora dele.

**Objetivo da etapa 1:** o funil declara os seus eventos; uma operação única do MCP registra, atualiza o estado, grava o valor
e move o card conforme essa declaração, de forma idempotente e sem retroceder.

**Fora da etapa 1** (feitas depois, ver "Etapas 2 e 3: como ficaram"): porta pública com chave para o navegador e o script (etapa 2); valor e JSON no webhook de entrada (etapa 3).

---

## 2. Solução Proposta

Quatro peças, todas no núcleo:

1. **Tabela `crm_pipeline_events`:** o cadastro do evento por funil (chave, etapa de destino, valor, repetição, flags).
2. **Operação `crm_track_event` (MCP, escrita):** recebe um lote de fatos de um pedido e aplica o cadastro, um resultado por evento.
3. **Leitura `crm_list_pipeline_events` (MCP, leitura):** o integrador descobre as chaves válidas em vez de adivinhar.
4. **Seção "Para onde o card vai em cada evento"** na tela de Etapas do Funil, mais a API de cadastro.

Decisões estruturais:

- O histórico continua sendo `crm_lead_activities` (tipo `external_event`). **Não** há tabela nova de eventos recebidos.
- Estado e valor são **projeções** do histórico em `crm_leads.custom_fields` e `value_cents`; a fonte de verdade é o histórico.
- Evento sem cadastro é **recusado**, por evento. Nada nasce semeado com o funil.
- "Compra" não é um tipo: é a combinação etapa de destino de ganho + campo do valor + chave de repetição + não respeitar movimento manual.

```
  Sistema externo                    DeskcommCRM (núcleo)
  ───────────────                    ─────────────────────────────────────────────
  servidor do cardápio               ┌─────────────────────────────────────────────┐
  (hoje, token dsk_)  ── MCP ──────► │ crm_track_event                             │
  [etapa 2: navegador, porta pública]│  1 valida  ─► lê crm_pipeline_events        │
  [etapa 3: webhook da plataforma]   │  2 repete? ─► crm_lead_activities (índice)  │
                                     │  3 registra ─► crm_lead_activities          │
                                     │  4 estado   ─► crm_leads.custom_fields      │
                                     │  5 valor    ─► crm_leads.value_cents        │
                                     │  6 move     ─► moveLeadHandler ─► stage_changed
                                     └─────────────────────────────────────────────┘
                                                          │
            tela: Etapas do funil ── cadastra ──► crm_pipeline_events
            consumidores já existentes de stage_changed: automações, follow-ups, conversões de anúncio
```

---

## 3. Arquitetura

### Componentes

| Componente | Responsabilidade | Tecnologia |
|---|---|---|
| `crm_pipeline_events` | Cadastro do evento por funil | Postgres, RLS por organização |
| Índice `uniq_lead_activities_external_event_id` | Garantir no banco que o mesmo `event_id` não grava duas vezes por pedido | Índice único parcial |
| `lib/leads/eventos-do-funil/` (novo) | Funções puras: caminho no JSON, valor em centavos, decisão de movimento, ordem do estado | TypeScript, sem I/O |
| `lib/leads/eventos-externos.ts` (existente) | Registro no histórico; passa a tratar `23505` como repetido | TypeScript |
| `crm_track_event`, `crm_list_pipeline_events` | Ferramentas MCP; orquestram as funções puras e os handlers | `lib/mcp/tools/leads.ts` |
| `moveLeadHandler`, `updateLeadHandler` (existentes) | Mover etapa e atualizar o pedido, com as regras do funil | `app/api/v1/leads/_handler.ts` |
| `app/api/v1/pipelines/[id]/events` | Cadastro: lista, cria, edita, desativa | Route Handlers, Zod, `requireRole`, `requireSupportWrite` |
| Seção da tela de funis | Edição do cadastro e sinais de uso | React, em `app/app/settings/tenant/pipelines/` |

### Fluxo principal (um evento de compra)

```
 cardápio ─ crm_track_event(lead, [purchase]) ─► MCP (auth dsk_, mcp:write, limite 30/min)
        │
        ▼
  carrega pedido (filtra organization_id) ─► funil = pedido.pipeline_id
        │
        ├─ evento 'purchase' cadastrado e ativo? ── não ─► recusado: evento_nao_cadastrado (lista as chaves)
        ├─ order_id já registrado neste pedido?  ── sim ─► repetido
        ├─ insere atividade external_event       ── 23505 ─► repetido
        ├─ state_key?  at >= último do mesmo evento? ─► grava custom_fields[state_key]
        ├─ value_path? ─► valor em centavos ─► mesma atualização do pedido
        └─ stage_id?   não retrocede · pedido aberto · respeita movimento manual?
                          ─► moveLeadHandler (condicional à etapa lida) ─► stage_changed
```

---

## 4. Modelo de Dados

Resumo (colunas, constraints e RLS completas na spec):

```
crm_pipelines 1 ──< crm_pipeline_events >── 0..1 crm_stages
                          │ key (única por funil, imutável após uso)
                          │ label, description
                          │ stage_id (destino; nulo = só registra; não pode ser etapa de perda)
                          │ respects_manual_move  (padrão true)
                          │ state_key             (onde o último conteúdo fica em custom_fields)
                          │ value_path + value_unit  (reais | centavos)  → crm_leads.value_cents
                          │ dedupe_path           (chave de negócio, ex.: order_id)
                          │ is_active             (desativar é lógico)

crm_lead_activities  (existente)
   type = 'external_event' · payload = { event, event_id, data } · performed_at = hora do evento
   + índice único parcial (organization_id, lead_id, payload->>'event_id')
```

- Tudo tenant-aware, com `organization_id` e RLS `tenant_isolation_crm_pipeline_events_all`.
- A etapa é FK. Nada de nome de etapa em texto, nem lista dentro de coluna.
- Migration em tripla: arquivo em `supabase/migrations/`, apêndice idempotente em `supabase/baseline.sql` e linha `-- manifest:`.
  O número é calculado por `pnpm checar:colisao-de-migration` no momento da criação.

---

## 5. APIs / Interfaces

### MCP: `crm_track_event` (escrita)

```json
// entrada
{ "lead_id": "4cad…", "events": [
  { "event": "page_view", "event_id": "s1-001", "at": "2026-10-29T17:03:00-03:00", "data": { "screen_name": "home" } },
  { "event": "purchase",  "event_id": "ped-123", "data": { "order_id": "PED-123", "value": 73.9, "items": [ ] } }
] }
```

```json
// saída: um resultado por evento, na ordem enviada
{ "lead_id": "4cad…", "resultados": [
  { "event_id": "s1-001", "resultado": "registrado", "estado": "sem_state_key", "valor": "sem_campo", "movimento": "movido", "etapa": "Visitas" },
  { "event_id": "ped-123", "resultado": "registrado", "estado": "aplicado", "valor": "aplicado", "movimento": "movido", "etapa": "Compras" }
] }
```

Resultados: `registrado`, `repetido`, `recusado` (com `codigo` e `mensagem`; `evento_nao_cadastrado` lista as chaves ativas).
Recusar um evento não derruba os outros do lote.

### MCP: `crm_list_pipeline_events` (leitura)

```json
// entrada
{ "pipeline_id": "7443…" }
// saída
{ "eventos": [ { "key": "purchase", "label": "Compra", "ativo": true, "etapa": "Compras", "guarda_estado": true, "define_valor": true } ] }
```

### REST de cadastro, `/api/v1/pipelines/[id]/events`

| Método | Efeito | Observações |
|---|---|---|
| `GET` | Lista os eventos do funil, com último recebimento e contagem de 7 dias | `manager`+ |
| `POST` | Cria | `Idempotency-Key`, Zod, `requireSupportWrite(`, auditoria `pipeline_event.created` |
| `PATCH /:event_id` | Edita | A `key` é imutável se há atividade |
| `DELETE /:event_id` | Desativa (lógico) | Auditoria `pipeline_event.deactivated` |

Auth por cookie de sessão; `organization_id` sempre do JWT, nunca do corpo.

---

## 6. Alternativas Consideradas

| # | Alternativa | Prós | Contras | Veredito |
|---|---|---|---|---|
| A | **Coluna `event_hint` em `crm_stages`**, como o `agent_stage_hint` | Mesmo padrão do mapa do agente; sem tabela nova | Um evento por etapa; não suporta evento customizado nem comportamento por evento (valor, repetição, flag) | Rejeitada |
| B | **`pipeline.settings.events` em jsonb** | Sem migration de tabela; rápido | Anti-pattern 6 do `CLAUDE.md` (jsonb lock-in); sem FK para a etapa; sem unicidade nem RLS por linha; a UI leria o caminho direto | Rejeitada |
| C | **Manter a regra no cliente** (estado atual) | Zero trabalho no núcleo | Cada integrador reescreve níveis, ids e conversões; impossível para quem só consegue colar um script | Rejeitada |
| D | **Estender `crm_add_lead_events` com mover etapa** | Uma ferramenta só | Mistura o contrato permissivo (qualquer nome) com o estrito (só cadastrados); quebra quem já usa | Rejeitada |
| E | **Tabela de eventos recebidos própria** (event store) | Consultas diretas | Duplica a timeline; dois lugares para a fonte de verdade | Rejeitada |
| **F** | **Tabela de cadastro + operação única + histórico em `crm_lead_activities`** | Config no funil; reuso da timeline; suporta customizados sem migration nova; cada efeito idempotente por conta própria | Mais peças no núcleo (tabela, tela, duas ferramentas) | **Escolhida** |

🔴 ADR NEEDED — "Cadastro de eventos por funil em tabela própria (e não coluna ou jsonb)". Registra A, B e F.
🔴 ADR NEEDED — "O histórico (`crm_lead_activities`) é a fonte de verdade do estado de um pedido; `custom_fields` é projeção".
🔴 ADR NEEDED — "Contrato estrito: evento sem cadastro é recusado por evento". Fixa o comportamento de que o integrador depende.

---

## 7. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| 1 | Evento de ganho sem `value_path` fecha venda sem valor e não gera conversão de anúncio | Média | Alto (receita invisível) | Aviso na tela; valor gravado antes do movimento; teste com sabotagem da ordem |
| 2 | Integrador quebra por recusa de nome errado | Média | Médio | `crm_list_pipeline_events`; a mensagem de recusa lista as chaves válidas; recusa por evento |
| 3 | `actor_kind` do movimento feito por token ou pelo próprio evento sair como `user`, e o flag "respeita movimento manual" travar o fluxo | Baixa | Baixo | Resolvido na Fase 0 ([respostas](eventos-do-funil-fase-0.md)): token MCP e webhook gravam `system`; um teste trava isso |
| 4 | O `moveLeadHandler` recusa o ganho por regra do funil (motivo, campo obrigatório) depois de gravar estado e valor | Média | Médio | Resultado explícito `recusado_pelo_funil`; estado e valor permanecem; avisar na tela |
| 5 | Migration deduplica `crm_lead_activities` e há gatilho ou retenção que impeça o `delete` | Baixa | Baixo | Resolvido na Fase 0: nenhum gatilho, política ou retenção apaga a tabela; migration idempotente, testada em `test:db` com dados duplicados |
| 6 | Vazamento entre organizações por filtro esquecido na busca do evento | Baixa | Crítico | RLS + filtro explícito de `organization_id`; invariante de isolamento; sabotagem do filtro |
| 7 | Dois eventos simultâneos movem o card duas vezes | Baixa | Médio | O `moveLeadHandler` já condiciona o `update` ao `updated_at` do pedido (`409 lead_stage_changed_concurrent`); índice único para o histórico |
| 8 | Teto de 30 escritas por minuto estourado em pico | Baixa | Médio | Uma escrita por chamada, qualquer que seja o lote; orientação de lote no guia |
| 9 | Retenção apaga atividades e o `event_id` volta a ser aceito | Baixa | Baixo | Documentar; aceitável |
| 10 | Caminho de JSON ambíguo (arrays, tipos) produz valor errado | Baixa | Médio | Só nomes de campo com ponto; valor não finito ou negativo é recusado |

---

## 8. Plano de Implementação

| Fase | Entregas | Prova de pronto |
|---|---|---|
| **0. Esclarecimentos** (feita: [respostas](eventos-do-funil-fase-0.md)) | Responder os pontos da spec: ator dos movimentos, gatilhos/retenção em `crm_lead_activities`, exigência de ator do `moveLeadHandler`, espelho de `support_write_*` | Respostas por teste ou leitura, anotadas na spec |
| **1. Fundação** | Migration em tripla (`crm_pipeline_events`, índice único, dedupe); funções puras em `lib/leads/eventos-do-funil/`; `23505` tratado em `eventos-externos.ts` | Unit + `pnpm test:db` (isolamento, índice, instalação e atualização), com sabotagem |
| **2. Operação** | `crm_track_event` e `crm_list_pipeline_events`; gates do catálogo, escopo e vocabulário leigo; seção na spec 11 | Unit + prova na stack local com token temporário (sequência de pedido, reenvio, atrasado, desconhecido, movimento manual) |
| **3. Cadastro** | Rotas `/pipelines/[id]/events`; seção na tela com avisos e sinais de uso | Playwright em banco fresco estilo VPS, com os envs opcionais ausentes |
| **4. Documentação e implantação** | Fragmento `.changes/`, atualização de `integracao-mcp-cardapio.md`, cadastro dos eventos da Bella Capri à mão | `pnpm release:conferir`; `gov:verify` e suíte inteira conferidos pelo rodapé |

As etapas 2 e 3 do projeto (porta pública e script; webhook) começam só depois da Fase 4. **Foram feitas depois: veja "Etapas 2 e 3: como ficaram", logo abaixo da seção 9.**

---

## 9. Observabilidade

**Logs** (logger estruturado, nunca `console.log`; sem corpo do evento nem dado pessoal):
por chamada de `crm_track_event`: `request_id`, `organization_id`, `lead_id`, total de eventos e contagem por resultado
(`registrado`, `repetido`, `recusado`) e por código de recusa. Por movimento: etapa de origem e de destino.

**Auditoria:** `mcp.tool_called` para as chamadas (já existe) e `pipeline_event.created|updated|deactivated` para o cadastro.

**Métricas**

| Métrica | Uso |
|---|---|
| Eventos por resultado e por código de recusa, por organização | Achar integração mal configurada |
| Taxa de `repetido` | Reenvios e clique duplo; sinaliza instabilidade de rede do integrador |
| `recusado_pelo_funil` | Regra de funil impedindo ganho |
| Latência da operação, por tamanho de lote | Capacidade |
| Último recebimento e contagem de 7 dias, por evento | Mostrado na própria tela: é o laço de retorno |

**Alertas**
- Sentry para erro inesperado da operação. Recusa de validação **não** vai para o Sentry: é resposta normal ao integrador.
- Pico de `evento_nao_cadastrado` numa organização (por exemplo, mais de 20% dos eventos em 5 minutos): quase sempre cadastro ou nome errado.
- Falha de escrita em `api_audit_log` gera alerta e não bloqueia a mutação, como manda o `CLAUDE.md`.
- Não há alerta de "evento parou de chegar" na etapa 1; o sinal fica na tela.

---

## Etapas 2 e 3: como ficaram (29/10/2026)

O que foi construído depois da etapa 1, e onde **diverge** do que este documento previa ("plugin" e "porta pública com chave").

### Etapa 2: o rastreador no site do cardápio

| Peça | Como ficou |
|---|---|
| Tabela | `crm_tracker_public_keys` (migration 9041): chave `pk_` + 36 hex **gerada pelo banco**, 1 a 20 origens, rótulo, `is_active`, `revoked_at` (revogada implica inativa). RLS: só manager+ lê e escreve |
| API de gestão | `GET/POST /api/v1/pipelines/[id]/tracker-keys`, `DELETE .../[key_id]` (revoga e mantém a linha), com o **uso** de cada chave (`ultimo_recebimento`, `recebidos_7_dias`) lido de `payload.chave_id` no histórico |
| Porta pública | `POST/OPTIONS /api/v1/coleta/{chave}`. **A chave vai no CAMINHO**, não no corpo nem no cabeçalho: o preflight de CORS não tem corpo e precisa saber de qual chave se trata para decidir a origem. Organização e funil saem **só da linha da chave**; o corpo é `strict` |
| Resposta | **Sempre a mesma forma** (`recebido` por evento), seja o `idtrack` bom, ruim ou sem pedido. Só com `debug: true` entra `chaves_cadastradas` (nomes dos eventos ativos, igual para qualquer `idtrack`) |
| Identidade | `idtrack` = id do contato (UUID). Pedido = o **aberto mais recente do contato no funil da chave**; nunca cria pedido; contato pessoal ou anonimizado é descartado |
| Confiança | Evento do navegador grava `origem = navegador`. Destino de **ganho** só fecha se o pedido já registrou um evento de **estado** (cuja etapa não é de ganho nem de perda); destino de **perda** nunca; pedido encerrado só registra. Resultados novos de `movimento`: `navegador_sem_estado_anterior` e `navegador_nao_perde` |
| Script | `public/rastreador.js`: API manual (`init`, `track`, `optOut`, `optIn`, `flush`), fila em lote de 20 a cada 3 s, `event_id` estável, reenvio só de rede/5xx/429, `sendBeacon` na saída, sem dados pessoais. **Nome neutro** porque a imagem serve todas as marcas (o `branding.test` proíbe a marca em código que embarca) |
| Tela | Seção "Rastreador para o site do cardápio" em Configurações › Funis (cria, copia o código, mostra o uso, revoga com confirmação) |

**Divergências do desenho original:** não é "plugin" nem observa a página: a API é manual por decisão do debate. A compra pode sair do navegador (com as travas acima); o cancelamento **não**.
**Resíduo aceito:** quem conhece o `idtrack` e forja carrinho e compra fecha o pedido daquele cliente; ver [`threat-model.md`](../threat-model.md) seção 1.2. O 404 de chave revogada não leva CORS, então o navegador o vê como erro de rede e o script tenta algumas vezes antes de desistir.

### Etapa 3: o webhook de entrada com valor e JSON

| Peça | Como ficou |
|---|---|
| Colunas | `webhook_sources.value_path` e `value_unit` (migration 9042, juntos ou nenhum) e `payload_state_key` (9043). Só entram no `PATCH` da fonte |
| Valor | Lido do corpo cru com a mesma régua dos eventos (`resolverCaminho`, `valorEmCentavos`); grava `value_cents` na criação e no reaproveitamento/reenvio, **antes** de mover a etapa. Valor ausente ou ilegível nunca derruba o envio (log) |
| JSON | As chaves de primeiro nível do corpo cujo valor é objeto ou lista ficam juntas sob `payload_state_key` em `custom_fields`, até 32 KB (medido em bytes). A comparação do reenvio é por JSON, não por `String()`. A chave não pode ser campo declarado do funil (recusada no `PATCH`) |
| Tela | Seção "Valor e itens do pedido" no painel da fonte, com os avisos de etapa padrão de ganho sem valor e de "a etapa padrão vale para todo envio" |
| Relatórios | `relatorios-bellacapri.sql` separa por origem (`whatsapp` / `webhook` / `outros`) |

**Lacuna declarada:** o produto **não reconhece a mesma compra chegando pelas duas portas** (rastreador e webhook): cada uma tem a sua regra de repetição. Ver [`../integracao/webhook-ou-rastreador.md`](../integracao/webhook-ou-rastreador.md).

---

## Decisões que precisam de ADR

1. 🔴 Cadastro de eventos em tabela própria por funil.
2. 🔴 Histórico como fonte de verdade; `custom_fields` como projeção.
3. 🔴 Contrato estrito: evento sem cadastro é recusado por evento.
