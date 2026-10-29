/**
 * DELETE /api/v1/pipelines/[id]/tracker-keys/[key_id] — revoga uma chave pública do rastreador.
 *
 * Revogar DESATIVA na hora (`is_active = false`, `revoked_at = now()`) e não apaga: a linha fica para a auditoria e
 * para o `created_by`. A chave não volta — para ter uma nova, cria-se outra. Revogar de novo uma chave já revogada
 * responde 200 sem mexer em nada (e sem auditar de novo): o efeito já aconteceu.
 *
 * Auth: manager+; `organization_id` do JWT. Chave de outro funil ou de outra organização responde 404.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; key_id: string }>;
}

const COLUNAS = "id, pipeline_id, public_key, label, allowed_origins, is_active, revoked_at, created_at";

export async function DELETE(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "tracker_keys" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const { id: pipelineId, key_id: keyId } = await ctx.params;

  if (!z.string().uuid().safeParse(keyId).success) {
    return fail("not_found", t("Chave não encontrada."), 404, { requestId });
  }

  const supabase = await createClient();
  try {
    const { data: atual, error: erroLeitura } = await supabase
      .from("crm_tracker_public_keys")
      .select(COLUNAS)
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .eq("id", keyId)
      .maybeSingle();
    if (erroLeitura) throw new Error(erroLeitura.message);
    if (!atual) return fail("not_found", t("Chave não encontrada."), 404, { requestId });
    if ((atual as { revoked_at: string | null }).revoked_at !== null) return ok({ chave: atual }, { requestId });

    const { data, error } = await supabase
      .from("crm_tracker_public_keys")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .eq("id", keyId)
      .select(COLUNAS)
      .single();
    if (error) throw new Error(error.message);
    void audit({
      action: "tracker_key.revoked",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "crm_tracker_public_key",
      resourceId: keyId,
      requestId,
      metadata: { pipeline_id: pipelineId },
    });
    return ok({ chave: data }, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
