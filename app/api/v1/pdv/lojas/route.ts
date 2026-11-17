/**
 * GET /api/v1/pdv/lojas — as lojas que o tenant atende (módulo PDV, `pdv_stores`).
 *
 * Papel mínimo `agent`. O tenant sai da sessão; o filtro por `organization_id` é explícito
 * além da RLS. Módulo desligado = 404.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { recusaSeModuloDesligado } from "@/lib/pdv/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const consultaSchema = z.object({
  ativa: z.enum(["true", "false"]).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "pdv_stores" });
  if (!authz.ok) return authz.response;

  const lida = consultaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!lida.success) {
    return fail("validation_failed", lida.error.issues[0]?.message ?? "consulta inválida", 422, {
      requestId,
    });
  }

  const desligado = await recusaSeModuloDesligado(requestId);
  if (desligado) return desligado;

  const supabase = await createClient();
  let q = supabase
    .from("pdv_stores")
    .select("id, erp_store_code, sigla, nome, ativa, channel_session_id, created_at, updated_at")
    .eq("organization_id", authz.org.orgId)
    .order("sigla", { ascending: true })
    .limit(500);
  if (lida.data.ativa) q = q.eq("ativa", lida.data.ativa === "true");

  const { data, error } = await q;
  if (error) return fail("internal_error", "Não foi possível ler as lojas.", 500, { requestId });

  return ok(data ?? [], { requestId });
}
