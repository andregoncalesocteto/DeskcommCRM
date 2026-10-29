-- manifest: Eventos do funil — cadastro por funil (crm_pipeline_events): chave, etapa de destino, valor, repetição e flags; nasce vazia, sem semente (ADR-0007).
-- Cada funil declara os fatos que sistemas de fora contam ao CRM (visita, item, carrinho, compra...) e para onde o card vai em cada um.
-- A etapa é FK (apagar a etapa anula o destino, não deixa id morto); a chave é única por funil; o histórico continua em crm_lead_activities.
create table if not exists public.crm_pipeline_events (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  pipeline_id          uuid not null references public.crm_pipelines(id) on delete cascade,
  key                  text not null,
  label                text not null,
  description          text,
  stage_id             uuid references public.crm_stages(id) on delete set null,
  respects_manual_move boolean not null default true,
  state_key            text,
  value_path           text,
  value_unit           text,
  dedupe_path          text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint crm_pipeline_events_chave_unica unique (pipeline_id, key),
  constraint crm_pipeline_events_key_formato check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint crm_pipeline_events_label_tamanho check (char_length(label) between 1 and 80),
  constraint crm_pipeline_events_descricao_tamanho check (description is null or char_length(description) <= 500),
  constraint crm_pipeline_events_state_key_formato check (state_key is null or state_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint crm_pipeline_events_unidade check (value_unit is null or value_unit in ('reais', 'centavos')),
  constraint crm_pipeline_events_valor_junto check ((value_path is null) = (value_unit is null)),
  constraint crm_pipeline_events_caminho_do_valor check (
    value_path is null
    or (char_length(value_path) <= 200 and value_path ~ '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$')
  ),
  constraint crm_pipeline_events_caminho_da_repeticao check (
    dedupe_path is null
    or (char_length(dedupe_path) <= 200 and dedupe_path ~ '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$')
  )
);

comment on table public.crm_pipeline_events is
  'Cadastro de eventos de um funil: o que um sistema externo pode contar ao CRM e para onde o card vai em cada fato. Nasce vazia; nada é semeado com o funil.';
comment on column public.crm_pipeline_events.stage_id is
  'Etapa de destino do card quando o evento chega. Nula = só registra. A API valida: mesmo funil, não arquivada, nunca de perda.';
comment on column public.crm_pipeline_events.respects_manual_move is
  'Verdadeiro: se o último movimento do pedido foi de uma pessoa, o evento registra mas não move.';
comment on column public.crm_pipeline_events.state_key is
  'Chave de custom_fields onde o último conteúdo do evento fica (o mais novo vence). Projeção do histórico, não a verdade.';

-- Leitor: a tela de cadastro e a operação do MCP listam os eventos de um funil.
create index if not exists crm_pipeline_events_por_funil
  on public.crm_pipeline_events (organization_id, pipeline_id);
-- Leitor: a FK de stage_id (apagar etapa varre a coluna para anular o destino).
create index if not exists crm_pipeline_events_por_etapa
  on public.crm_pipeline_events (stage_id)
  where stage_id is not null;

create or replace trigger trg_crm_pipeline_events_updated_at
  before update on public.crm_pipeline_events
  for each row execute function public.fn_set_updated_at();

alter table public.crm_pipeline_events enable row level security;

-- `revoke all` PRIMEIRO: o default ACL do baseline concede tudo a anon e authenticated em toda tabela nova.
-- Leitura e escrita pela sessão do gerente (RLS decide); o servidor (service_role) mantém o acesso total.
revoke all on public.crm_pipeline_events from anon, authenticated;
grant select, insert, update, delete on public.crm_pipeline_events to authenticated;
grant all on public.crm_pipeline_events to service_role;

-- Leitura: qualquer membro da organização. Escrita: gerente ou mais. São duas políticas porque DELETE só passa
-- pelo USING: uma política única `for all` com USING só de organização deixaria um `viewer` apagar o cadastro.
drop policy if exists tenant_isolation_crm_pipeline_events_select on public.crm_pipeline_events;
create policy tenant_isolation_crm_pipeline_events_select
  on public.crm_pipeline_events
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists tenant_isolation_crm_pipeline_events_write on public.crm_pipeline_events;
create policy tenant_isolation_crm_pipeline_events_write
  on public.crm_pipeline_events
  for all to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  );

-- travas do suporte, depois de toda tabela nova (migration 0274): a tabela é gravável por authenticated,
-- então a função lhe planta as três políticas restritivas `support_write_*`.
do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
