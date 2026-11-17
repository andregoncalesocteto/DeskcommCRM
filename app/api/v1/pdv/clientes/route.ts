/**
 * GET /api/v1/pdv/clientes?modo=telefone|nome|cpf&q= — busca de cliente no ERP (cadastro mestre).
 *
 * Papel mínimo `agent`. Módulo desligado = 404; termo recusado pelo ERP = 422 com a mensagem
 * do ERP; ERP fora do ar = 502/504 `erp_indisponivel`; sem servidor cadastrado = 409
 * `erp_nao_configurado`. A lista traz só id, nome e endereço principal: CPF, telefone e e-mail
 * ficam na ficha. O termo (que pode ser CPF ou telefone) nunca vai a log, Sentry nem auditoria:
 * esta rota não audita (é leitura) e não registra nada além do código do erro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { buscarCliente } from "@/lib/pdv/erp/cliente";
import { recusaSeModuloDesligado, respostaDoErroDoErp } from "@/lib/pdv/api";

export const dynamic = "force-dynamic";

const TETO_POR_USUARIO = 60;
const JANELA_SEGUNDOS = 60;

const ConsultaSchema = z.object({
  modo: z.enum(["telefone", "nome", "cpf"]),
  q: z.string().trim().min(1).max(100),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "pdv_clientes" });
  if (!authz.ok) return authz.response;

  const desligado = await recusaSeModuloDesligado(requestId);
  if (desligado) return desligado;

  const limite = await checkRateLimit(
    `pdv-clientes:${authz.user.id}`,
    TETO_POR_USUARIO,
    JANELA_SEGUNDOS,
  );
  if (!limite.allowed) {
    return fail("rate_limited", "Muitas buscas seguidas. Tente em instantes.", 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const params = req.nextUrl.searchParams;
  const parsed = ConsultaSchema.safeParse({ modo: params.get("modo"), q: params.get("q") });
  if (!parsed.success) {
    // Só os campos que falharam: o valor de `q` não volta na resposta.
    return fail("validation_failed", "Informe modo (telefone, nome ou cpf) e o termo da busca.", 422, {
      requestId,
      details: { campos: parsed.error.issues.map((i) => String(i.path[0] ?? "")) },
    });
  }

  try {
    const r = await buscarCliente(authz.org.orgId, parsed.data.modo, parsed.data.q);
    return ok(
      {
        clientes: r.clientes.map((c) => ({
          id: c.id,
          nome: c.nome,
          endereco_principal: c.endereco_principal,
        })),
        total_encontrado: r.total_encontrado,
        truncado: r.truncado,
      },
      { requestId },
    );
  } catch (err) {
    return respostaDoErroDoErp(err, requestId);
  }
}
