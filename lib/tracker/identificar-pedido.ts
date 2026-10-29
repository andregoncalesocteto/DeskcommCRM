/**
 * Acha o pedido aberto de quem o rastreador identificou.
 *
 * O `idtrack` que a página recebeu na URL é o **id do contato** no CRM (UUID). A regra, em ordem, e qualquer falha é o
 * mesmo `null` — "não achei", que a porta pública descarta sem efeito e sem dizer por quê (não há oráculo):
 *   1. sem `idtrack`, ou fora do formato UUID (um telefone, um e-mail, lixo): nada;
 *   2. o contato precisa existir NESTA organização (a da chave), não ser pessoal e não estar anonimizado;
 *   3. o pedido é o ABERTO mais recente do contato NO FUNIL DA CHAVE — pedido de outro funil nunca serve, e este
 *      módulo nunca CRIA pedido: sem aberto, o evento é descartado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChaveResolvida {
  organizationId: string;
  pipelineId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function identificarPedido(
  supabase: SupabaseClient,
  chave: ChaveResolvida,
  idtrack: string | undefined,
): Promise<string | null> {
  if (!idtrack || !UUID.test(idtrack)) return null;
  const contatoId = idtrack.toLowerCase();

  const { data: contato, error: erroContato } = await supabase
    .from("contacts")
    .select("id, is_personal, is_anonymized")
    .eq("organization_id", chave.organizationId)
    .eq("id", contatoId)
    .maybeSingle();
  if (erroContato) throw new Error(erroContato.message);
  const c = contato as { is_personal: boolean | null; is_anonymized: boolean | null } | null;
  if (!c || c.is_personal === true || c.is_anonymized === true) return null;

  const { data: pedido, error: erroPedido } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("organization_id", chave.organizationId)
    .eq("pipeline_id", chave.pipelineId)
    .eq("contact_id", contatoId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroPedido) throw new Error(erroPedido.message);
  return (pedido as { id: string } | null)?.id ?? null;
}
