-- =====================================================================================================
-- Relatórios do funil Pedidos — Bella Capri (somente leitura)
-- =====================================================================================================
-- Como rodar (a partir do banco da instalação, com SUPABASE_DB_URL):
--     psql "$SUPABASE_DB_URL" -v org=<organization_id da loja> -f relatorios-bellacapri.sql
-- Local (teste):  organization_id da loja RPA = e6feb6df-0720-49af-a81c-33890fb6d9b1
--
-- Convenções:
--   * Fuso das datas e horas: America/Sao_Paulo.
--   * "Conversa iniciada" = um pedido (crm_leads) que nasceu na etapa Conversas.
--   * Só leitura de ids, datas, estados e valores. Nada de nome, telefone ou texto de mensagem.
--   * Dados de TESTE e PRODUÇÃO se misturam até o go-live: filtre por data (and l.created_at >= '...').
--   * Mover para a MESMA etapa gera um evento stage_changed (from = to). Todas as consultas de transição
--     ignoram esses eventos (from <> to).
-- =====================================================================================================


--'=== 1. Funil de conversão: quantos pedidos chegaram a cada etapa ==='
-- Um pedido "chegou" a uma etapa se já esteve nela (histórico) ou nasceu nela (Conversas não gera evento).
with primeira as (
  select distinct on (pipeline_id) pipeline_id, id as stage_id
  from crm_stages where is_archived = false order by pipeline_id, position
),
passou as (
  select a.lead_id, (a.payload->>'to_stage_id')::uuid as stage_id
    from crm_lead_activities a where a.type = 'stage_changed' and a.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'
  union select l.id, l.stage_id from crm_leads l where l.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'
  union select l.id, p.stage_id from crm_leads l join primeira p on p.pipeline_id = l.pipeline_id
   where l.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'
)
select s.name as etapa,
       count(distinct p.lead_id) as pedidos_que_chegaram,
       round(100.0 * count(distinct p.lead_id)
             / nullif((select count(*) from crm_leads where organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'), 0), 1) as pct_das_conversas
  from crm_stages s
  left join passou p on p.stage_id = s.id
 where s.is_archived = false
   and s.pipeline_id in (select pipeline_id from crm_leads where organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1')
 group by s.name, s.position
 order by s.position;


--'=== 2. Taxa de conversão conversa -> compra, por dia de nascimento do pedido ==='
-- conversao_pct = compras / conversas. A segunda taxa ignora pedidos ainda abertos (coorte imatura).
select (l.created_at at time zone 'America/Sao_Paulo')::date as dia,
       count(*)                                                    as conversas_iniciadas,
       count(*) filter (where l.status = 'won')                    as compras,
       count(*) filter (where l.status = 'lost')                   as canceladas,
       count(*) filter (where l.status = 'open')                   as em_aberto,
       round(100.0 * count(*) filter (where l.status = 'won') / nullif(count(*), 0), 1) as conversao_pct,
       round(100.0 * count(*) filter (where l.status = 'won')
             / nullif(count(*) filter (where l.status <> 'open'), 0), 1)                as conversao_dos_encerrados_pct
  from crm_leads l
 where l.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'
 group by 1 order by 1;

-- '=== 3. Tempo entre etapas (só avanços, entre eventos consecutivos do mesmo pedido) ==='
-- Medido em minutos. A mediana resiste a um pedido esquecido por dias; a média, não.
with t as (
  select a.lead_id, a.created_at as em,
         (a.payload->>'from_stage_id')::uuid as from_id, (a.payload->>'to_stage_id')::uuid as to_id
    from crm_lead_activities a
   where a.type = 'stage_changed' and a.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'
     and (a.payload->>'from_stage_id') is distinct from (a.payload->>'to_stage_id')
),
seq as (
  select t.*, lag(em) over (partition by lead_id order by em) as prev_em from t
)
select sf.name as de, st.name as para,
       count(*) as transicoes,
       round((avg(extract(epoch from (seq.em - seq.prev_em))) / 60)::numeric, 1) as minutos_media,
       round(((percentile_cont(0.5) within group (order by extract(epoch from (seq.em - seq.prev_em)))) / 60)::numeric, 1) as minutos_mediana
  from seq
  join crm_stages sf on sf.id = seq.from_id
  join crm_stages st on st.id = seq.to_id
 where seq.prev_em is not null and sf.position < st.position       -- só avanços
 group by sf.name, st.name, sf.position, st.position
 order by sf.position, st.position;

-- '=== 4. Horários de pico: 1º acesso ao cardápio (entrada em Visitas), por dia da semana x hora ==='
-- dow: 0 = domingo ... 6 = sábado. É o PRIMEIRO acesso de cada pedido, não cada visita.
-- Cada visita (com `crm_add_lead_events`) está na consulta 9.
select extract(dow  from a.created_at at time zone 'America/Sao_Paulo')::int as dia_da_semana,
       extract(hour from a.created_at at time zone 'America/Sao_Paulo')::int as hora,
       count(*) as primeiros_acessos
  from crm_lead_activities a
  join crm_stages s on s.id = (a.payload->>'to_stage_id')::uuid
 where a.type = 'stage_changed' and a.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'
   and s.name = 'Visitas'
   and (a.payload->>'from_stage_id') is distinct from (a.payload->>'to_stage_id')
 group by 1, 2 order by 1, 2;

-- '=== 5. Quando as conversas começam: pedidos nascidos por dia da semana e hora ==='
select extract(dow  from l.created_at at time zone 'America/Sao_Paulo')::int as dia_da_semana,
       extract(hour from l.created_at at time zone 'America/Sao_Paulo')::int as hora,
       count(*) as conversas_iniciadas
  from crm_leads l
 where l.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'
 group by 1, 2 order by 1, 2;

-- '=== 6. Clientes novos x recorrentes: conversão por tipo ==='
-- recorrente = o contato já tinha uma COMPRA anterior quando este pedido nasceu.
select case when exists (
         select 1 from crm_leads p
          where p.organization_id = l.organization_id and p.contact_id = l.contact_id
            and p.status = 'won' and p.created_at < l.created_at
       ) then 'recorrente' else 'novo' end as tipo_de_cliente,
       count(*) as conversas,
       count(*) filter (where l.status = 'won') as compras,
       round(100.0 * count(*) filter (where l.status = 'won') / nullif(count(*), 0), 1) as conversao_pct
  from crm_leads l
 where l.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1'
 group by 1 order by 1;

-- '=== 7. Compras: receita, ticket médio, por forma de pagamento, entrega e cupom ==='
-- value_cents e custom_fields só existem se o cardápio os enviou (crm_update_lead).
select coalesce(l.custom_fields->>'forma_pagamento', '(não informado)') as forma_pagamento,
       coalesce(l.custom_fields->>'tipo_entrega',    '(não informado)') as tipo_entrega,
       (l.custom_fields->>'cupom' is not null)                           as usou_cupom,
       count(*)                                                         as compras,
       round(sum(l.value_cents) / 100.0, 2)                             as receita_brl,
       round(avg(l.value_cents) / 100.0, 2)                             as ticket_medio_brl
  from crm_leads l
 where l.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1' and l.status = 'won'
 group by 1, 2, 3 order by compras desc;

-- '=== 8. Abandono: dos pedidos que chegaram a cada etapa, quantos NÃO compraram ==='
with chegou as (
  select distinct a.lead_id, s.name as etapa
    from crm_lead_activities a
    join crm_stages s on s.id = (a.payload->>'to_stage_id')::uuid
   where a.type = 'stage_changed' and a.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1' and s.name in ('Carrinho', 'Revisão')
)
select c.etapa as chegou_a,   -- quem chegou a Revisão também aparece em Carrinho
       count(*) filter (where l.status = 'won')  as compraram,
       count(*) filter (where l.status <> 'won') as nao_compraram,
       round(100.0 * count(*) filter (where l.status <> 'won') / nullif(count(*), 0), 1) as abandono_pct
  from chegou c join crm_leads l on l.id = c.lead_id
 group by c.etapa order by c.etapa;

-- =====================================================================================================
-- Consultas sobre os REGISTROS do cardápio (crm_add_lead_events) e o JSON de estado (custom_fields)
-- =====================================================================================================
-- Exigem a ferramenta `crm_add_lead_events` instalada e o cardápio enviando os eventos (a hora de cada
-- visita é o `performed_at` da linha, que é a hora do EVENTO, não a do envio). Sem eles, voltam vazias.
-- O JSON de cada evento está em payload->'data'; o nome do evento, em payload->>'event'.

-- '=== 9. Visitas ao cardápio por dia da semana x hora (CADA page_view, não só a primeira) ==='
select extract(dow  from a.performed_at at time zone 'America/Sao_Paulo')::int as dia_da_semana,
       extract(hour from a.performed_at at time zone 'America/Sao_Paulo')::int as hora,
       count(*) as visitas
  from crm_lead_activities a
 where a.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1' and a.type = 'external_event' and a.payload->>'event' = 'page_view'
 group by 1, 2 order by 1, 2;

-- '=== 10. Itens mais vistos (cada view_item conta uma visualização) ==='
select a.payload->'data'->>'item_id'   as item_id,
       max(a.payload->'data'->>'item_name') as item,
       max(a.payload->'data'->>'category')  as categoria,
       count(*)                              as visualizacoes,
       count(distinct a.lead_id)             as pedidos_distintos
  from crm_lead_activities a
 where a.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1' and a.type = 'external_event' and a.payload->>'event' = 'view_item'
 group by 1 order by visualizacoes desc, item limit 20;

-- '=== 11. Itens mais comprados (do JSON do pedido: custom_fields.pedido.items) ==='
-- Assume `items` PLANO: [{item_id, item_name, price, quantity, category}].
-- Se o cardápio mandar aninhado duas vezes ([{items:[...]}]), troque o caminho por 'lax $.pedido.items[*].items[*]'.
select it->>'item_id'            as item_id,
       max(it->>'item_name')     as item,
       sum(coalesce((it->>'quantity')::numeric, 1)) as unidades,
       count(distinct l.id)      as pedidos
  from crm_leads l
  cross join lateral jsonb_path_query(l.custom_fields, 'lax $.pedido.items[*]') as it
 where l.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1' and l.status = 'won'
 group by 1 order by unidades desc, item limit 20;

-- '=== 12. Visitantes novos x recorrentes (por contato, olhando as visitas registradas) ==='
-- novo = o contato visitou o cardápio em 1 pedido; recorrente = em 2 ou mais pedidos diferentes.
with visitas as (
  select a.contact_id, count(distinct a.lead_id) as pedidos_com_visita, count(*) as visitas
    from crm_lead_activities a
   where a.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1' and a.type = 'external_event' and a.payload->>'event' = 'page_view'
     and a.contact_id is not null
   group by 1
)
select case when pedidos_com_visita >= 2 then 'recorrente' else 'novo' end as tipo,
       count(*) as contatos, sum(visitas) as visitas
  from visitas group by 1 order by 1;

-- '=== 13. (opcional) Visitas por dispositivo e origem — só se o cardápio mandar `device` e `source` em data ==='
select coalesce(a.payload->'data'->>'device', '(não informado)') as dispositivo,
       coalesce(a.payload->'data'->>'source', '(não informado)') as origem,
       count(*) as visitas
  from crm_lead_activities a
 where a.organization_id = 'e6feb6df-0720-49af-a81c-33890fb6d9b1' and a.type = 'external_event' and a.payload->>'event' = 'page_view'
 group by 1, 2 order by visitas desc;