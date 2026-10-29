/**
 * PATCH/DELETE /api/v1/pipelines/[id]/events/[event_id] — editar e desativar um evento do funil.
 *
 * PATCH altera os campos que vierem (o resto fica; `null` limpa). A `key` é imutável depois que o evento recebeu
 * qualquer coisa: o histórico guarda o nome dele. As validações contra o funil (etapa, "guardar em") só rodam para o
 * que MUDOU: editar o nome de um evento cuja etapa foi arquivada depois não pode quebrar por causa da etapa.
 *
 * DELETE desativa (`is_active = false`); não apaga. O histórico e o cadastro ficam, e a operação passa a recusar o
 * evento com `evento_inativo`. Desativar o que já está desativado é um no-op que responde 200 (idempotente).
 *
 * Todo handler que muda algo declara `requireSupportWrite(` antes do efeito. Papel manager+, organização da sessão.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  COLUNAS_DO_CADASTRO,
  edicaoDoEventoSchema,
  eventoJaRecebeuAlgo,
  validarContraOFunil,
  type EventoCadastrado,
} from "@/lib/leads/eventos-do-funil/cadastro";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; event_id: string }>;
}

const uuid = z.string().uuid();

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pipeline_events" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const userId = authz.user.id;
  const { id: pipelineId, event_id: eventoId } = await ctx.params;

  if (!uuid.safeParse(eventoId).success) return fail("not_found", t("Evento não encontrado."), 404, { requestId });

  const json = await req.json().catch(() => null);
  const parsed = edicaoDoEventoSchema.safeParse(json);
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  // Só o que veio: `undefined` é "não mexi", `null` é "limpar".
  const pedido = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Record<string, unknown>;

  const supabase = await createClient();
  try {
    const { data: lido, error: erroDeLeitura } = await supabase
      .from("crm_pipeline_events")
      .select(COLUNAS_DO_CADASTRO)
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .eq("id", eventoId)
      .maybeSingle();
    if (erroDeLeitura) throw new Error(erroDeLeitura.message);
    const atual = lido as EventoCadastrado | null;
    if (!atual) return fail("not_found", t("Evento não encontrado."), 404, { requestId });

    // O que de fato muda (um campo reenviado com o mesmo valor não é mudança).
    const mudancas = Object.fromEntries(
      Object.entries(pedido).filter(([campo, valor]) => (atual as unknown as Record<string, unknown>)[campo] !== valor),
    ) as Record<string, unknown>;
    if (Object.keys(mudancas).length === 0) return ok({ evento: atual, avisos: [] as string[] }, { requestId });

    // O par do valor vale para o resultado final, não para o que veio: mandar só a unidade a um evento sem caminho é erro.
    const depois = { ...atual, ...mudancas } as EventoCadastrado;
    if ((depois.value_path == null) !== (depois.value_unit == null)) {
      return fail("validation_failed", t("Informe o campo do valor e a unidade juntos, ou nenhum dos dois."), 422, { requestId });
    }

    if ("key" in mudancas && (await eventoJaRecebeuAlgo(supabase, orgId, pipelineId, atual.key))) {
      return fail(
        "state_conflict",
        `${t("Este evento já recebeu registros e a chave não pode mudar.")} («${atual.key}»)`,
        409,
        { requestId },
      );
    }

    const validacao = await validarContraOFunil(
      supabase,
      orgId,
      pipelineId,
      {
        stage_id: "stage_id" in mudancas ? (mudancas.stage_id as string | null) : undefined,
        state_key: "state_key" in mudancas ? (mudancas.state_key as string | null) : undefined,
      },
      eventoId,
    );
    if (validacao.erros.length > 0) {
      return fail("unprocessable_entity", validacao.erros[0]!, 422, { requestId, details: { erros: validacao.erros } });
    }

    const { data: gravado, error } = await supabase
      .from("crm_pipeline_events")
      .update(mudancas)
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .eq("id", eventoId)
      .select(COLUNAS_DO_CADASTRO)
      .maybeSingle();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return fail("state_conflict", `${t("Já existe um evento com essa chave neste funil.")} («${String(mudancas.key)}»)`, 409, { requestId });
      }
      throw new Error(error.message);
    }
    if (!gravado) return fail("not_found", t("Evento não encontrado."), 404, { requestId });

    void audit({
      action: "pipeline_event.updated",
      actorUserId: userId,
      organizationId: orgId,
      resourceType: "crm_pipeline_event",
      resourceId: eventoId,
      requestId,
      metadata: {
        pipeline_id: pipelineId,
        key: atual.key,
        campos: Object.keys(mudancas),
        ...("stage_id" in mudancas ? { stage_id: { de: atual.stage_id, para: mudancas.stage_id } } : {}),
      },
    });
    return ok({ evento: gravado as EventoCadastrado, avisos: validacao.avisos }, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pipeline_events" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const userId = authz.user.id;
  const { id: pipelineId, event_id: eventoId } = await ctx.params;

  if (!uuid.safeParse(eventoId).success) return fail("not_found", t("Evento não encontrado."), 404, { requestId });

  const supabase = await createClient();
  try {
    const { data: lido, error: erroDeLeitura } = await supabase
      .from("crm_pipeline_events")
      .select(COLUNAS_DO_CADASTRO)
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .eq("id", eventoId)
      .maybeSingle();
    if (erroDeLeitura) throw new Error(erroDeLeitura.message);
    const atual = lido as EventoCadastrado | null;
    if (!atual) return fail("not_found", t("Evento não encontrado."), 404, { requestId });
    if (!atual.is_active) return ok({ evento: atual }, { requestId });

    const { data: gravado, error } = await supabase
      .from("crm_pipeline_events")
      .update({ is_active: false })
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .eq("id", eventoId)
      .select(COLUNAS_DO_CADASTRO)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!gravado) return fail("not_found", t("Evento não encontrado."), 404, { requestId });

    void audit({
      action: "pipeline_event.deactivated",
      actorUserId: userId,
      organizationId: orgId,
      resourceType: "crm_pipeline_event",
      resourceId: eventoId,
      requestId,
      metadata: { pipeline_id: pipelineId, key: atual.key },
    });
    return ok({ evento: gravado as EventoCadastrado }, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
