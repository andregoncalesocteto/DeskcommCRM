-- manifest: Módulo PDV, etapa 1 — cria `public.fn_pdv_provisionar()` (security definer, sem parâmetro, execute só de service_role), cuja instalação via `fn_modulo_instalar('pdv', ...)` cria `pdv_stores` (lojas do tenant: sigla e código do ERP únicos por organização, conexão de WhatsApp opcional) com RLS `tenant_isolation_pdv_stores_all`; desinstalado, o módulo não deixa tabela alguma (ADR-0002 D2/D4/D5).
-- A PROVISIONADORA DO MÓDULO PDV — a primeira peça: a tabela de lojas (ADR-0002, D2/D3/D4/D5).
--
-- Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md. Esta migration cria a FUNÇÃO, nunca a
-- tabela: `pdv_stores` só nasce quando o administrador da instalação chama
-- `fn_modulo_instalar('pdv', ...)`. Até lá nenhuma tabela `pdv_*` existe.
--
-- DESTINO (DoD 18): extensão. Pedido por telefone/balcão de uma rede de pizzarias é jornada de
-- nicho; sem ela o funil, a inbox e o caixa do núcleo continuam inteiros.
--
-- D4 — por que a função não é porta de adulteração: sem parâmetro (nenhum nome de tabela, SQL ou
-- organização vem de quem chama), idempotente (`if not exists` em tudo) e executável só por
-- `service_role`, com as DUAS origens de EXECUTE revogadas (o grant a PUBLIC que o Postgres dá ao
-- criar e o grant direto a `anon` do `alter default privileges` do baseline).
--
-- D5 — a RLS é a rotina automática `fn_proteger_modulo_provisionado()`, no fim do corpo: liga RLS e
-- cria `tenant_isolation_pdv_stores_all` (via `fn_user_org_ids()`) em tabela que nasce com RLS
-- desligada, e aplica as travas de suporte. `anon` não tem privilégio algum na tabela.
--
-- `channel_session_id` aponta para `channel_sessions` (a conexão de WhatsApp da loja) com
-- `on delete set null`: apagar a conexão não pode apagar a loja nem o histórico dela.
-- Loja é dado de configuração, sem texto livre sobre pessoa: nada a redigir na LGPD (D8).

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

  -- D5: a proteção na MESMA transação (RLS + tenant_isolation_pdv_stores_all + travas de suporte).
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_pdv_provisionar() from public, anon, authenticated;
grant execute on function public.fn_pdv_provisionar() to service_role;

comment on function public.fn_pdv_provisionar() is
  'Provisiona o schema do módulo PDV (ADR-0002 D2): hoje pdv_stores. Sem parâmetro e com EXECUTE só de service_role (D4); termina em fn_proteger_modulo_provisionado() (D5).';
