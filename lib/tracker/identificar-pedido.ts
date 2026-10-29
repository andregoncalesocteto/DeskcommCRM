/**
 * Acha o pedido aberto de quem o rastreador identificou.
 *
 * A US-024 preenche a regra (idtrack = id do contato, pedido aberto mais recente NO FUNIL DA CHAVE). Até lá este ponto
 * não identifica ninguém, e a porta pública descarta todo evento sem efeito: o contrato é "não achou → descarta".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChaveResolvida {
  organizationId: string;
  pipelineId: string;
}

export async function identificarPedido(
  _supabase: SupabaseClient,
  _chave: ChaveResolvida,
  _idtrack: string | undefined,
): Promise<string | null> {
  return null;
}
