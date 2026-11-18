-- manifest: Módulo PDV — um contato do CRM pode ter vários clientes do ERP: `fn_pdv_provisionar()` deixa de criar a unicidade (organização, contato) em `pdv_customer_links` e a remove de quem já a tinha (continua único por (organização, cliente do ERP)); dados e RLS intactos, idempotente.
-- UM CONTATO, VÁRIAS FICHAS DO ERP (ADR-008 do módulo).
--
-- O ERP duplica a mesma pessoa (mesmo telefone, fichas diferentes) e o telefone é a chave do contato
-- no CRM. Com a unicidade por contato, a segunda ficha ficava sem vínculo e, sem vínculo, sem pedido.
-- Agora cada ficha do ERP tem a sua linha e várias linhas podem apontar para o mesmo contato.
--
-- Redefine a MESMA provisionadora da 9045 com `create or replace`; a tabela e a RLS seguem como
-- estavam. Para o banco que JÁ tem o módulo instalado, o bloco `do` ao fim remove a constraint
-- antiga sem esperar a próxima instalação do módulo.
--
-- DESTINO (DoD 18): extensão (mesma razão da 9044).
--
create or replace function public.fn_pdv_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.pdv_stores (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    erp_store_code text not null,
    sigla text not null,
    nome text not null,
    ativa boolean not null default true,
    channel_session_id uuid references public.channel_sessions(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint pdv_stores_org_sigla_unico unique (organization_id, sigla),
    constraint pdv_stores_org_erp_code_unico unique (organization_id, erp_store_code)
  );

  create index if not exists pdv_stores_org_idx
    on public.pdv_stores (organization_id);
  create index if not exists pdv_stores_channel_session_idx
    on public.pdv_stores (channel_session_id) where channel_session_id is not null;

  comment on table public.pdv_stores is
    'Lojas que o tenant atende (módulo PDV, ADR-001 do módulo). Mantidas na aba Lojas; channel_session_id liga a conexão de WhatsApp à loja.';

  -- Contato espelho (ADR-002 do módulo): liga o `contacts` do CRM ao cliente do ERP, que é o
  -- cadastro mestre. É PONTEIRO, não histórico: apagar o contato apaga a ligação (on delete
  -- cascade) sem perder conversa, funil nem pedido, que moram nas tabelas deles. Um cliente do ERP
  -- tem no máximo um contato por organização, e um contato pode apontar para VÁRIAS fichas do ERP
  -- (ADR-008): o ERP duplica a mesma pessoa, e o telefone é a chave do contato.
  create table if not exists public.pdv_customer_links (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contact_id uuid not null references public.contacts(id) on delete cascade,
    erp_customer_id text not null,
    linked_at timestamptz not null default now(),
    constraint pdv_customer_links_org_erp_customer_unico unique (organization_id, erp_customer_id)
  );

  -- ADR-008: o contato deixa de ser único no vínculo. Quem já tinha a tabela da 9045 ainda traz a
  -- constraint antiga, e o `create table if not exists` acima não a remove: cai aqui, a cada chamada.
  alter table public.pdv_customer_links
    drop constraint if exists pdv_customer_links_org_contact_unico;
  create index if not exists pdv_customer_links_org_contact_idx
    on public.pdv_customer_links (organization_id, contact_id);

  create index if not exists pdv_customer_links_org_idx
    on public.pdv_customer_links (organization_id);

  comment on table public.pdv_customer_links is
    'Contato espelho do módulo PDV (ADR-002 e ADR-008 do módulo): liga contacts ao cliente do ERP (cadastro mestre); um contato pode ter várias fichas do ERP. Só ponteiro: sem dado do cliente, que vive no ERP.';

  -- D5: a proteção na MESMA transação (RLS + tenant_isolation_pdv_stores_all + travas de suporte).
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_pdv_provisionar() from public, anon, authenticated;
grant execute on function public.fn_pdv_provisionar() to service_role;

comment on function public.fn_pdv_provisionar() is
  'Provisiona o schema do módulo PDV (ADR-0002 D2): hoje pdv_stores e pdv_customer_links. Sem parâmetro e com EXECUTE só de service_role (D4); termina em fn_proteger_modulo_provisionado() (D5).';

-- Banco que já tem o módulo: tira a constraint antiga agora, sem reinstalar. Sem a tabela, nada a fazer.
do $m$
begin
  if to_regclass('public.pdv_customer_links') is not null then
    alter table public.pdv_customer_links
      drop constraint if exists pdv_customer_links_org_contact_unico;
    create index if not exists pdv_customer_links_org_contact_idx
      on public.pdv_customer_links (organization_id, contact_id);
  end if;
end
$m$;
