/**
 * `crm_track_event` — a operação que recebe os fatos de um pedido e responde o que aconteceu com CADA um.
 *
 * Esta camada valida contra o CADASTRO do funil (`crm_pipeline_events`), grava no histórico e aplica ao pedido o que
 * o cadastro pede: guardar o último conteúdo (`state_key`) e o valor da venda (`value_path`). O contrato é: um
 * resultado por evento, na ordem enviada, e um evento recusado nunca derruba os outros do lote.
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
 * banco pega a corrida (`gravarLinhas` trata o `23505`). Com `dedupe_path` cadastrado há uma segunda repetição, a do
 * FATO DE NEGÓCIO (o mesmo `order_id` com outro `event_id`): é `repetido` e nada mais acontece.
 *
 * ## Estado e valor: cada passo se protege sozinho
 *
 * O estado só substitui o anterior se a hora do evento for igual ou mais nova que a do último da mesma chave, lido do
 * próprio histórico (ADR-0008); o valor vira `value_cents`. Os dois vão na MESMA atualização do pedido, que acontece
 * DEPOIS de o evento estar no histórico. Nenhum depende de o registro ter sido novo: um `event_id` já gravado (queda
 * no meio de uma chamada anterior) é reaplicado, e a hora do evento impede que um reenvio antigo sobrescreva o novo.
 * Valor inválido recusa o evento ANTES de gravar qualquer coisa. Pedido encerrado não muda de estado nem de valor.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { updateLeadHandler } from "@/app/api/v1/leads/_handler";
import { buildLeadActivityRow, type LeadActivityRow } from "@/lib/leads/activity-emitter";
import { resolverCaminho, valorEmCentavos, type UnidadeDoValor } from "@/lib/leads/eventos-do-funil/caminho-e-valor";
import { estadoDevePrevalecer } from "@/lib/leads/eventos-do-funil/decisao-de-movimento";
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

export type CodigoDeRecusa =
  | "evento_nao_cadastrado"
  | "evento_inativo"
  | "evento_grande"
  | "hora_fora_da_janela"
  | "valor_invalido";

/** O que aconteceu com o conteúdo do evento no pedido (`custom_fields[state_key]`). */
export type SituacaoDoEstado = "aplicado" | "sem_state_key" | "ignorado_antigo" | "ignorado_pedido_encerrado";
/** O que aconteceu com o valor da venda (`value_cents`). */
export type SituacaoDoValor = "aplicado" | "sem_campo" | "ignorado_pedido_encerrado";

export type ResultadoDoEvento =
  | { event: string; event_id: string; resultado: "registrado"; estado: SituacaoDoEstado; valor: SituacaoDoValor }
  // `estado` e `valor` só existem quando o `event_id` já estava gravado e foi reaplicado; a repetição do fato de
  // negócio (e do próprio lote) não faz mais nada.
  | { event: string; event_id: string; resultado: "repetido"; estado?: SituacaoDoEstado; valor?: SituacaoDoValor }
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
  state_key: string | null;
  value_path: string | null;
  value_unit: UnidadeDoValor | null;
  dedupe_path: string | null;
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
    .select("key, is_active, state_key, value_path, value_unit, dedupe_path")
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
  const candidatos: Candidato[] = [];

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
    // O valor é validado ANTES de gravar qualquer coisa: evento com valor ilegível não vira linha no histórico.
    let centavos: number | null = null;
    if (cadastrado.value_path && cadastrado.value_unit) {
      const bruto = resolverCaminho(e.data, cadastrado.value_path);
      if (bruto === undefined) {
        resultados[indice] = recusar(e, "valor_invalido", `O evento "${e.event}" não trouxe o campo do valor ("${cadastrado.value_path}").`);
        return;
      }
      const convertido = valorEmCentavos(bruto, cadastrado.value_unit);
      if (!convertido.ok) {
        resultados[indice] = recusar(
          e,
          "valor_invalido",
          `O campo do valor ("${cadastrado.value_path}") ${MOTIVOS_DO_VALOR[convertido.motivo]}.`,
        );
        return;
      }
      centavos = convertido.centavos;
    }
    candidatos.push({
      indice,
      evento: e,
      quando: e.at ? new Date(e.at).toISOString() : agora.toISOString(),
      cadastrado,
      centavos,
    });
  });

  // Repetição do FATO DE NEGÓCIO (`dedupe_path`): o mesmo order_id com outro event_id. Não faz mais nada.
  const aposNegocio: Candidato[] = [];
  const chavesDeNegocio = await chavesDeNegocioJaRegistradas(supabase, input, candidatos, requestId);
  const vistosNoLoteDeNegocio = new Map<string, string>();
  for (const c of candidatos) {
    const bk = chaveDeNegocio(c);
    if (bk !== null) {
      const dono = chavesDeNegocio.get(bk)?.find((id) => id !== c.evento.event_id) ?? vistosNoLoteDeNegocio.get(bk);
      if (dono !== undefined) {
        resultados[c.indice] = { event: c.evento.event, event_id: c.evento.event_id, resultado: "repetido" };
        continue;
      }
      vistosNoLoteDeNegocio.set(bk, c.evento.event_id);
    }
    aposNegocio.push(c);
  }

  // Repetição por event_id: o que já está gravado neste pedido e o que se repete dentro do próprio lote.
  const jaGravados = await eventIdsJaGravados(
    supabase,
    input.organizationId,
    input.leadId,
    [...new Set(aposNegocio.map((c) => c.evento.event_id))],
  );
  const vistosNoLote = new Set<string>();
  const aGravar: Array<{ candidato: Candidato; linha: LeadActivityRow }> = [];
  const jaEstavaGravado: Candidato[] = [];
  for (const c of aposNegocio) {
    const { evento } = c;
    if (vistosNoLote.has(evento.event_id)) {
      resultados[c.indice] = { event: evento.event, event_id: evento.event_id, resultado: "repetido" };
      continue;
    }
    vistosNoLote.add(evento.event_id);
    if (jaGravados.has(evento.event_id)) {
      jaEstavaGravado.push(c);
      continue;
    }
    aGravar.push({
      candidato: c,
      linha: buildLeadActivityRow({
        organizationId: input.organizationId,
        leadId: input.leadId,
        contactId: pedido.contatoId,
        type: TIPO_DO_EVENTO_EXTERNO,
        sourceModule: ORIGEM_DO_EVENTO_EXTERNO,
        actor: input.actor,
        reason: `Evento ${evento.event}`,
        performedAt: c.quando,
        payload: {
          event: evento.event,
          at: c.quando,
          event_id: evento.event_id,
          ...(evento.data ? { data: evento.data } : {}),
        },
      }),
    });
  }

  const situacao = new Map<number, "registrado" | "repetido">();
  jaEstavaGravado.forEach((c) => situacao.set(c.indice, "repetido"));
  if (aGravar.length > 0) {
    const porLinha = await gravarLinhas(supabase, aGravar.map((g) => g.linha), requestId);
    aGravar.forEach((g, i) => situacao.set(g.candidato.indice, porLinha[i] ?? "registrado"));
  }

  // Estado e valor: DEPOIS de tudo estar no histórico, na ordem enviada. Rodam também para o que já estava gravado.
  const encerrado = pedido.status === "won" || pedido.status === "lost";
  const instantes = new Map<string, Array<{ eventId: string | undefined; quando: string }>>();
  for (const c of [...aGravar.map((g) => g.candidato), ...jaEstavaGravado].sort((a, b) => a.indice - b.indice)) {
    const aplicado = await aplicarAoPedido(supabase, input, c, encerrado, instantes, requestId);
    resultados[c.indice] = {
      event: c.evento.event,
      event_id: c.evento.event_id,
      resultado: situacao.get(c.indice) ?? "registrado",
      estado: aplicado.estado,
      valor: aplicado.valor,
    };
  }

  return { lead_id: input.leadId, resultados: resultados as ResultadoDoEvento[] };
}

interface Candidato {
  indice: number;
  evento: EventoDoFunil;
  quando: string;
  cadastrado: EventoCadastrado;
  /** O valor já convertido; `null` quando o cadastro não pede valor. */
  centavos: number | null;
}

const MOTIVOS_DO_VALOR = {
  nao_numerico: "não é um número",
  nao_finito: "não é um número finito",
  negativo: "é negativo",
  centavos_nao_inteiro: "deveria ser um número inteiro de centavos",
  fora_do_alcance: "é grande demais",
} as const;

/** A chave de negócio do candidato (`event` + valor no `dedupe_path`), ou `null` se o cadastro não pede ou o campo não veio. */
function chaveDeNegocio(c: Candidato): string | null {
  const caminho = c.cadastrado.dedupe_path;
  if (!caminho) return null;
  const valor = resolverCaminho(c.evento.data, caminho);
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  return `${c.evento.event}\u0000${valor}`;
}

/** Das chaves de negócio dos candidatos, as que já constam no histórico do pedido (com os `event_id` que as detêm). */
async function chavesDeNegocioJaRegistradas(
  supabase: SupabaseClient,
  input: RegistrarEventosDoFunilInput,
  candidatos: readonly Candidato[],
  requestId: string,
): Promise<Map<string, string[]>> {
  const achadas = new Map<string, string[]>();
  const eventosComChave = [...new Set(candidatos.filter((c) => c.cadastrado.dedupe_path).map((c) => c.evento.event))];
  for (const evento of eventosComChave) {
    const caminho = candidatos.find((c) => c.evento.event === evento)!.cadastrado.dedupe_path!;
    const { data, error } = await supabase
      .from("crm_lead_activities")
      .select("payload")
      .eq("organization_id", input.organizationId)
      .eq("lead_id", input.leadId)
      .eq("type", TIPO_DO_EVENTO_EXTERNO)
      .eq("payload->>event", evento);
    if (error) throw new ApiError(500, "internal_error", undefined, requestId, `Não consegui ler o histórico do pedido: ${error.message}`);
    for (const linha of (data ?? []) as Array<{ payload?: { event_id?: string; data?: unknown } }>) {
      const valor = resolverCaminho(linha.payload?.data, caminho);
      if (typeof valor !== "string" && typeof valor !== "number") continue;
      const chave = `${evento}\u0000${valor}`;
      achadas.set(chave, [...(achadas.get(chave) ?? []), linha.payload?.event_id ?? ""]);
    }
  }
  return achadas;
}

/**
 * Aplica ao pedido o estado e o valor do evento, numa única atualização. O estado só vale se a hora do evento for
 * igual ou mais nova que a do último evento da mesma chave NO HISTÓRICO (sem contar o próprio).
 */
async function aplicarAoPedido(
  supabase: SupabaseClient,
  input: RegistrarEventosDoFunilInput,
  c: Candidato,
  encerrado: boolean,
  instantes: Map<string, Array<{ eventId: string | undefined; quando: string }>>,
  requestId: string,
): Promise<{ estado: SituacaoDoEstado; valor: SituacaoDoValor }> {
  const patch: { custom_fields?: Record<string, unknown>; value_cents?: number } = {};

  let estado: SituacaoDoEstado;
  if (!c.cadastrado.state_key) estado = "sem_state_key";
  else if (encerrado) estado = "ignorado_pedido_encerrado";
  else {
    if (!instantes.has(c.evento.event)) {
      const { data, error } = await supabase
        .from("crm_lead_activities")
        .select("performed_at, payload")
        .eq("organization_id", input.organizationId)
        .eq("lead_id", input.leadId)
        .eq("type", TIPO_DO_EVENTO_EXTERNO)
        .eq("payload->>event", c.evento.event);
      if (error) throw new ApiError(500, "internal_error", undefined, requestId, `Não consegui ler o histórico do pedido: ${error.message}`);
      instantes.set(
        c.evento.event,
        ((data ?? []) as Array<{ performed_at: string; payload?: { event_id?: string } }>).map((l) => ({
          eventId: l.payload?.event_id,
          quando: l.performed_at,
        })),
      );
    }
    const outros = (instantes.get(c.evento.event) ?? []).filter((l) => l.eventId !== c.evento.event_id);
    const ultimo = outros.reduce<string | null>(
      (maior, l) => (maior === null || Date.parse(l.quando) > Date.parse(maior) ? l.quando : maior),
      null,
    );
    if (estadoDevePrevalecer(c.quando, ultimo)) {
      estado = "aplicado";
      patch.custom_fields = { [c.cadastrado.state_key]: c.evento.data ?? {} };
    } else {
      estado = "ignorado_antigo";
    }
  }

  let valor: SituacaoDoValor;
  if (c.centavos === null) valor = "sem_campo";
  else if (encerrado) valor = "ignorado_pedido_encerrado";
  else {
    valor = "aplicado";
    patch.value_cents = c.centavos;
  }

  if (patch.custom_fields !== undefined || patch.value_cents !== undefined) {
    await updateLeadHandler(supabase, { organization_id: input.organizationId, actor: input.actor, requestId }, input.leadId, patch);
  }
  return { estado, valor };
}
