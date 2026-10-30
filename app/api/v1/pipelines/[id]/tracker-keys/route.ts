/**
 * GET/POST/DELETE /api/v1/pipelines/[id]/tracker-keys — as chaves públicas do rastreador de um funil.
 *
 * A chave é um identificador PÚBLICO (vai no HTML do site do cliente), não um segredo: quem a prende ao site é a lista
 * de origens. Por isso a API a devolve inteira em toda leitura — ao contrário de um token `dsk_`, não há "mostrar só
 * uma vez". O banco gera o valor (`pk_` + 36 hex); a rota nunca o escolhe.
 *
 * Auth: sessão por cookie, manager+. `organization_id` sai do JWT, nunca do corpo (o schema é `strict`: mandar
 * `organization_id` é 422). Funil de outra organização responde 404, igual a um que não existe. Todo handler que
 * muda algo declara `requireSupportWrite(` antes do efeito.
 *
 * DELETE (sem `key_id`) EXCLUI de vez as chaves JÁ REVOGADAS do funil — nunca uma ativa: o filtro `revoked_at is not
 * null` é parte do comando, não uma checagem anterior que uma corrida pudesse furar. Revogar continua sendo o
 * `DELETE .../[key_id]`. O histórico dos eventos que a chave trouxe fica (ele só guarda o id), e a auditoria registra
 * quais chaves saíram. Sem nenhuma revogada responde 200 com `excluidas: 0` e não audita: nada aconteceu.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { funilDaOrganizacao } from "@/lib/leads/eventos-do-funil/cadastro";
import { createClient } from "@/lib/supabase/server";
import { normalizarOrigens, novaChaveSchema } from "@/lib/tracker/origens";
import { COLUNAS_DA_CHAVE, lerChavesComUso } from "@/lib/tracker/uso";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const COLUNAS = COLUNAS_DA_CHAVE;

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "tracker_keys" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id: pipelineId } = await ctx.params;
  const supabase = await createClient();

  try {
    if (!(await funilDaOrganizacao(supabase, authz.org.orgId, pipelineId))) {
      return fail("not_found", t("Funil não encontrado."), 404, { requestId });
    }
    return ok({ chaves: await lerChavesComUso(supabase, authz.org.orgId, pipelineId) }, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "tracker_keys" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const { id: pipelineId } = await ctx.params;

  const parsed = novaChaveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const origens = normalizarOrigens(parsed.data.allowed_origins);
  if (!origens.ok) {
    // A frase é fixa (é ela que `t()` traduz); a origem recusada entra depois, fora do `t()`.
    return fail(
      "validation_failed",
      `${t("Origem não aceita: use o endereço do site começando por https://, sem caminho (http só em localhost).")} («${origens.invalida}»)`,
      422,
      { requestId },
    );
  }

  const supabase = await createClient();
  try {
    if (!(await funilDaOrganizacao(supabase, orgId, pipelineId))) {
      return fail("not_found", t("Funil não encontrado."), 404, { requestId });
    }
    const { data, error } = await supabase
      .from("crm_tracker_public_keys")
      .insert({
        organization_id: orgId,
        pipeline_id: pipelineId,
        label: parsed.data.label,
        allowed_origins: origens.origens,
        created_by: authz.user.id,
      })
      .select(COLUNAS)
      .single();
    if (error) throw new Error(error.message);
    const chave = data as { id: string; label: string; allowed_origins: string[] };
    void audit({
      action: "tracker_key.created",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "crm_tracker_public_key",
      resourceId: chave.id,
      requestId,
      metadata: { pipeline_id: pipelineId, label: chave.label, origens: chave.allowed_origins },
    });
    return ok({ chave }, { requestId, status: 201 });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "tracker_keys" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const { id: pipelineId } = await ctx.params;
  const supabase = await createClient();

  try {
    if (!(await funilDaOrganizacao(supabase, orgId, pipelineId))) {
      return fail("not_found", t("Funil não encontrado."), 404, { requestId });
    }
    const { data, error } = await supabase
      .from("crm_tracker_public_keys")
      .delete()
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .not("revoked_at", "is", null)
      .select("id, label");
    if (error) throw new Error(error.message);
    const excluidas = (data ?? []) as { id: string; label: string }[];
    if (excluidas.length > 0) {
      void audit({
        action: "tracker_key.purged",
        actorUserId: authz.user.id,
        organizationId: orgId,
        resourceType: "crm_pipeline",
        resourceId: pipelineId,
        requestId,
        metadata: { pipeline_id: pipelineId, quantidade: excluidas.length, chaves: excluidas.map((c) => ({ id: c.id, label: c.label })) },
      });
    }
    return ok({ excluidas: excluidas.length }, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
