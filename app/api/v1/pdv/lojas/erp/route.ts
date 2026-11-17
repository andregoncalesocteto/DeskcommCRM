/**
 * GET /api/v1/pdv/lojas/erp — as lojas do ERP do tenant, marcando as que ele já atende.
 *
 * Papel mínimo `manager` (escolher quais lojas o tenant atende é configuração). Módulo
 * desligado = 404; ERP não cadastrado = 409 `erp_nao_configurado`; ERP fora do ar = 502
 * `erp_indisponivel`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { listarLojas } from "@/lib/pdv/erp/cliente";
import { recusaSeModuloDesligado, respostaDoErroDoErp } from "@/lib/pdv/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pdv_stores" });
  if (!authz.ok) return authz.response;

  const desligado = await recusaSeModuloDesligado(requestId);
  if (desligado) return desligado;

  const organizationId = authz.org.orgId;

  let lojas;
  try {
    lojas = await listarLojas(organizationId);
  } catch (err) {
    return respostaDoErroDoErp(err, requestId);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pdv_stores")
    .select("erp_store_code")
    .eq("organization_id", organizationId);
  if (error) return fail("internal_error", "Não foi possível ler as lojas.", 500, { requestId });

  const ja = new Set((data ?? []).map((l: { erp_store_code: string }) => l.erp_store_code));
  return ok(
    lojas.map((l) => ({ ...l, ja_cadastrada: ja.has(l.codigo) })),
    { requestId },
  );
}
