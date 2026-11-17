// Peças comuns das rotas /api/v1/pdv: o portão do módulo e a tradução do erro do ERP.
import type { NextResponse } from "next/server";

import { fail, type ApiError } from "@/lib/api/wrappers";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

import { ErpPdvError } from "./erp/resposta";

/** Módulo desligado = 404, como se a rota não existisse. Erro de leitura também fecha. */
export async function recusaSeModuloDesligado(
  requestId: string,
): Promise<NextResponse<ApiError> | null> {
  if (await moduloLigado(createAdminClient(), "pdv")) return null;
  return fail("not_found", "Recurso não encontrado.", 404, { requestId });
}

/** Erro do ERP → resposta estável. Mensagens vêm fixas da camada `lib/pdv/erp` (sem endereço). */
export function respostaDoErroDoErp(err: unknown, requestId: string): NextResponse<ApiError> {
  if (!(err instanceof ErpPdvError)) {
    return fail("internal_error", "Erro interno.", 500, { requestId });
  }
  switch (err.codigo) {
    case "termo_invalido":
      return fail("validation_failed", err.message, 422, { requestId });
    case "erp_nao_configurado":
      return fail("erp_nao_configurado", err.message, 409, { requestId });
    case "tempo_esgotado":
      return fail("erp_indisponivel", err.message, 504, { requestId, details: { motivo: err.codigo } });
    default:
      return fail("erp_indisponivel", err.message, 502, { requestId, details: { motivo: err.codigo } });
  }
}
