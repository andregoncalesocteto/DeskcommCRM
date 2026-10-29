/**
 * Leitura do CADASTRO de eventos de um funil (`crm_pipeline_events`) para a tela de configuração.
 *
 * Cada evento vem com dois sinais de uso lidos do HISTÓRICO (ADR-0008): quando foi visto pela última vez e quantas
 * vezes nos últimos 7 dias. É o laço de retorno da feature: quem cadastra vê se o evento está chegando. A consulta usa
 * junção interna com o pedido para filtrar pelo funil, porque `crm_lead_activities` não tem coluna de funil.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const SETE_DIAS_MS = 7 * 86_400_000;

export interface EventoCadastrado {
  id: string;
  key: string;
  label: string;
  description: string | null;
  stage_id: string | null;
  respects_manual_move: boolean;
  state_key: string | null;
  value_path: string | null;
  value_unit: "reais" | "centavos" | null;
  dedupe_path: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UsoDoEvento {
  /** A hora do evento mais recente já registrado (`performed_at`); `null` = nunca chegou nada. */
  ultimo_recebimento: string | null;
  recebidos_7_dias: number;
}

export type EventoCadastradoComUso = EventoCadastrado & UsoDoEvento;

export const COLUNAS_DO_CADASTRO =
  "id, key, label, description, stage_id, respects_manual_move, state_key, value_path, value_unit, dedupe_path, is_active, created_at, updated_at";

/** O funil é desta organização? `false` serve para o 404, que é o MESMO de um funil inexistente. */
export async function funilDaOrganizacao(supabase: SupabaseClient, organizationId: string, pipelineId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", pipelineId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

async function usoDoEvento(
  supabase: SupabaseClient,
  organizationId: string,
  pipelineId: string,
  chave: string,
  desde: string,
): Promise<UsoDoEvento> {
  const base = () =>
    supabase
      .from("crm_lead_activities")
      .select("performed_at, lead:crm_leads!inner(pipeline_id)", { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("type", "external_event")
      .eq("payload->>event", chave)
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

/** Os eventos do funil, em ordem de chave, cada um com o que a tela precisa para mostrar se está chegando. */
export async function lerCadastroComUso(
  supabase: SupabaseClient,
  organizationId: string,
  pipelineId: string,
  agora: Date = new Date(),
): Promise<EventoCadastradoComUso[]> {
  const { data, error } = await supabase
    .from("crm_pipeline_events")
    .select(COLUNAS_DO_CADASTRO)
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId)
    .order("key", { ascending: true });
  if (error) throw new Error(error.message);
  const eventos = (data ?? []) as EventoCadastrado[];
  const desde = new Date(agora.getTime() - SETE_DIAS_MS).toISOString();
  const usos = await Promise.all(eventos.map((e) => usoDoEvento(supabase, organizationId, pipelineId, e.key, desde)));
  return eventos.map((e, i) => ({ ...e, ...usos[i]! }));
}
