/**
 * GET /api/v1/pdv/clientes/{erp_id} — ficha do cliente do ERP (cadastro mestre) para o balcão.
 *
 * Papel mínimo `agent`. Módulo desligado = 404. Lê o cliente com `campos_sensiveis: true` (CPF e
 * data de nascimento) e a SITUAÇÃO do vínculo com o contato do CRM (`vinculo`). É leitura pura:
 * abrir a ficha não cria contato nem vínculo (ADR-007). Quem liga é o botão da ficha, em
 * `POST /api/v1/pdv/clientes/{erp_id}/vinculo`.
 *
 * Erros: `nao_encontrado` do ERP = 404; ERP fora do ar = 502/504; sem servidor cadastrado = 409
 * `erp_nao_configurado`. CPF e data de nascimento só existem no corpo da resposta: nunca em log,
 * Sentry nem auditoria. Esta rota não audita: leitura não é mutação.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { recusaSeModuloDesligado, respostaDoErroDoErp } from "@/lib/pdv/api";
import { ContatoEspelhoError, consultarVinculo, type EstadoDoVinculo } from "@/lib/pdv/contato-espelho";
import { obterCliente } from "@/lib/pdv/erp/cliente";
import { ErpPdvError } from "@/lib/pdv/erp/resposta";

export const dynamic = "force-dynamic";

const TETO_POR_USUARIO = 60;
const JANELA_SEGUNDOS = 60;

/** O estado do vínculo na forma da API (snake_case); o nome do contato é dado do operador, não do ERP. */
function vinculoParaApi(v: EstadoDoVinculo) {
  switch (v.estado) {
    case "vinculado":
      return { estado: v.estado, contact_id: v.contactId, contato_nome: v.contatoNome };
    case "telefone_de_outro":
      return { estado: v.estado, contato_nome: v.contatoNome };
    default:
      return { estado: v.estado };
  }
}

const IdSchema = z.string().trim().min(1).max(100);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ erp_id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "pdv_cliente" });
  if (!authz.ok) return authz.response;

  const desligado = await recusaSeModuloDesligado(requestId);
  if (desligado) return desligado;

  const limite = await checkRateLimit(
    `pdv-cliente:${authz.user.id}`,
    TETO_POR_USUARIO,
    JANELA_SEGUNDOS,
  );
  if (!limite.allowed) {
    return fail("rate_limited", "Muitas consultas seguidas. Tente em instantes.", 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const id = IdSchema.safeParse((await ctx.params).erp_id);
  if (!id.success) {
    return fail("validation_failed", "Identificador do cliente inválido.", 422, { requestId });
  }

  try {
    const cliente = await obterCliente(authz.org.orgId, id.data, { camposSensiveis: true });
    const vinculo = await consultarVinculo(authz.org.orgId, cliente);

    return ok(
      {
        id: cliente.id,
        vinculo: vinculoParaApi(vinculo),
        nome: cliente.nome,
        telefone: cliente.telefone,
        email: cliente.email,
        cpf: cliente.cpf ?? null,
        data_nascimento: cliente.data_nascimento ?? null,
        // O ERP pode não marcar endereço principal: a API sempre devolve o booleano.
        enderecos: cliente.enderecos.map((e) => ({ ...e, principal: e.principal ?? false })),
      },
      { requestId },
    );
  } catch (err) {
    if (err instanceof ErpPdvError && err.codigo === "nao_encontrado") {
      return fail("not_found", "Cliente não encontrado no ERP.", 404, { requestId });
    }
    if (err instanceof ContatoEspelhoError) {
      return fail("internal_error", err.message, 500, { requestId });
    }
    return respostaDoErroDoErp(err, requestId);
  }
}
