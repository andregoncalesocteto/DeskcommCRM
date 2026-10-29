-- manifest: Índice único parcial de event_id por pedido nos eventos externos de crm_lead_activities; deduplica antes, mantendo a linha mais antiga (ADR-0008).
-- Hoje a deduplicação por event_id é "ler e depois inserir" (lib/leads/eventos-externos.ts): duas chamadas simultâneas com o mesmo id gravam as duas.
-- O escopo é o PEDIDO (organização + lead + event_id), não a organização: dois cardápios com ids simples ("1", "2") não colidem.
-- Só linhas external_event que trazem event_id entram no índice; evento sem event_id continua podendo repetir, porque não há como saber que é o mesmo fato.
-- Idempotente: reaplicar não acha duplicata (o índice a impede) e o create usa if not exists.
delete from public.crm_lead_activities a
 using public.crm_lead_activities b
 where a.type = 'external_event'
   and b.type = 'external_event'
   and a.organization_id = b.organization_id
   and a.lead_id = b.lead_id
   and a.payload ? 'event_id'
   and b.payload ? 'event_id'
   and a.payload ->> 'event_id' = b.payload ->> 'event_id'
   and (a.created_at, a.id) > (b.created_at, b.id);

create unique index if not exists uniq_lead_activities_external_event_id
  on public.crm_lead_activities (organization_id, lead_id, ((payload ->> 'event_id')))
  where type = 'external_event' and payload ? 'event_id';

notify pgrst, 'reload schema';
