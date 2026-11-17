-- manifest: Módulo PDV, etapa 2 — `fn_pdv_provisionar()` passa a criar também `pdv_customer_links` (vínculo do contato espelho do CRM com o cliente do ERP; únicos por (organização, cliente do ERP) e (organização, contato), FK `contacts` on delete cascade) com RLS `tenant_isolation_pdv_customer_links_all`; reinstalar o módulo ou atualizar um banco que já o tinha cria a tabela sem perder dados.
-- O VÍNCULO DO CONTATO ESPELHO — a segunda peça do módulo PDV (ADR-0002 D2/D4/D5).
--
-- Redefine a MESMA provisionadora da 9044 com `create or replace`, agora com as duas tabelas, tudo
-- `if not exists`: quem instalou o módulo na 9044 ganha a tabela nova ao reaplicar o apêndice/chamar
-- `fn_modulo_instalar('pdv', ...)` de novo, e `pdv_stores` segue intacta com os dados. O baseline
-- do clone não cria nenhuma tabela `pdv_*`: elas só nascem na instalação do módulo.
--
-- DESTINO (DoD 18): extensão (mesma razão da 9044).
--
-- LGPD (D8) — decisão: `pdv_customer_links` tem FK para `contacts` mas NÃO guarda texto sobre a
-- pessoa: só ids opacos e a data do vínculo. Por isso NÃO declara seção em `modulo_secoes_lgpd`
-- (não há coluna a anonimizar; `erp_customer_id` é `not null` e é a chave do vínculo) e entra na
-- ALLOWLIST de `tests/invariants/lgpd-modulo-nao-declarado.test.ts` com motivo escrito. Anonimizar
-- o contato o deixa como "Cliente Anonimizado #N" e a ligação aponta para um contato já anônimo;
-- o direito de apagamento do cliente se cumpre NO ERP, dono do cadastro (ADR-002), e é lá que o id
-- perde o sentido. Apagar o contato (hard delete) leva a ligação junto, e não o histórico.
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
  -- cascade) sem perder conversa, funil nem pedido, que moram nas tabelas deles. Uma pessoa do ERP
  -- tem no máximo um contato por organização, e um contato aponta no máximo para um cliente do ERP.
  create table if not exists public.pdv_customer_links (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contact_id uuid not null references public.contacts(id) on delete cascade,
    erp_customer_id text not null,
    linked_at timestamptz not null default now(),
    constraint pdv_customer_links_org_erp_customer_unico unique (organization_id, erp_customer_id),
    constraint pdv_customer_links_org_contact_unico unique (organization_id, contact_id)
  );

  create index if not exists pdv_customer_links_org_idx
    on public.pdv_customer_links (organization_id);

  comment on table public.pdv_customer_links is
    'Contato espelho do módulo PDV (ADR-002 do módulo): liga contacts ao cliente do ERP (cadastro mestre). Só ponteiro: sem dado do cliente, que vive no ERP.';

  -- D5: a proteção na MESMA transação (RLS + tenant_isolation_pdv_stores_all + travas de suporte).
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_pdv_provisionar() from public, anon, authenticated;
grant execute on function public.fn_pdv_provisionar() to service_role;

comment on function public.fn_pdv_provisionar() is
  'Provisiona o schema do módulo PDV (ADR-0002 D2): hoje pdv_stores e pdv_customer_links. Sem parâmetro e com EXECUTE só de service_role (D4); termina em fn_proteger_modulo_provisionado() (D5).';
