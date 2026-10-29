# Eventos do funil: o que acontece fora do CRM, e para onde o card vai

**Data:** 29/10/2026 · **Status:** proposta. Debate fechado com o autor; falta aprovação deste texto.
**Escopo deste documento:** etapa 1 de 3 (núcleo: tabela, tela e operação no MCP).
As etapas 2 (porta pública e plugin para o navegador) e 3 (valor e JSON no webhook de entrada) vêm depois e só usam o que a etapa 1 entrega.

## Problema

Um cardápio digital, uma página de agendamento ou um portal de imóveis sabe o que o cliente
faz: abriu, viu um item, montou o carrinho, comprou. O CRM só sabe disso se alguém contar, e
hoje contar exige que o sistema de fora conheça os ids das etapas do funil, guarde a própria
tabela de "níveis" para o pedido não retroceder, e junte três chamadas (registrar, atualizar,
mover). Medido na Bella Capri (guia `integracao-mcp-cardapio.md`): um pedido típico gasta cerca de
9 escritas, e o terceiro que integra precisa reescrever toda a regra.

A regra "este fato leva o card para esta etapa" é configuração do funil. Deve morar no funil.

## Decisões já tomadas no debate

1. **Os eventos pertencem ao funil e são cadastrados à mão.** Nada nasce junto com o funil, e não
   há modelo pronto. Não presumimos que funis novos se parecerão.
2. **Evento sem cadastro é recusado**, por evento (os válidos do mesmo lote passam).
3. **Todo evento aceito vai para o histórico.** Estado e movimento são consequências opcionais,
   configuradas no cadastro.
4. **Movimento manual da equipe é respeitado por um flag no cadastro do evento.**
5. **"Compra" não é um tipo.** É o que acontece quando o cadastro junta: etapa de destino de
   ganho, campo do valor, chave de repetição e "não respeita movimento manual".
6. **O pedido não retrocede.** A ordem é a das etapas do funil.
7. **Entrega em três etapas.** Este documento é a primeira.

## Destino da mudança (DoD 18)

**Núcleo.** Pergunta de medida: "se nenhuma organização ativar isto, a operação comum continua
inteira?" Sim, e por isso é opcional; mas o mecanismo (evento externo para etapa, valor e estado
do negócio) é geral: serve a cardápio, clínica ("agendou", "compareceu"), imobiliária
("visitou_imovel"). Extensão declarativa não pode: ela hoje não tem tabela, rota nem ferramenta.
Nada aqui é específico de nicho; o vocabulário de e-commerce aparece só nos exemplos.

## Modelo de dados

### Tabela `crm_pipeline_events`

Uma linha por evento cadastrado em um funil.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `organization_id` | uuid not null | FK `organizations(id) on delete cascade` |
| `pipeline_id` | uuid not null | FK `crm_pipelines(id) on delete cascade` |
| `key` | text not null | `^[a-z][a-z0-9_]{0,63}$`. **Imutável** depois que existir qualquer atividade com ela (o histórico guarda o nome). Única por funil |
| `label` | text not null | 1 a 80 caracteres. É o que as telas mostram |
| `description` | text null | até 500 caracteres |
| `stage_id` | uuid null | FK `crm_stages(id) on delete set null`. Etapa de destino; nula = só registra. Validada na API: do mesmo funil, não arquivada, **não de perda** |
| `respects_manual_move` | boolean not null default true | Ver "Movimento" |
| `state_key` | text null | Chave de `custom_fields` onde o último conteúdo fica. Mesma regex da `key`; não pode ser igual à chave de um campo declarado do funil (a API valida) |
| `value_path` | text null | Caminho no JSON (`value`, `pedido.total`) que vira `value_cents` |
| `value_unit` | text null | `reais` ou `centavos`; `check`. `value_path` e `value_unit` vêm juntos ou nenhum |
| `dedupe_path` | text null | Caminho no JSON que identifica o fato de negócio (`order_id`) |
| `is_active` | boolean not null default true | Desativar é lógico: preserva histórico e cadastro |
| `created_at`, `updated_at` | timestamptz not null | `now()` |

- **Unicidade:** `unique (pipeline_id, key)`. Índice em `(organization_id, pipeline_id)`.
- **RLS:** `tenant_isolation_crm_pipeline_events_all` via `fn_user_org_ids()`, no padrão do repositório.
  Escrita para `manager` ou mais, seguindo o que `crm_stages` já faz (`crm_stages_manager_write`). As políticas
  restritivas `support_write_*` **não** se escrevem à mão: `fn_aplicar_travas_de_suporte()` as planta em toda tabela elegível, e a
  migration termina com `select public.fn_aplicar_travas_de_suporte();` (Fase 0, pergunta 4).
- **Doutrina DIRC:** a etapa é FK (não texto); o "é compra" é calculado (destino de ganho), não armazenado;
  vocabulário de `value_unit` é pequeno e fechado, então vira `check` (diferente de `crm_lead_activities.type`,
  que é vocabulário aberto).
- **Caminhos (`*_path`):** só nomes de campo, com ponto para aninhar. Sem índice de array, sem expressão,
  sem JSONPath. Resolvidos por uma função pura, testada, que devolve `undefined` quando não acha.

### Índice único de `event_id` em `crm_lead_activities`

Hoje a deduplicação por `event_id` é "ler e depois inserir" (`lib/leads/eventos-externos.ts`), e duas
chamadas simultâneas com o mesmo id podem gravar as duas. O banco passa a garantir:

```sql
create unique index if not exists uniq_lead_activities_external_event_id
  on crm_lead_activities (organization_id, lead_id, (payload->>'event_id'))
  where type = 'external_event' and payload ? 'event_id';
```

- O escopo é por pedido, não por organização: dois cardápios com ids simples ("1", "2") não colidem.
- A migration **deduplica antes** (mantém a linha mais antiga) e é idempotente, como manda a doutrina.
  Antes de escrever o `delete`, confirmar se algum gatilho ou política de retenção impede apagar linhas dessa tabela.
- `registrarEventosDoNegocio` passa a tratar `23505` como `repetido`.

### Migration em tripla

Arquivo em `supabase/migrations/` com `-- manifest:`, apêndice idempotente em `supabase/baseline.sql`
(`create table if not exists`, `create index if not exists`, políticas condicionais), e função/grants revogados
para `anon` e `public` se alguma função nova for criada. O número sai de `pnpm checar:colisao-de-migration`
no momento de criar o arquivo. Nada é semeado: instalações existentes ficam com zero eventos.

## A operação: `crm_track_event` (MCP, escrita)

Escopo `mcp:write`, papel `agent`, uma escrita no teto do token (30 por minuto) por chamada, qualquer que seja o lote.

**Entrada**

```json
{
  "lead_id": "<id do pedido>",
  "events": [
    { "event": "purchase", "event_id": "ped-123-compra", "at": "2026-10-29T14:03:00-03:00",
      "data": { "order_id": "PED-123", "value": 73.9, "items": [ ... ] } }
  ]
}
```

- `lead_id` e `events` (1 a 50), `event` e `event_id` **obrigatórios** (diferente de `crm_add_lead_events`, onde
  `event_id` é só recomendado). `at` e `data` opcionais. Limites herdados: 8 KB por evento, 64 KB por chamada,
  `at` até 30 dias atrás e 5 minutos à frente.
- O funil vem do **pedido** (`crm_leads.pipeline_id`), nunca da entrada.
- Pedido de contato `is_personal` é recusado (403), como em `crm_add_lead_events`.

**Saída: um resultado por evento, na ordem enviada**

```json
{ "lead_id": "...", "resultados": [
  { "event_id": "ped-123-compra", "resultado": "registrado",
    "estado": "aplicado", "valor": "aplicado", "movimento": "movido", "etapa": "Compras" }
] }
```

| `resultado` | Quando |
|---|---|
| `registrado` | Entrou no histórico. Traz `estado`, `valor` e `movimento` (abaixo) |
| `repetido` | Mesmo `event_id`, ou mesma chave de repetição (`dedupe_path`) já registrada. Nada mais é feito |
| `recusado` | Com `codigo` e `mensagem`. Nada é gravado para esse evento |

Códigos de recusa: `evento_nao_cadastrado` (a mensagem lista as chaves ativas do funil), `evento_inativo`,
`valor_invalido`, `evento_grande`, `hora_fora_da_janela`. Recusa de um evento nunca derruba os outros do lote.

Subresultados de um `registrado`:
`estado` ∈ `aplicado` · `sem_state_key` · `ignorado_antigo` · `ignorado_pedido_encerrado`;
`valor` ∈ `aplicado` · `sem_campo` · `ignorado_pedido_encerrado`;
`movimento` ∈ `movido` · `sem_destino` · `ja_na_etapa_ou_adiante` · `respeita_movimento_manual` ·
`pedido_encerrado` · `etapa_arquivada` · `conflito` (outro movimento simultâneo) · `recusado_pelo_funil` (com a mensagem do funil).

### Algoritmo, por evento, em ordem

1. **Validar:** a chave existe no funil do pedido e está ativa; o tamanho; a hora.
2. **Repetição de negócio:** se `dedupe_path` está definido e já existe atividade do mesmo evento neste pedido com o mesmo
   valor nesse caminho, devolve `repetido`.
3. **Registrar:** insere a atividade `external_event` (com `performed_at = at`). Se o índice único responder `23505`,
   devolve `repetido`.
4. **Estado** (só se `state_key`): aplica se `at` é igual ou mais novo que o último evento com a mesma chave neste pedido,
   lido do próprio histórico (`max(performed_at)` das outras linhas). Pedido encerrado não muda de estado.
5. **Valor** (só se `value_path`): converte para centavos inteiros (`reais`: arredonda `valor*100`; `centavos`: exige inteiro),
   exige número finito, não negativo e dentro de um teto fixo. Aplicado **antes** do movimento, com o estado, numa única
   atualização do pedido.
6. **Movimento** (só se há `stage_id` ativo e não arquivado): regras abaixo.

Os passos 4 a 6 **não** dependem de o passo 3 ter sido novo: cada um se protege sozinho (hora, ordem de etapa), para uma
queda no meio do caminho se recuperar no reenvio.

### Regras do movimento

- **Não retrocede.** Seja `M` o conjunto das etapas de destino dos eventos ativos do funil. Se a etapa atual do pedido
  está em `M`, o evento só move se a posição da etapa de destino for **maior**. Se a etapa atual não está em `M`
  (Conversas, "Chamar humano" ou outra), o pedido pode seguir para o destino. Com isso, um desvio depois de Revisão não trava a compra.
- **Pedido encerrado** (ganho ou perdido): não se move.
- **Respeita movimento manual** (`respects_manual_move = true`): se o último `stage_changed` do pedido tem
  `actor_kind = 'user'`, o evento é registrado e não move. O estado e o valor continuam sendo gravados. Como o próprio
  evento move com ator `system`, o ciclo se refaz sozinho depois do primeiro evento que não respeita (por exemplo, a compra).
- **Mover para o mesmo lugar** não gera `stage_changed` (diferente do `crm_move_lead_stage`, que gera um evento sem efeito).
- **Etapa de ganho** passa pelo `moveLeadHandler`, com as regras do funil (motivo de ganho, campos obrigatórios). Se o funil
  recusar, o resultado é `recusado_pelo_funil`, e o estado e o valor já gravados permanecem.
- **Corrida:** o `moveLeadHandler` já condiciona o `update` ao `updated_at` do pedido; o segundo movimento simultâneo recebe
  `409 lead_stage_changed_concurrent`, que a operação devolve como `movimento: conflito` (Fase 0, pergunta 3).

### Reuso

`buildLeadActivityRow` (com `performedAt`), `registrarEventosDoNegocio` (ajustada para `23505`), `moveLeadHandler`,
`updateLeadHandler`. Sem tabela de eventos separada da timeline: o histórico é `crm_lead_activities`. O que o pedido guarda
em `custom_fields` é projeção do último evento, e a fonte de verdade é o histórico.

## Leitura: `crm_list_pipeline_events` (MCP, leitura)

Entrada `{ pipeline_id }`. Devolve as chaves cadastradas com `label`, se está ativa e se tem destino, estado ou valor.
Quem integra consulta a lista em vez de adivinhar o nome. Nunca devolve ids de etapa além do nome da etapa.

## A tela e a API de cadastro

- **Onde:** em **Configurações › Funis › Etapas do funil**, uma seção nova, **"Para onde o card vai em cada evento"**,
  abaixo de "Para onde o card vai em cada passo" (`app/app/settings/tenant/pipelines/_mapping.tsx`). É seção de uma tela
  existente: não precisa de entrada nova em `lib/navigation/catalogo.ts`.
- **Cada linha:** nome, chave, etapa de destino (ou "Não mover"), e um painel recolhível com as opções avançadas
  (guardar em, campo do valor e unidade, chave de repetição, respeitar movimento manual). Mostra também "visto pela última vez"
  e a contagem dos últimos 7 dias, lidas do histórico: é o sinal de que o evento está chegando.
- **Avisos (não bloqueiam):**
  - destino de ganho sem campo do valor: "esta etapa fecha a venda, mas o evento não define o valor, então a venda não será
    enviada como conversão";
  - etapa de destino arquivada: o evento passa a só registrar;
  - `state_key` igual à chave de um campo declarado: bloqueia (é erro, não aviso).
- **Rotas** (`app/api/v1/pipelines/[id]/events`): `GET` lista, `POST` cria (aceita `Idempotency-Key`), `PATCH /:event_id`
  edita (a `key` é imutável se houver atividade), `DELETE /:event_id` desativa (lógico). Papel `manager`+; `organization_id`
  do JWT; cada handler mutante declara `requireSupportWrite(` antes do efeito; Zod em toda entrada; uma entrada em `api_audit_log`
  por mutação (`pipeline_event.created`, `.updated`, `.deactivated`).

## Documentos e catálogos que acompanham

- **Gates do MCP:** `lib/mcp/tools/catalogo/funil.ts` (rótulo e risco, sem jargão: "Registrar o que o cliente fez fora do
  CRM"), `lib/ai/runtime/escopo-das-escritas.ts` (`crm_track_event: { lead_id: "negocio" }`), `lib/leads/escopo-de-funil.ts`
  (`funil_vem_do_lead`), `tests/unit/capacidade-alcancavel-pelo-agente.test.ts` (trabalho de atendente) e o gate de
  vocabulário leigo.
- **Spec do MCP:** seção nova em `docs/specs/11-spec-mcp-server-internal.md`.
- **Release:** `.changes/mcp-eventos-do-funil.md`, `impacto: capacidade_nova`.
- **Guia da Bella Capri:** `integracao-mcp-cardapio.md` passa a descrever a operação nova (a atual continua válida até lá).

## Living System Checklist (DoD 13)

| Pergunta | Resposta |
|---|---|
| Entrada | `crm_track_event` (MCP) e o cadastro pela tela |
| Saída | Atividade `external_event`; `stage_changed` quando move, o que já alimenta automações, follow-ups e conversões de anúncio |
| Log | Atividades na timeline do pedido; `api_audit_log` para o cadastro e `mcp.tool_called` para as chamadas |
| Tela | A seção nova em Etapas do funil e a timeline do pedido |
| Porta | Seção dentro de uma tela já alcançável pela navegação |
| Anti-morte | Evento sem destino ou com etapa arquivada continua registrando; "visto pela última vez" mostra quem parou de chegar |
| Laço de retorno | A tela mostra o que entrou e quando; a recusa devolve a lista de chaves válidas ao integrador |

## Testes e provas

**Unitários**
- Resolução de caminho (`order_id`, `pedido.total`, ausente, tipo errado).
- Conversão de valor (reais e centavos, arredondamento, negativo, não finito, teto).
- Decisão de movimento como função pura: matriz de etapa atual dentro e fora de `M`, destino à frente e atrás,
  pedido encerrado, movimento manual com flag ligado e desligado, etapa arquivada.
- Ordem do estado por `at`: evento atrasado não sobrescreve.
- Orquestração com banco falso: lote misto (válido, desconhecido, repetido) devolve um resultado por evento, na ordem.

**Invariantes de banco (`pnpm test:db`)**
- Isolamento entre duas organizações em `crm_pipeline_events` (leitura e escrita).
- Índice único de `event_id`: a segunda inserção em paralelo falha com `23505`; o escopo é por pedido.
- Migration em modo instalação e atualização, com dados duplicados antes do índice.

**Sabotagem** (cada linha prevista com o número de casos vermelhos): tirar o filtro de `organization_id` da busca do evento;
trocar "maior" por "maior ou igual" na posição; ignorar o `actor_kind`; aplicar o valor depois do movimento; remover o tratamento de `23505`.

**Prova com o MCP direto** (token temporário, apagado ao final): na stack local, sequência completa de um pedido
de cardápio, reenvio idêntico, evento atrasado, evento desconhecido, movimento manual no meio.

**Prova pela tela** (Playwright, banco fresco, envs opcionais ausentes): criar o funil, cadastrar eventos à mão, ver os
avisos, chamar a operação por fora e ver a timeline e o card mudarem.

Esta etapa **não** passa por agente de IA; a regra do par (DoD 12) não se aplica. A Bella não usa a operação.

## Fora desta etapa

- Porta pública com chave, CORS e plugin para o navegador (etapa 2).
- Valor e JSON no webhook de entrada (etapa 3).
- Link assinado, "aplicar modelo", eventos por perfil de usuário.
- Mostrar o `label` do evento no lugar de "Registro de uma integração" na timeline (melhoria posterior, sem schema).
- Mudar `crm_add_lead_events`: ela segue aceitando qualquer nome, para não quebrar quem usa.

## Riscos e pontos a confirmar na implementação

1. ~~`actor_kind` das mudanças de etapa por token MCP~~: respondido na Fase 0, grava `system`; falta o teste que trava isso.
2. ~~Gatilho ou retenção que impeça o `delete`~~: respondido na Fase 0, nada impede.
3. ~~Ator do `moveLeadHandler`~~: respondido na Fase 0, nenhuma regra de funil exige ator humano.
4. Retenção das atividades: apagada a atividade, o `event_id` pode voltar a ser aceito. Aceitável, mas deve constar na documentação.
5. Cadastro com `state_key` repetido entre dois eventos do mesmo funil (o último escreve): permitir ou bloquear. Proposta: avisar.
6. O teto do valor da venda: fixo no código (proposta: R$ 1.000.000,00) ou por organização.
