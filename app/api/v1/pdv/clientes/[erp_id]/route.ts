/**
 * GET /api/v1/pdv/clientes/{erp_id} — ficha do cliente do ERP (cadastro mestre) para o balcão.
 *
 * Papel mínimo `agent`. Módulo desligado = 404. Lê o cliente com `campos_sensiveis: true` (CPF e
 * data de nascimento) e garante o vínculo do contato espelho (`pdv_customer_links`): é um efeito
 * de escrita dentro de um GET, por isso a guarda `requireSupportWrite(` vem antes dele. A
 * resposta devolve o `contact_id` para a tela abrir a conversa.
 *
 * Erros: `nao_encontrado` do ERP = 404; contato ambíguo = 409 `contato_ambiguo`; ERP fora do ar
 * = 502/504; sem servidor cadastrado = 409 `erp_nao_configurado`. CPF e data de nascimento só
 * existem no corpo da resposta: nunca em log, Sentry nem auditoria. Esta rota não audita: leitura
 * não é mutação (a criação do vínculo pelo serviço do espelho não grava `api_audit_log`).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { recusaSeModuloDesligado, respostaDoErroDoErp } from "@/lib/pdv/api";
import { ContatoEspelhoError, vincularClienteDoErp } from "@/lib/pdv/contato-espelho";
import { obterCliente } from "@/lib/pdv/erp/cliente";
import { ErpPdvError } from "@/lib/pdv/erp/resposta";

export const dynamic = "force-dynamic";

const TETO_POR_USUARIO = 60;
const JANELA_SEGUNDOS = 60;

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

    const bloqueio = await requireSupportWrite(authz.org.orgId);
    if (bloqueio) return bloqueio;
    const vinculo = await vincularClienteDoErp(authz.org.orgId, cliente);

    return ok(
      {
        id: cliente.id,
        contact_id: vinculo.contactId,
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
      if (err.codigo === "contato_ambiguo") {
        return fail("contato_ambiguo", err.message, 409, { requestId });
      }
      return fail("internal_error", err.message, 500, { requestId });
    }
    return respostaDoErroDoErp(err, requestId);
  }
}
