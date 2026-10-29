# Eventos do funil: respostas da Fase 0

**Data:** 29/10/2026 · **Base:** `20963bb71`/`3fd3858d6` (`main` local) · **História:** US-001 do `docs/ralph/prd.json`
Quatro perguntas que o [Design Doc](eventos-do-funil.md) deixou abertas. Cada resposta traz a evidência e a conclusão.
Nenhum código de produção foi alterado para respondê-las.

## Resumo

| # | Pergunta | Resposta | Muda o Design Doc? |
|---|---|---|---|
| 1 | Algum movimento feito por token MCP ou pelo próprio evento grava `actor_kind = 'user'`? | **Não.** Token MCP grava `system`; só ator `user` (sessão de pessoa) grava `user` | Não: confirma o risco 3 como baixo |
| 2 | Algo impede `delete` em `crm_lead_activities`? | **Não.** Só há gatilhos de `insert`; nenhuma política, rotina ou retenção apaga a tabela | Não: libera a deduplicação por `delete` (risco 5) |
| 3 | O `moveLeadHandler` exige ator humano? | **Não para mover.** As regras de funil valem para todos os atores; só a detecção de "correção da IA" olha ator humano | Sim: a condição de corrida já é por `updated_at` |
| 4 | `crm_pipeline_events` precisa espelhar `support_write_*`? | **Não à mão.** As políticas são plantadas por função, para toda tabela elegível | Sim: a migration deve chamar a função |

---

## 1. `actor_kind` dos movimentos

**Código.** `actorParaAtividade` (`lib/leads/activity-emitter.ts`) decide o tipo gravado a partir do ator do contexto:

- `ctx.actor.type === "user"` → `user` (uma pessoa, por sessão);
- `ai_agent` → `ai` (ou `system`, se não houver lastro de execução);
- qualquer outro (`api_token`, `webhook_source` e afins) → `system`.

O token MCP resolve para um ator `api_token` (`lib/mcp/auth-resolve-api-token.test.ts`). O `deriveActor` só o torna `ai_agent`
quando o token carrega os escopos `actor:ai_agent` e `agent_run:<id>`; um token comum de integração não os tem.

**Prova ao vivo (29/10/2026, stack local, token temporário apagado ao final).** Um pedido de teste movido por
`crm_move_lead_stage` pelo endpoint real `/api/mcp` gravou:

```
stage_changed | system | performed_by_user_id é nulo
```

Conferido depois: 0 pedidos de teste e 0 tokens temporários restantes.

**Conclusão.** Nenhum caminho de integração grava `user`. O flag `respects_manual_move` pode olhar `actor_kind = 'user'` como
"movimento manual" sem confundir o movimento do próprio evento (ator `api_token` ou `webhook_source`, portanto `system`).
Fica um teste para travar isso (US-010).

## 2. Gatilhos, políticas e retenção em `crm_lead_activities`

**Consulta ao catálogo (banco local).**

- Gatilhos: só `trg_update_last_activity_at` e `trg_validate_activity_lead_org`, ambos `AFTER/BEFORE INSERT`. **Nenhum bloqueia `delete`.**
- Políticas: `crm_lead_activities_select`, `crm_lead_activities_insert` e as `support_write_*`. Não há política de `update` ou `delete`
  para `authenticated`, o que vale para quem passa pelo PostgREST. O dono do schema (que roda a migration) não depende disso.
- Concessões: `anon`, `authenticated` e `service_role` têm `UPDATE`, `DELETE` e `TRUNCATE` na tabela. Ao contrário de `api_audit_log`
  (endurecida pela migration 0258), esta tabela **não** é append-only.
- Funções que apagam a tabela: nenhuma (`prosrc` sem `delete from … crm_lead_activities`). Busca no código (`lib`, `app`) e no
  `supabase/baseline.sql`: nenhuma retenção por cron apaga linhas dela. As únicas remoções são em cascata: `crm_lead_activities_lead_id_fkey`
  (`ON DELETE CASCADE`) e `..._organization_id_fkey` (`ON DELETE CASCADE`). `contact_id` é `ON DELETE SET NULL`.

**Conclusão.** A deduplicação por `delete` na migration do índice único é possível. O que pode remover atividades é apagar o pedido ou a
organização. Consequência já registrada no ADR-0008: sem o histórico a projeção continua, mas a verdade se perdeu.

## 3. `moveLeadHandler` e o ator

Leitura de `app/api/v1/leads/_handler.ts` (`moveLeadHandler`):

- **Regras de funil valem para todo ator:** pedido de outra organização (404), troca de funil (422), reabertura de negócio encerrado
  (`recusaReabertura`, 409 com `/retomar`), campos obrigatórios por etapa (`validaCamposExigidos`, 422 com `details.faltando`), motivo de ganho
  (`recusaDeMotivoDoGanho`) e motivo de perda (`decideMotivoDaPerda`).
- **Mover para a mesma etapa** não pula `stage_changed`: o handler a trata como reordenação (pula só a régua de campos), mas ainda emite a atividade.
  Por isso a decisão de movimento do evento (US-007) precisa descartar "já na etapa" **antes** de chamar o handler.
- **Concorrência já resolvida:** o `update` leva `.eq("updated_at", lead.updated_at)`. Dois movimentos simultâneos fazem o segundo cair em
  `409 lead_stage_changed_concurrent`. A condição é o `updated_at` do pedido, não "a etapa que li".
- **Onde o ator humano importa:** só no bloco que detecta `agent_move_corrected` (quando uma pessoa corrige a IA). É analítica e roda
  depois do movimento; não permite nem recusa nada.

**Conclusão.** O evento pode mover com ator `api_token`/`webhook_source` sem obstáculo de papel. As recusas do funil (campo obrigatório,
motivo de ganho) devem virar o resultado `recusado_pelo_funil`. A guarda contra corrida é o `updated_at` do handler; o `409` concorrente vira
"tentar de novo na leitura seguinte" ou `movimento: conflito` no resultado (US-010).

## 4. Políticas `support_write_*` em `crm_stages` e na tabela nova

`crm_stages` tem `support_write_insert`, `support_write_update` e `support_write_delete`, **restritivas** e baseadas em
`fn_support_write_allowed(organization_id)`. São 124 tabelas com o mesmo padrão. Elas **não** são escritas à mão em cada migration:
a função `public.fn_aplicar_travas_de_suporte()` (migration 0274) as planta em **toda** tabela de `public` com RLS, `organization_id` e
escrita concedida a `authenticated`.

- No `supabase/baseline.sql`, a chamada é o **último bloco** do arquivo; uma instalação nova e uma atualização chegam ao mesmo conjunto.
- Em migrations isoladas, as que criam tabela terminam com `select public.fn_aplicar_travas_de_suporte();` (exemplos: 0482, 0661).

**Conclusão.** `crm_pipeline_events` **não** precisa de espelho manual. A migration (US-002) deve terminar com a chamada da função, e o
apêndice do baseline herda o último bloco. A mesma regra vale para a tabela de chaves públicas da etapa 2.

---

## Mudanças no Design Doc e na spec

- Risco 3: reclassificado como baixo, com a evidência acima.
- Risco 5: sem impedimento encontrado; deduplicação por `delete` liberada.
- Risco 7 e as regras de movimento: a condição de corrida é o `updated_at` do pedido, via `409 lead_stage_changed_concurrent`.
- Modelo de dados: a migration termina com `select public.fn_aplicar_travas_de_suporte();`.

## O que não foi medido

- O comportamento do `deriveActor` com um token que **tenha** `actor:ai_agent`: pela leitura do código seria `ai`; não foi exercitado ao vivo.
- Se alguma instalação de cliente tem política de retenção própria fora do código do repositório.
