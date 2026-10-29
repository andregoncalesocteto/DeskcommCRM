-- manifest: Eventos do funil, etapa 2 — chaves públicas do rastreador (crm_tracker_public_keys): identificador público por funil com as origens permitidas; NÃO é segredo, revogar desativa na hora.
-- Um script no navegador do cliente final manda eventos sem token secreto: a chave identifica a organização e o funil (nunca o corpo da
-- requisição) e só vale vinda de uma origem cadastrada. É um endereço, não uma senha: o que protege é a lista de origens, o limite de taxa
-- e as regras de confiança da porta pública. A chave nasce no banco (sem o servidor escolher o valor) e nunca é reaproveitada.
create table if not exists public.crm_tracker_public_keys (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  pipeline_id      uuid not null references public.crm_pipelines(id) on delete cascade,
  public_key       text not null default ('pk_' || encode(extensions.gen_random_bytes(18), 'hex')),
  label            text not null,
  allowed_origins  text[] not null,
  is_active        boolean not null default true,
  revoked_at       timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint crm_tracker_public_keys_chave_unica unique (public_key),
  constraint crm_tracker_public_keys_formato check (public_key ~ '^pk_[a-f0-9]{36}$'),
  constraint crm_tracker_public_keys_label_tamanho check (char_length(label) between 1 and 80),
  constraint crm_tracker_public_keys_origens_quantidade check (cardinality(allowed_origins) between 1 and 20),
  -- Revogar desativa na hora: não existe chave revogada que ainda valha.
  constraint crm_tracker_public_keys_revogada_inativa check (revoked_at is null or is_active = false)
);

comment on table public.crm_tracker_public_keys is
  'Chaves públicas do rastreador por funil. A chave é um identificador público (vai no HTML do site), não um segredo: a proteção é a lista de origens permitidas, o limite de taxa e as regras de confiança da porta pública.';
comment on column public.crm_tracker_public_keys.allowed_origins is
  'Origens (esquema + host + porta) de onde a chave vale. Validadas na API: https, ou http só em localhost.';
comment on column public.crm_tracker_public_keys.revoked_at is
  'Quando a chave foi revogada. Revogada implica is_active=false (constraint); a chave nunca volta.';

-- Leitor: a tela lista as chaves de um funil.
create index if not exists crm_tracker_public_keys_por_funil
  on public.crm_tracker_public_keys (organization_id, pipeline_id);
-- Leitor: a FK de pipeline_id (apagar funil varre a coluna).
create index if not exists crm_tracker_public_keys_por_pipeline
  on public.crm_tracker_public_keys (pipeline_id);

create or replace trigger trg_crm_tracker_public_keys_updated_at
  before update on public.crm_tracker_public_keys
  for each row execute function public.fn_set_updated_at();

alter table public.crm_tracker_public_keys enable row level security;

-- `revoke all` PRIMEIRO: o default ACL do baseline concede tudo a anon e authenticated em toda tabela nova.
-- Só o gerente lê e escreve pela sessão (a chave de uma organização não é assunto do viewer); a porta pública usa
-- o service_role e resolve a organização pela PRÓPRIA linha da chave.
revoke all on public.crm_tracker_public_keys from anon, authenticated;
grant select, insert, update, delete on public.crm_tracker_public_keys to authenticated;
grant all on public.crm_tracker_public_keys to service_role;

drop policy if exists tenant_isolation_crm_tracker_public_keys_all on public.crm_tracker_public_keys;
create policy tenant_isolation_crm_tracker_public_keys_all
  on public.crm_tracker_public_keys
  for all to authenticated
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'manager')
  );

do $f$ begin perform public.fn_aplicar_travas_de_suporte(); end $f$;

notify pgrst, 'reload schema';
