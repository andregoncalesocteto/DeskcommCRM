/**
 * Leitura do CADASTRO de eventos de um funil (`crm_pipeline_events`) para a tela de configuração.
 *
 * Cada evento vem com dois sinais de uso lidos do HISTÓRICO (ADR-0008): quando foi visto pela última vez e quantas
 * vezes nos últimos 7 dias. É o laço de retorno da feature: quem cadastra vê se o evento está chegando. A consulta usa
 * junção interna com o pedido para filtrar pelo funil, porque `crm_lead_activities` não tem coluna de funil.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FORMA_DO_CAMINHO } from "@/lib/leads/eventos-do-funil/caminho-e-valor";

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

// ---------------------------------------------------------------------------
// criar e editar: o contrato do cadastro e as validações contra o funil
// ---------------------------------------------------------------------------

const FORMA_DA_CHAVE = /^[a-z][a-z0-9_]{0,63}$/;
const caminho = z.string().max(200).regex(FORMA_DO_CAMINHO, "Use só nomes de campo separados por ponto, como pedido.total.");

/** Os campos que o cadastro aceita criar. `nullish` porque quem integra pode mandar `null` para "sem isto". */
const camposDoCadastro = {
  key: z.string().regex(FORMA_DA_CHAVE, "A chave usa minúsculas, números e _, começa por letra e tem até 64 caracteres."),
  label: z.string().trim().min(1, "Dê um nome ao evento.").max(80, "O nome do evento tem até 80 caracteres."),
  description: z.string().max(500, "A descrição tem até 500 caracteres.").nullish(),
  stage_id: z.string().uuid().nullish(),
  respects_manual_move: z.boolean().optional(),
  state_key: z.string().regex(FORMA_DA_CHAVE, "Guardar em: minúsculas, números e _, começando por letra.").nullish(),
  value_path: caminho.nullish(),
  value_unit: z.enum(["reais", "centavos"]).nullish(),
  dedupe_path: caminho.nullish(),
  is_active: z.boolean().optional(),
};

const VALOR_JUNTO = {
  message: "Informe o campo do valor e a unidade juntos, ou nenhum dos dois.",
  path: ["value_path"],
};

export const novoEventoSchema = z
  .strictObject(camposDoCadastro)
  .refine((e) => (e.value_path == null) === (e.value_unit == null), VALOR_JUNTO);
export type NovoEvento = z.infer<typeof novoEventoSchema>;

export interface ValidacaoDoCadastro {
  /** Recusam o cadastro (422). */
  erros: string[];
  /** Não bloqueiam; vão na resposta para a tela mostrar. */
  avisos: string[];
}

interface EtapaLida {
  id: string;
  name: string;
  pipeline_id: string;
  is_archived: boolean;
  is_lost: boolean;
}

/**
 * O que só o banco sabe: a etapa de destino é deste funil, está ativa e não é de perda; "guardar em" não pode ser a
 * chave de um campo declarado da ficha (o evento sobrescreveria um campo que a equipe edita à mão); e dois eventos
 * guardando no mesmo lugar merecem um aviso (o último que chegar vence). `idDoProprio` exclui o evento que está sendo editado.
 */
export async function validarContraOFunil(
  supabase: SupabaseClient,
  organizationId: string,
  pipelineId: string,
  evento: { stage_id?: string | null; state_key?: string | null },
  idDoProprio?: string,
): Promise<ValidacaoDoCadastro> {
  const erros: string[] = [];
  const avisos: string[] = [];

  if (evento.stage_id) {
    const { data, error } = await supabase
      .from("crm_stages")
      .select("id, name, pipeline_id, is_archived, is_lost")
      .eq("organization_id", organizationId)
      .eq("id", evento.stage_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const etapa = data as EtapaLida | null;
    if (!etapa || etapa.pipeline_id !== pipelineId) erros.push("A etapa de destino não é deste funil.");
    else if (etapa.is_archived) erros.push(`A etapa «${etapa.name}» está arquivada: escolha outra etapa de destino.`);
    else if (etapa.is_lost) erros.push(`A etapa «${etapa.name}» é de perda: um evento não leva o card para uma etapa de perda.`);
  }

  if (evento.state_key) {
    const { data: funil, error } = await supabase
      .from("crm_pipelines")
      .select("settings")
      .eq("organization_id", organizationId)
      .eq("id", pipelineId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const campos = ((funil as { settings?: { fields?: Array<{ key?: string }> } } | null)?.settings?.fields ?? []);
    if (campos.some((c) => c.key === evento.state_key)) {
      erros.push(
        `«${evento.state_key}» já é um campo da ficha deste funil: escolha outro nome para guardar o conteúdo do evento.`,
      );
    }

    const { data: outros, error: erroDosOutros } = await supabase
      .from("crm_pipeline_events")
      .select("id, key, label")
      .eq("organization_id", organizationId)
      .eq("pipeline_id", pipelineId)
      .eq("state_key", evento.state_key);
    if (erroDosOutros) throw new Error(erroDosOutros.message);
    for (const o of (outros ?? []) as Array<{ id: string; label: string }>) {
      if (o.id === idDoProprio) continue;
      avisos.push(
        `O evento «${o.label}» já guarda o conteúdo em «${evento.state_key}»: o último evento que chegar sobrescreve o outro.`,
      );
    }
  }
  return { erros, avisos };
}
