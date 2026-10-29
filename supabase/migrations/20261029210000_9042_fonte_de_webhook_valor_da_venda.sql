-- manifest: Eventos do funil, etapa 3 — a fonte de webhook de entrada ganha o campo do valor da venda (value_path) e a unidade (value_unit), para o pedido finalizado preencher value_cents do card.
-- Duas colunas nulas: fonte que nunca configurou segue exatamente como antes. O caminho é o MESMO formato dos eventos do funil
-- (nomes separados por ponto, como "pedido.total"); a unidade é obrigatória junto com o caminho, porque 59,9 e 5990 são o mesmo preço.
alter table public.webhook_sources
  add column if not exists value_path text,
  add column if not exists value_unit text;

do $f$ begin
  if not exists (select 1 from pg_constraint where conname = 'webhook_sources_unidade_do_valor') then
    alter table public.webhook_sources
      add constraint webhook_sources_unidade_do_valor check (value_unit is null or value_unit in ('reais', 'centavos'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webhook_sources_valor_junto') then
    alter table public.webhook_sources
      add constraint webhook_sources_valor_junto check ((value_path is null) = (value_unit is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'webhook_sources_caminho_do_valor') then
    alter table public.webhook_sources
      add constraint webhook_sources_caminho_do_valor check (
        value_path is null
        or (char_length(value_path) <= 200 and value_path ~ '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$')
      );
  end if;
end $f$;

comment on column public.webhook_sources.value_path is
  'Onde, no corpo do envio, está o valor da venda (ex.: "value" ou "pedido.total"). Nulo = esta fonte não preenche value_cents.';
comment on column public.webhook_sources.value_unit is
  'Unidade do valor lido em value_path: reais (59.9) ou centavos (5990). Obrigatória junto com value_path.';

notify pgrst, 'reload schema';
