/**
 * `crm_track_event` — a operação que recebe os fatos de um pedido e responde o que aconteceu com CADA um.
 *
 * Esta camada valida contra o CADASTRO do funil (`crm_pipeline_events`) e grava no histórico. O que o cadastro
 * pede a mais (estado, valor, movimento da etapa) vem em camadas seguintes; aqui o contrato é: um resultado por
 * evento, na ordem enviada, e um evento recusado nunca derruba os outros do lote.
 *
 * ## Contrato estrito (ADR-0009)
 *
 * Evento cuja chave não está cadastrada e ativa no funil DO PEDIDO é recusado, com a lista das chaves válidas na
 * mensagem. Quem quiser aceitar qualquer nome usa `crm_add_lead_events`, que continua permissiva. O funil sai do
 * pedido (`crm_leads.pipeline_id`), nunca da entrada: quem chama não escolhe contra qual cadastro é validado.
 *
 * ## O histórico é a verdade (ADR-0008)
 *
 * Todo evento aceito vira uma linha `external_event` em `crm_lead_activities` com `performed_at` = hora do evento.
 * A repetição é pelo `event_id` (obrigatório aqui): a leitura prévia pega o reenvio comum e o índice único do
 * banco pega a corrida (`gravarLinhas` trata o `23505`).
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { buildLeadActivityRow, type LeadActivityRow } from "@/lib/leads/activity-emitter";
import {
  JANELA_DO_PASSADO_MS,
  MAX_BYTES_DA_CHAMADA,
  MAX_BYTES_DO_EVENTO,
  MAX_EVENTOS_POR_CHAMADA,
  ORIGEM_DO_EVENTO_EXTERNO,
  TIPO_DO_EVENTO_EXTERNO,
  TOLERANCIA_DO_FUTURO_MS,
  carregarPedidoParaEvento,
  eventIdsJaGravados,
  gravarLinhas,
} from "@/lib/leads/eventos-externos";

export const eventoDoFunilSchema = z.strictObject({
  /** A chave do evento, como cadastrada no funil: `page_view`, `purchase`… */
  event: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/, "event: minúsculas, números e _, começando por letra (até 64)."),
  /** O id do fato na origem. OBRIGATÓRIO: é com ele que reenviar e a corrida não duplicam. */
  event_id: z.string().min(1).max(100),
  /** Quando o fato aconteceu (ISO-8601 com fuso). Ausente = agora. */
  at: z.string().datetime({ offset: true }).optional(),
  /** O JSON do fato, como o sistema de origem o tem. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type EventoDoFunil = z.infer<typeof eventoDoFunilSchema>;

export type CodigoDeRecusa = "evento_nao_cadastrado" | "evento_inativo" | "evento_grande" | "hora_fora_da_janela";

export type ResultadoDoEvento =
  | { event: string; event_id: string; resultado: "registrado" }
  | { event: string; event_id: string; resultado: "repetido" }
  | { event: string; event_id: string; resultado: "recusado"; codigo: CodigoDeRecusa; mensagem: string };

export interface ResultadoDaOperacao {
  lead_id: string;
  resultados: ResultadoDoEvento[];
}

export interface RegistrarEventosDoFunilInput {
  organizationId: string;
  leadId: string;
  actor: Actor;
  eventos: readonly EventoDoFunil[];
  /** Só para o teste. Em produção é a hora do servidor. */
  agora?: Date;
}

interface EventoCadastrado {
  key: string;
  is_active: boolean;
}

const bytes = (valor: unknown): number => Buffer.byteLength(JSON.stringify(valor ?? null), "utf8");

async function cadastroDoFunil(
  supabase: SupabaseClient,
  organizationId: string,
  pipelineId: string | null,
  requestId: string,
): Promise<Map<string, EventoCadastrado>> {
  const cadastro = new Map<string, EventoCadastrado>();
  if (!pipelineId) return cadastro;
  const { data, error } = await supabase
    .from("crm_pipeline_events")
    .select("key, is_active")
    .eq("organization_id", organizationId)
    .eq("pipeline_id", pipelineId);
  if (error) throw new ApiError(500, "internal_error", undefined, requestId, `Não consegui ler os eventos do funil: ${error.message}`);
  for (const linha of (data ?? []) as EventoCadastrado[]) cadastro.set(linha.key, linha);
  return cadastro;
}

function recusar(e: EventoDoFunil, codigo: CodigoDeRecusa, mensagem: string): ResultadoDoEvento {
  return { event: e.event, event_id: e.event_id, resultado: "recusado", codigo, mensagem };
}

export async function registrarEventosDoFunil(
  supabase: SupabaseClient,
  input: RegistrarEventosDoFunilInput,
  requestId = "",
): Promise<ResultadoDaOperacao> {
  const agora = input.agora ?? new Date();

  // Problemas do LOTE (não de um evento): a chamada inteira é recusada.
  if (input.eventos.length === 0) {
    throw new ApiError(422, "unprocessable_entity", undefined, requestId, "Envie ao menos um evento.");
  }
  if (input.eventos.length > MAX_EVENTOS_POR_CHAMADA) {
    throw new ApiError(
      422,
      "unprocessable_entity",
      undefined,
      requestId,
      `No máximo ${MAX_EVENTOS_POR_CHAMADA} eventos por chamada (vieram ${input.eventos.length}).`,
    );
  }
  const total = input.eventos.reduce((soma, e) => soma + bytes(e), 0);
  if (total > MAX_BYTES_DA_CHAMADA) {
    throw new ApiError(
      422,
      "unprocessable_entity",
      undefined,
      requestId,
      `A chamada inteira passa de ${MAX_BYTES_DA_CHAMADA} bytes (tem ${total}); divida o lote.`,
    );
  }

  const pedido = await carregarPedidoParaEvento(supabase, input.organizationId, input.leadId, requestId);
  const cadastro = await cadastroDoFunil(supabase, input.organizationId, pedido.pipelineId, requestId);
  const ativas = [...cadastro.values()].filter((c) => c.is_active).map((c) => c.key).sort();

  const minimo = agora.getTime() - JANELA_DO_PASSADO_MS;
  const maximo = agora.getTime() + TOLERANCIA_DO_FUTURO_MS;

  const resultados: Array<ResultadoDoEvento | null> = input.eventos.map(() => null);
  const candidatos: Array<{ indice: number; evento: EventoDoFunil; quando: string }> = [];

  input.eventos.forEach((e, indice) => {
    const cadastrado = cadastro.get(e.event);
    if (!cadastrado) {
      const lista = ativas.length > 0
        ? `Eventos ativos: ${ativas.join(", ")}.`
        : "Este funil não tem eventos ativos; cadastre-os em Configurações › Funis.";
      resultados[indice] = recusar(e, "evento_nao_cadastrado", `O evento "${e.event}" não está cadastrado neste funil. ${lista}`);
      return;
    }
    if (!cadastrado.is_active) {
      resultados[indice] = recusar(e, "evento_inativo", `O evento "${e.event}" está desativado neste funil.`);
      return;
    }
    const tamanho = bytes(e);
    if (tamanho > MAX_BYTES_DO_EVENTO) {
      resultados[indice] = recusar(e, "evento_grande", `O evento passa de ${MAX_BYTES_DO_EVENTO} bytes (tem ${tamanho}).`);
      return;
    }
    if (e.at !== undefined) {
      const quando = Date.parse(e.at);
      if (quando > maximo) {
        resultados[indice] = recusar(e, "hora_fora_da_janela", `O evento tem hora no futuro (${e.at}).`);
        return;
      }
      if (quando < minimo) {
        resultados[indice] = recusar(e, "hora_fora_da_janela", `O evento é mais velho que 30 dias (${e.at}).`);
        return;
      }
    }
    candidatos.push({ indice, evento: e, quando: e.at ? new Date(e.at).toISOString() : agora.toISOString() });
  });

  // Repetidos: o que já está gravado neste pedido e o que se repete dentro do próprio lote.
  const jaGravados = await eventIdsJaGravados(
    supabase,
    input.organizationId,
    input.leadId,
    [...new Set(candidatos.map((c) => c.evento.event_id))],
  );
  const vistosNoLote = new Set<string>();
  const aGravar: Array<{ indice: number; linha: LeadActivityRow }> = [];
  for (const { indice, evento, quando } of candidatos) {
    if (jaGravados.has(evento.event_id) || vistosNoLote.has(evento.event_id)) {
      resultados[indice] = { event: evento.event, event_id: evento.event_id, resultado: "repetido" };
      continue;
    }
    vistosNoLote.add(evento.event_id);
    aGravar.push({
      indice,
      linha: buildLeadActivityRow({
        organizationId: input.organizationId,
        leadId: input.leadId,
        contactId: pedido.contatoId,
        type: TIPO_DO_EVENTO_EXTERNO,
        sourceModule: ORIGEM_DO_EVENTO_EXTERNO,
        actor: input.actor,
        reason: `Evento ${evento.event}`,
        performedAt: quando,
        payload: {
          event: evento.event,
          at: quando,
          event_id: evento.event_id,
          ...(evento.data ? { data: evento.data } : {}),
        },
      }),
    });
  }

  if (aGravar.length > 0) {
    const porLinha = await gravarLinhas(supabase, aGravar.map((g) => g.linha), requestId);
    aGravar.forEach((g, i) => {
      const e = input.eventos[g.indice]!;
      resultados[g.indice] = { event: e.event, event_id: e.event_id, resultado: porLinha[i] ?? "registrado" };
    });
  }

  return { lead_id: input.leadId, resultados: resultados as ResultadoDoEvento[] };
}
