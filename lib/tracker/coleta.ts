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

/** Requisições por minuto: a chave inteira (o site todo) e um mesmo IP numa mesma chave (um visitante, ou um robô). */
export const LIMITE_POR_CHAVE_POR_MINUTO = 1200;
export const LIMITE_POR_IP_POR_MINUTO = 60;
export const JANELA_DO_LIMITE_SEGUNDOS = 60;

export const FORMATO_DA_CHAVE = /^pk_[a-f0-9]{36}$/;

/** O corpo do POST. `strict`: `organization_id`, `pipeline_id`, `lead_id` e qualquer outro campo são recusados. */
export const corpoDaColetaSchema = z.strictObject({
  /** O id do contato que a página recebeu na URL (`?idtrack=`). Opcional; sem ele nada é identificado. */
  idtrack: z.string().max(200).optional(),
  /** Modo de depuração do script: a resposta traz as chaves de evento cadastradas no funil (nada além disso). */
  debug: z.boolean().optional(),
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

/** Segundos até a janela atual do contador acabar (`Retry-After`): nunca menos de 1. */
export function segundosAteAJanelaAcabar(agora = Date.now()): number {
  const janelaMs = JANELA_DO_LIMITE_SEGUNDOS * 1000;
  return Math.max(1, Math.ceil((janelaMs - (agora % janelaMs)) / 1000));
}

/**
 * As chaves de evento ATIVAS do funil da chave, em ordem — só os NOMES (nem etapa, nem valor, nem regra). Existe para o
 * modo de depuração do script avisar "este evento não está cadastrado". Independe do pedido: é a mesma lista com
 * `idtrack` bom, ruim ou ausente, então não revela nada do contato.
 */
export async function chavesCadastradas(supabase: SupabaseClient, chave: ChaveDaColeta): Promise<string[]> {
  const { data, error } = await supabase
    .from("crm_pipeline_events")
    .select("key")
    .eq("organization_id", chave.organizationId)
    .eq("pipeline_id", chave.pipelineId)
    .eq("is_active", true)
    .order("key");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ key: string }>).map((l) => l.key);
}
