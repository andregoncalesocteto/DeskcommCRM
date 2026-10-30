select a.performed_at,
       a.payload->>'event'    as evento,
       a.payload->>'event_id' as event_id,
       a.payload->'data'      as data,
       a.lead_id
from crm_lead_activities a
where a.organization_id = '14ea98ec-6b23-4a98-a2e0-53bf6e76909e'
  and a.type = 'external_event'
order by a.performed_at desc
limit 20;