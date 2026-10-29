/**
 * EVENTOS DE UMA INTEGRAÇÃO NA LINHA DO TEMPO DO PEDIDO (`crm_add_lead_events`).
 *
 * ─── Por que existe ──────────────────────────────────────────────────────────
 *
 * O CRM tinha um único jeito de uma integração contar algo sobre um pedido:
 * `crm_update_lead`, que SUBSTITUI o campo. Quem precisa do registro de cada
 * visita, de cada item visto, de cada carrinho (um cardápio digital, uma loja
 * virtual) não consegue guardar uma sequência assim — a segunda chamada apaga a
 * primeira. O `reason` do `crm_move_lead_stage` não serve: a auditoria corta
 * textos em 500 caracteres.
 *
 * Esta é a porta APPEND-ONLY: cada evento vira uma linha de `crm_lead_activities`
 * (tipo `external_event`), com a hora em que ACONTECEU e o JSON em
 * `payload.data`. Sem tabela nova: a linha do tempo já é o barramento da vida do
 * pedido, já é cascateada pelo apagamento do negócio e preservada (com os
 * carimbos de data) pelo redact da LGPD.
 *
 * ─── O que esta porta NUNCA faz ──────────────────────────────────────────────
 *
 * - Não esquenta o negócio: o tipo não está na lista positiva de
 *   `fn_update_last_activity_at`. Vinte aberturas do cardápio não são "alguém
 *   tocou este negócio" e não podem zerar o Radar de Risco.
 * - Não aceita lote sem teto: o custo é uma linha por evento.
 * - Não escreve em pedido de outra organização nem de contato "pessoal".
 *
 * ─── Reenvio ─────────────────────────────────────────────────────────────────
 *
 * Lote reenviado por falha de rede não pode multiplicar as linhas. Quem manda um
 * `event_id` estável (o do próprio evento no sistema de origem) fica protegido: o
 * que já está gravado para aquele pedido é contado como `repetidos`, não gravado
 * de novo. Sem `event_id` não há como saber que dois eventos são o mesmo, e o
 * reenvio duplica — a documentação da ferramenta diz isso a quem integra.
 * A leitura prévia evita o caso normal (reenvio depois da resposta); quem garante
 * o caso simultâneo é o BANCO: o índice único `uniq_lead_activities_external_event_id`
 * (migration 9040) recusa a segunda inserção do mesmo `event_id` no mesmo pedido
 * com `23505`, e a gravação trata esse erro como `repetido` (ver `gravarLinhas`).
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { buildLeadActivityRow, type LeadActivityRow } from "@/lib/leads/activity-emitter";

export const TIPO_DO_EVENTO_EXTERNO = "external_event" as const;
export const ORIGEM_DO_EVENTO_EXTERNO = "integracao_externa";

export const MAX_EVENTOS_POR_CHAMADA = 50;
export const MAX_BYTES_DO_EVENTO = 8 * 1024;
export const MAX_BYTES_DA_CHAMADA = 64 * 1024;
/** Evento velho demais é lote de ontem reenviado por engano, não registro novo. */
export const JANELA_DO_PASSADO_MS = 30 * 86_400_000;
/** Relógio de aparelho adianta: aceitamos alguns minutos no futuro, não mais. */
export const TOLERANCIA_DO_FUTURO_MS = 5 * 60_000;

export const eventoExternoSchema = z.strictObject({
  /** O nome do fato, no vocabulário de quem integra: `page_view`, `view_item`, `cart_sync`… */
  event: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, "event: minúsculas, números e _, começando por letra (até 64)."),
  /** Quando o fato aconteceu (ISO-8601). Ausente = agora. */
  at: z.string().datetime({ offset: true }).optional(),
  /** O id do fato no sistema de origem. Com ele, reenviar o lote não duplica. */
  event_id: z.string().min(1).max(100).optional(),
  /** O JSON do fato, como o sistema de origem o tem. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type EventoExterno = z.infer<typeof eventoExternoSchema>;

const tamanho = (valor: unknown): number => Buffer.byteLength(JSON.stringify(valor ?? null), "utf8");

/**
 * Os problemas do lote, em português, ou lista vazia. Pura: o relógio entra por
 * parâmetro para o teste não depender da hora em que roda.
 */
export function validarLote(eventos: readonly EventoExterno[], agora: Date): string[] {
  const problemas: string[] = [];
  if (eventos.length === 0) return ["Envie ao menos um evento."];
  if (eventos.length > MAX_EVENTOS_POR_CHAMADA) {
    return [`No máximo ${MAX_EVENTOS_POR_CHAMADA} eventos por chamada (vieram ${eventos.length}).`];
  }

  const minimo = agora.getTime() - JANELA_DO_PASSADO_MS;
  const maximo = agora.getTime() + TOLERANCIA_DO_FUTURO_MS;
  let total = 0;
  eventos.forEach((e, i) => {
    const n = tamanho(e);
    total += n;
    if (n > MAX_BYTES_DO_EVENTO) {
      problemas.push(`Evento #${i + 1} (${e.event}) passa de ${MAX_BYTES_DO_EVENTO} bytes (tem ${n}).`);
    }
    if (e.at !== undefined) {
      const quando = Date.parse(e.at);
      if (quando > maximo) problemas.push(`Evento #${i + 1} (${e.event}) tem hora no futuro (${e.at}).`);
      else if (quando < minimo) problemas.push(`Evento #${i + 1} (${e.event}) é mais velho que 30 dias (${e.at}).`);
    }
  });
  if (total > MAX_BYTES_DA_CHAMADA) {
    problemas.push(`A chamada inteira passa de ${MAX_BYTES_DA_CHAMADA} bytes (tem ${total}); divida o lote.`);
  }
  return problemas;
}

export interface RegistrarEventosInput {
  organizationId: string;
  leadId: string;
  actor: Actor;
  eventos: readonly EventoExterno[];
  /** Só para o teste. Em produção é a hora do servidor. */
  agora?: Date;
}

export interface ResultadoDosEventos {
  lead_id: string;
  registrados: number;
  repetidos: number;
}

export interface PedidoDoEvento {
  contatoId: string | null;
  pipelineId: string | null;
  /** `open`, `won` ou `lost`; `null` se a linha não trouxe. */
  status: string | null;
}

/**
 * O pedido que vai receber os eventos, ou a recusa. O filtro de organização é MANUAL de propósito: o cliente de
 * serviço ignora a RLS, e o `lead_id` vem do chamador. Sem este `.eq`, um token da loja A escreveria na linha do
 * tempo da loja B. Pedido de contato marcado como pessoal está fora da operação (403).
 */
export async function carregarPedidoParaEvento(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  requestId = "",
): Promise<PedidoDoEvento> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, contact_id, pipeline_id, status")
    .eq("organization_id", organizationId)
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) throw new ApiError(404, "not_found", undefined, requestId, "Pedido não encontrado.");
  const contatoId = (lead as { contact_id?: string | null }).contact_id ?? null;

  if (contatoId) {
    const { data: contato } = await supabase
      .from("contacts")
      .select("is_personal")
      .eq("organization_id", organizationId)
      .eq("id", contatoId)
      .maybeSingle();
    if ((contato as { is_personal?: boolean } | null)?.is_personal === true) {
      throw new ApiError(
        403,
        "contato_pessoal",
        undefined,
        requestId,
        "Este pedido é de um contato marcado como pessoal — fora da operação: nada é registrado nele.",
      );
    }
  }
  const linha = lead as { pipeline_id?: string | null; status?: string | null };
  return { contatoId, pipelineId: linha.pipeline_id ?? null, status: linha.status ?? null };
}

/** Dos `ids` pedidos, os que já estão gravados como evento externo deste pedido. */
export async function eventIdsJaGravados(
  supabase: SupabaseClient,
  organizationId: string,
  leadId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  const jaGravados = new Set<string>();
  if (ids.length === 0) return jaGravados;
  const { data: existentes } = await supabase
    .from("crm_lead_activities")
    .select("payload")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("type", TIPO_DO_EVENTO_EXTERNO)
    .in("payload->>event_id", [...ids]);
  for (const linha of (existentes ?? []) as Array<{ payload?: { event_id?: string } }>) {
    if (linha.payload?.event_id) jaGravados.add(linha.payload.event_id);
  }
  return jaGravados;
}

/**
 * `requestId` vai no ApiError para a auditoria correlacionar; esta camada não o
 * conhece, e o chamador (a ferramenta) é quem sabe — por isso ele entra por fora.
 */
export async function registrarEventosDoNegocio(
  supabase: SupabaseClient,
  input: RegistrarEventosInput,
  requestId = "",
): Promise<ResultadoDosEventos> {
  const agora = input.agora ?? new Date();
  const problemas = validarLote(input.eventos, agora);
  if (problemas.length > 0) {
    throw new ApiError(422, "unprocessable_entity", { problemas }, requestId, problemas.join(" "));
  }

  const { contatoId } = await carregarPedidoParaEvento(supabase, input.organizationId, input.leadId, requestId);

  // Repetidos: o que já está gravado para este pedido, e o que se repete no lote.
  const ids = [...new Set(input.eventos.map((e) => e.event_id).filter((v): v is string => !!v))];
  const jaGravados = await eventIdsJaGravados(supabase, input.organizationId, input.leadId, ids);

  const vistosNoLote = new Set<string>();
  const linhas: LeadActivityRow[] = [];
  let repetidos = 0;
  for (const e of input.eventos) {
    if (e.event_id) {
      if (jaGravados.has(e.event_id) || vistosNoLote.has(e.event_id)) {
        repetidos += 1;
        continue;
      }
      vistosNoLote.add(e.event_id);
    }
    const quando = e.at ? new Date(e.at).toISOString() : agora.toISOString();
    linhas.push(
      buildLeadActivityRow({
        organizationId: input.organizationId,
        leadId: input.leadId,
        contactId: contatoId,
        type: TIPO_DO_EVENTO_EXTERNO,
        sourceModule: ORIGEM_DO_EVENTO_EXTERNO,
        actor: input.actor,
        reason: `Evento ${e.event}`,
        performedAt: quando,
        payload: {
          event: e.event,
          at: quando,
          ...(e.event_id ? { event_id: e.event_id } : {}),
          ...(e.data ? { data: e.data } : {}),
        },
      }),
    );
  }

  let registrados = 0;
  if (linhas.length > 0) {
    const porLinha = await gravarLinhas(supabase, linhas, requestId);
    registrados = porLinha.filter((r) => r === "registrado").length;
    repetidos += porLinha.length - registrados;
  }

  return { lead_id: input.leadId, registrados, repetidos };
}

/** Código do Postgres para violação de unicidade (o índice do `event_id`). */
const VIOLACAO_DE_UNICIDADE = "23505";

/**
 * Grava as linhas e diz, para CADA uma e na mesma ordem, se entrou ou se o banco a recusou por já existir.
 *
 * O caminho comum é UMA inserção em lote. Se ela falhar com `23505`, outra chamada gravou o
 * mesmo `event_id` entre a leitura prévia e este insert (a corrida que o índice existe para
 * fechar) — e o lote inteiro foi desfeito pelo banco, inclusive as linhas legítimas. Aí cada
 * linha é inserida sozinha: a que colide vira `repetido`, as outras gravam. Qualquer outro erro
 * continua sendo falha de verdade.
 */
export async function gravarLinhas(
  supabase: SupabaseClient,
  linhas: LeadActivityRow[],
  requestId: string,
): Promise<Array<"registrado" | "repetido">> {
  const falha = (mensagem: string) =>
    new ApiError(500, "internal_error", undefined, requestId, `Não consegui registrar os eventos: ${mensagem}`);

  const { error } = await supabase.from("crm_lead_activities").insert(linhas);
  if (!error) return linhas.map(() => "registrado" as const);
  if (error.code !== VIOLACAO_DE_UNICIDADE) throw falha(error.message);

  const resultados: Array<"registrado" | "repetido"> = [];
  for (const linha of linhas) {
    const { error: erroDaLinha } = await supabase.from("crm_lead_activities").insert(linha);
    if (!erroDaLinha) resultados.push("registrado");
    else if (erroDaLinha.code === VIOLACAO_DE_UNICIDADE) resultados.push("repetido");
    else throw falha(erroDaLinha.message);
  }
  return resultados;
}
