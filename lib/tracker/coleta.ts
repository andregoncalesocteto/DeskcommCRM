/**
 * A PORTA PÚBLICA DE COLETA do rastreador: o que um script no navegador do cliente final pode pedir ao CRM.
 *
 * Sem token secreto: quem decide é a CHAVE PÚBLICA (que vem no caminho) e a ORIGEM da requisição. A organização e o
 * funil saem SÓ da linha da chave — o corpo nunca os nomeia (o schema é `strict`). Esta camada resolve a chave,
 * confere a origem e monta os cabeçalhos de CORS; a rota é só o encanamento HTTP.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { eventoDoFunilSchema } from "@/lib/leads/eventos-do-funil/registrar";
import { normalizarOrigem } from "./origens";

export const MAX_EVENTOS_DO_NAVEGADOR = 20;
export const MAX_BYTES_DO_CORPO = 64 * 1024;

export const FORMATO_DA_CHAVE = /^pk_[a-f0-9]{36}$/;

/** O corpo do POST. `strict`: `organization_id`, `pipeline_id`, `lead_id` e qualquer outro campo são recusados. */
export const corpoDaColetaSchema = z.strictObject({
  /** O id do contato que a página recebeu na URL (`?idtrack=`). Opcional; sem ele nada é identificado. */
  idtrack: z.string().max(200).optional(),
  events: z.array(eventoDoFunilSchema).min(1).max(MAX_EVENTOS_DO_NAVEGADOR),
});
export type CorpoDaColeta = z.infer<typeof corpoDaColetaSchema>;

export interface ChaveDaColeta {
  id: string;
  organizationId: string;
  pipelineId: string;
  allowedOrigins: string[];
}

/** A chave ativa, ou `null` — desconhecida, malformada e revogada são a MESMA resposta (não há oráculo de existência). */
export async function resolverChave(supabase: SupabaseClient, chave: string): Promise<ChaveDaColeta | null> {
  if (!FORMATO_DA_CHAVE.test(chave)) return null;
  const { data, error } = await supabase
    .from("crm_tracker_public_keys")
    .select("id, organization_id, pipeline_id, allowed_origins")
    .eq("public_key", chave)
    .eq("is_active", true)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const linha = data as { id: string; organization_id: string; pipeline_id: string; allowed_origins: string[] };
  return {
    id: linha.id,
    organizationId: linha.organization_id,
    pipelineId: linha.pipeline_id,
    allowedOrigins: linha.allowed_origins,
  };
}

/**
 * A origem da requisição, normalizada, SE ela está na lista da chave. Navegador sempre manda `Origin` em POST
 * cross-origin; requisição sem ele (curl, servidor) não é o script e não passa.
 */
export function origemPermitida(cabecalhoOrigin: string | null, chave: ChaveDaColeta): string | null {
  if (!cabecalhoOrigin) return null;
  const origem = normalizarOrigem(cabecalhoOrigin);
  return origem !== null && chave.allowedOrigins.includes(origem) ? origem : null;
}

/** Cabeçalhos de CORS — só para a origem que a chave lista. Origem não listada nunca os recebe. */
export function cabecalhosDeCors(origem: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origem,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
