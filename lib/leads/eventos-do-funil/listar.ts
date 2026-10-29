/**
 * `crm_list_pipeline_events` — as chaves de evento que um funil aceita, para quem integra consultar em vez de adivinhar.
 *
 * Devolve o nome da etapa de destino, NUNCA o id: quem integra não precisa conhecer id de etapa (é a razão de o
 * cadastro morar no funil) e o id não serve a nada fora do CRM.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";

export interface EventoListado {
  key: string;
  label: string;
  description: string | null;
  ativo: boolean;
  /** O nome da etapa para onde o card vai; `null` = o evento só registra. */
  etapa: string | null;
  respeita_movimento_manual: boolean;
  /** O cadastro guarda o último conteúdo do evento no pedido. */
  guarda_estado: boolean;
  /** O cadastro lê o valor da venda do evento. */
  define_valor: boolean;
  /** O cadastro reconhece o mesmo fato de negócio (por exemplo o mesmo `order_id`) como repetição. */
  repete_por_negocio: boolean;
}

interface LinhaDoCadastro {
  key: string;
  label: string;
  description: string | null;
  is_active: boolean;
  stage_id: string | null;
  respects_manual_move: boolean;
  state_key: string | null;
  value_path: string | null;
  dedupe_path: string | null;
}

export async function listarEventosDoFunil(
  supabase: SupabaseClient,
  organizationId: string,
  pipelineId: string,
  requestId = "",
): Promise<{ pipeline_id: string; eventos: EventoListado[] }> {
  // O filtro de organização é MANUAL: o cliente de serviço ignora a RLS e o `pipeline_id` vem do chamador.
  const { data: funil } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", pipelineId)
    .maybeSingle();
  if (!funil) throw new ApiError(404, "not_found", undefined, requestId, "Funil não encontrado.");

  const { data, error } = await supabase
    .from("crm_pipeline_events")
    .select("key, label, description, is_active, stage_id, respects_manual_move, state_key, value_path, dedupe_path")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId);
  if (error) throw new ApiError(500, "internal_error", undefined, requestId, `Não consegui ler os eventos do funil: ${error.message}`);
  const linhas = (data ?? []) as LinhaDoCadastro[];

  const nomes = new Map<string, string>();
  const ids = [...new Set(linhas.map((l) => l.stage_id).filter((v): v is string => !!v))];
  if (ids.length > 0) {
    const { data: etapas, error: erroDeEtapas } = await supabase
      .from("crm_stages")
      .select("id, name")
      .eq("organization_id", organizationId)
      .in("id", ids);
    if (erroDeEtapas) throw new ApiError(500, "internal_error", undefined, requestId, `Não consegui ler as etapas do funil: ${erroDeEtapas.message}`);
    for (const e of (etapas ?? []) as Array<{ id: string; name: string }>) nomes.set(e.id, e.name);
  }

  const eventos = linhas
    .map<EventoListado>((l) => ({
      key: l.key,
      label: l.label,
      description: l.description,
      ativo: l.is_active,
      etapa: l.stage_id ? nomes.get(l.stage_id) ?? null : null,
      respeita_movimento_manual: l.respects_manual_move,
      guarda_estado: !!l.state_key,
      define_valor: !!l.value_path,
      repete_por_negocio: !!l.dedupe_path,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { pipeline_id: pipelineId, eventos };
}
