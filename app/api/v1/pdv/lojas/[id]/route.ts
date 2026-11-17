/**
 * PATCH /api/v1/pdv/lojas/{id} — ativa/desativa a loja e liga a conexão de WhatsApp.
 *
 * Papel mínimo `manager`. `channel_session_id` precisa ser uma conexão DO MESMO tenant
 * (outra org = 422); `null` desliga. Módulo desligado = 404. O tenant sai da sessão.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { recusaSeModuloDesligado } from "@/lib/pdv/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS = "id, erp_store_code, sigla, nome, ativa, channel_session_id, created_at, updated_at";

const alterarSchema = z
  .object({
    ativa: z.boolean().optional(),
    channel_session_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((c) => c.ativa !== undefined || c.channel_session_id !== undefined, {
    message: "Informe ativa ou channel_session_id.",
  });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pdv_stores" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const desligado = await recusaSeModuloDesligado(requestId);
  if (desligado) return desligado;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Loja não encontrada.", 404, { requestId });
  }
  const corpo = alterarSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", corpo.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
    });
  }

  const supabase = await createClient();

  const alvo = corpo.data.channel_session_id;
  if (alvo) {
    const { data: conexao, error } = await supabase
      .from("channel_sessions")
      .select("id")
      .eq("id", alvo)
      .eq("organization_id", org.orgId)
      .maybeSingle();
    if (error) return fail("internal_error", "Não foi possível alterar a loja.", 500, { requestId });
    if (!conexao) {
      return fail("validation_failed", "A conexão informada não existe neste tenant.", 422, {
        requestId,
        details: { channel_session_id: ["conexão inexistente"] },
      });
    }
  }

  const { data, error } = await supabase
    .from("pdv_stores")
    .update({ ...corpo.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .select(COLUNAS)
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível alterar a loja.", 500, { requestId });
  if (!data) return fail("not_found", "Loja não encontrada.", 404, { requestId });

  void audit({
    action: "pdv.store.updated",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "pdv_store",
    resourceId: data.id,
    requestId,
    metadata: { operacao: "alterar", campos: Object.keys(corpo.data), ...corpo.data },
  });
  return ok(data, { requestId });
}
