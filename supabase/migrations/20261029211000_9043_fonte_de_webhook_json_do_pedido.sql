-- manifest: Eventos do funil, etapa 3 — a fonte de webhook de entrada ganha payload_state_key: a chave de custom_fields onde o conteúdo aninhado do envio (lista de itens, objetos) é guardado como JSON em vez de descartado.
-- Coluna nula: fonte que nunca configurou segue descartando o aninhado, como antes. O formato da chave é o mesmo dos eventos do funil.
alter table public.webhook_sources
  add column if not exists payload_state_key text;

do $f$ begin
  if not exists (select 1 from pg_constraint where conname = 'webhook_sources_chave_do_json') then
    alter table public.webhook_sources
      add constraint webhook_sources_chave_do_json check (payload_state_key is null or payload_state_key ~ '^[a-z][a-z0-9_]{0,63}$');
  end if;
end $f$;

comment on column public.webhook_sources.payload_state_key is
  'Chave de custom_fields do card onde o conteúdo aninhado do envio (objetos e listas) é guardado como JSON. Nula = o aninhado é descartado, como sempre foi. A API recusa chave igual a um campo declarado do funil.';

notify pgrst, 'reload schema';
