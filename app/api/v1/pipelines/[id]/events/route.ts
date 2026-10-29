/**
 * GET/POST /api/v1/pipelines/[id]/events — o cadastro de eventos de um funil.
 *
 * GET lista, com os sinais de uso. POST cria um evento: aceita `Idempotency-Key`, valida o corpo com Zod e o resto
 * contra o funil (etapa do mesmo funil, não arquivada, nunca de perda; "guardar em" que colide com campo da ficha
 * bloqueia; repetido só avisa), e audita. Todo handler que muda algo declara `requireSupportWrite(` antes do efeito.
 *
 * "Para onde o card vai em cada evento" (Configurações › Funis). O cadastro é o contrato de quem integra um
 * sistema de fora (ADR-0007, ADR-0009); esta rota é o lado da tela.
 *
 * Auth: sessão por cookie, papel manager+ (é configuração do funil). `organization_id` sai do JWT — nunca do
 * corpo. O client é o do usuário, então a RLS vale; o filtro explícito de `organization_id` é a convenção do repo e
 * a rede que sobra se a política mudar. Funil de outra organização responde 404, a MESMA resposta de um funil que
 * não existe: dizer "existe, mas não é seu" já é vazar a existência.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { z } from "zod";

import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import {
  COLUNAS_DO_CADASTRO,
  funilDaOrganizacao,
  lerCadastroComUso,
  novoEventoSchema,
  validarContraOFunil,
  type EventoCadastrado,
} from "@/lib/leads/eventos-do-funil/cadastro";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pipeline_events" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { id: pipelineId } = await ctx.params;
  const supabase = await createClient();

  try {
    if (!(await funilDaOrganizacao(supabase, authz.org.orgId, pipelineId))) {
      return fail("not_found", t("Funil não encontrado."), 404, { requestId });
    }
    const eventos = await lerCadastroComUso(supabase, authz.org.orgId, pipelineId);
    return ok({ eventos }, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

/** A chave já existe neste funil: o índice único da tabela respondeu `23505`. */
class ChaveJaCadastrada extends Error {}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pipeline_events" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const userId = authz.user.id;
  const { id: pipelineId } = await ctx.params;

  const json = await req.json().catch(() => null);
  const parsed = novoEventoSchema.safeParse(json);
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const evento = parsed.data;

  // Idempotency-Key, quando vem, tem de ser UUID: chave malformada não vira recibo.
  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.string().uuid().safeParse(chave).success) {
    return fail("validation_error", "Idempotency-Key deve ser UUID", 400, { requestId });
  }

  const supabase = await createClient();

  // Tudo que pode recusar acontece ANTES do efeito e do recibo: recibo de operação recusada seria pior que nenhum.
  let validacao: Awaited<ReturnType<typeof validarContraOFunil>>;
  try {
    if (!(await funilDaOrganizacao(supabase, orgId, pipelineId))) {
      return fail("not_found", t("Funil não encontrado."), 404, { requestId });
    }
    validacao = await validarContraOFunil(supabase, orgId, pipelineId, evento);
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
  if (validacao.erros.length > 0) {
    return fail("unprocessable_entity", validacao.erros[0]!, 422, {
      requestId,
      details: { erros: validacao.erros },
    });
  }

  /** O efeito. Lança em falha de propósito: assim a idempotência não grava recibo de uma criação que não houve. */
  async function criar() {
    const { data, error } = await supabase
      .from("crm_pipeline_events")
      .insert({
        organization_id: orgId,
        pipeline_id: pipelineId,
        key: evento.key,
        label: evento.label,
        description: evento.description ?? null,
        stage_id: evento.stage_id ?? null,
        respects_manual_move: evento.respects_manual_move ?? true,
        state_key: evento.state_key ?? null,
        value_path: evento.value_path ?? null,
        value_unit: evento.value_unit ?? null,
        dedupe_path: evento.dedupe_path ?? null,
        is_active: evento.is_active ?? true,
      })
      .select(COLUNAS_DO_CADASTRO)
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505") throw new ChaveJaCadastrada();
      throw new Error(error.message);
    }
    const criado = data as EventoCadastrado;
    void audit({
      action: "pipeline_event.created",
      actorUserId: userId,
      organizationId: orgId,
      resourceType: "crm_pipeline_event",
      resourceId: criado.id,
      requestId,
      metadata: { pipeline_id: pipelineId, key: criado.key, stage_id: criado.stage_id },
    });
    return { evento: criado, avisos: validacao.avisos };
  }

  try {
    if (chave === null) return ok(await criar(), { requestId, status: 201 });

    const desfecho = await comIdempotencia({
      db: supabase,
      organizationId: orgId,
      endpoint: `/api/v1/pipelines/${pipelineId}/events`,
      chave,
      corpo: evento,
      executar: async () => ({ resposta: await criar(), status: 201 }),
    });
    if (desfecho.tipo === "conflito") {
      return fail("idempotency_conflict", t("Esta chave de idempotência já foi usada com outro conteúdo."), 409, { requestId });
    }
    if (desfecho.tipo === "em_curso") {
      return fail("idempotency_in_progress", t("A mesma requisição ainda está em curso. Tente de novo em instantes."), 409, { requestId });
    }
    return ok(desfecho.resposta, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ChaveJaCadastrada) {
      // A frase é fixa (é ela que `t()` traduz); a chave entra depois, fora do `t()`.
      return fail("state_conflict", `${t("Já existe um evento com essa chave neste funil.")} («${evento.key}»)`, 409, { requestId });
    }
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
