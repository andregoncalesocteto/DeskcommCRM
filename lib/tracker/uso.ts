/**
 * O uso de cada chave pública do rastreador: a tela mostra se ela já recebeu algum evento.
 *
 * A fonte é o histórico do pedido (`external_event`): a porta pública grava `payload.chave_id` em todo evento que a
 * chave traz. Conta só o que de fato virou linha no histórico — evento descartado (idtrack sem pedido, por exemplo) não
 * aparece, e é de propósito: "recebeu" quer dizer "o CRM guardou".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

export const COLUNAS_DA_CHAVE = "id, pipeline_id, public_key, label, allowed_origins, is_active, revoked_at, created_at";

export interface ChaveDoRastreador {
  id: string;
  pipeline_id: string;
  public_key: string;
  label: string;
  allowed_origins: string[];
  is_active: boolean;
  revoked_at: string | null;
  created_at: string;
}

export interface UsoDaChave {
  /** A hora do evento mais recente que esta chave trouxe; `null` = nunca chegou nada. */
  ultimo_recebimento: string | null;
  recebidos_7_dias: number;
}

async function usoDaChave(
  supabase: SupabaseClient,
  organizationId: string,
  pipelineId: string,
  chaveId: string,
  desde: string,
): Promise<UsoDaChave> {
  const base = () =>
    supabase
      .from("crm_lead_activities")
      .select("performed_at, lead:crm_leads!inner(pipeline_id)", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("type", "external_event")
      .eq("payload->>chave_id", chaveId)
      .eq("lead.pipeline_id", pipelineId);
  const [ultimo, semana] = await Promise.all([
    base().order("performed_at", { ascending: false }).limit(1),
    base().gte("performed_at", desde).limit(1),
  ]);
  if (ultimo.error) throw new Error(ultimo.error.message);
  if (semana.error) throw new Error(semana.error.message);
  const linha = (ultimo.data ?? [])[0] as { performed_at?: string } | undefined;
  return { ultimo_recebimento: linha?.performed_at ?? null, recebidos_7_dias: semana.count ?? 0 };
}

/** As chaves do funil, da mais nova para a mais antiga, cada uma com o que a tela precisa para mostrar se está chegando. */
export async function lerChavesComUso(
  supabase: SupabaseClient,
  organizationId: string,
  pipelineId: string,
  agora: Date = new Date(),
): Promise<Array<ChaveDoRastreador & UsoDaChave>> {
  const { data, error } = await supabase
    .from("crm_tracker_public_keys")
    .select(COLUNAS_DA_CHAVE)
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const chaves = (data ?? []) as ChaveDoRastreador[];
  const desde = new Date(agora.getTime() - SETE_DIAS_MS).toISOString();
  const usos = await Promise.all(chaves.map((c) => usoDaChave(supabase, organizationId, pipelineId, c.id, desde)));
  return chaves.map((c, i) => ({ ...c, ...usos[i]! }));
}
