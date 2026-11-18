/**
 * Vínculo do cliente do ERP com o contato do CRM, por ação do atendente (ADR-007).
 *
 *   POST  /api/v1/pdv/clientes/{erp_id}/vinculo   "Vincular ao CRM": liga pelo TELEFONE, criando o
 *                                                  contato se não houver.
 *   PATCH /api/v1/pdv/clientes/{erp_id}/vinculo   "Atualizar dados": o ERP sobrescreve nome, e-mail,
 *                                                  CPF e nascimento do contato vinculado. O telefone
 *                                                  nunca muda.
 *
 * Papel mínimo `agent`. Módulo desligado = 404. `requireSupportWrite(` antes do efeito. Os dados
 * saem do ERP, nunca do corpo: a rota não lê corpo. A organização vem da sessão. As duas
 * operações são idempotentes por natureza (o POST repetido devolve o mesmo vínculo; o PATCH
 * repetido grava os mesmos valores), então não exigem `Idempotency-Key`. Cada efeito audita uma
 * linha, sem dado pessoal. Erros de domínio: 409 `contato_ambiguo` | `telefone_de_outro_cliente` |
 * `sem_vinculo`; 422 `cliente_sem_telefone`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { recusaSeModuloDesligado, respostaDoErroDoErp } from "@/lib/pdv/api";
import {
  atualizarContatoDoErp,
  ContatoEspelhoError,
  vincularClienteDoErp,
} from "@/lib/pdv/contato-espelho";
import { obterCliente } from "@/lib/pdv/erp/cliente";
import { ErpPdvError } from "@/lib/pdv/erp/resposta";

export const dynamic = "force-dynamic";

const TETO_POR_USUARIO = 30;
const JANELA_SEGUNDOS = 60;
const IdSchema = z.string().trim().min(1).max(100);

type Operacao = "vincular" | "atualizar";

type Guarda = (organizationId: string) => Promise<Response | null>;

async function executar(
  operacao: Operacao,
  ctx: { params: Promise<{ erp_id: string }> },
  guarda: Guarda,
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "pdv_cliente" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const desligado = await recusaSeModuloDesligado(requestId);
  if (desligado) return desligado;

  const limite = await checkRateLimit(
    `pdv-cliente-vinculo:${user.id}`,
    TETO_POR_USUARIO,
    JANELA_SEGUNDOS,
  );
  if (!limite.allowed) {
    return fail("rate_limited", "Muitas ações seguidas. Tente em instantes.", 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const id = IdSchema.safeParse((await ctx.params).erp_id);
  if (!id.success) {
    return fail("validation_failed", "Identificador do cliente inválido.", 422, { requestId });
  }

  try {
    const cliente = await obterCliente(org.orgId, id.data, { camposSensiveis: true });

    const bloqueio = await guarda(org.orgId);
    if (bloqueio) return bloqueio;

    if (operacao === "vincular") {
      const r = await vincularClienteDoErp(org.orgId, cliente);
      // Só audita o que mudou: repetir o clique em quem já está vinculado não é efeito.
      if (r.vinculoNovo) {
        void audit({
          action: "pdv.customer.linked",
          actorUserId: user.id,
          organizationId: org.orgId,
          resourceType: "contact",
          resourceId: r.contactId,
          requestId,
          metadata: { erp_customer_id: cliente.id, contato_criado: r.contatoCriado },
        });
      }
      return ok(
        {
          contact_id: r.contactId,
          contato_criado: r.contatoCriado,
          vinculo_novo: r.vinculoNovo,
          sem_cpf_email: r.semCpfEmail,
        },
        { requestId, status: r.vinculoNovo ? 201 : 200 },
      );
    }

    const r = await atualizarContatoDoErp(org.orgId, cliente);
    void audit({
      action: "pdv.customer.updated",
      actorUserId: user.id,
      organizationId: org.orgId,
      resourceType: "contact",
      resourceId: r.contactId,
      requestId,
      metadata: { erp_customer_id: cliente.id },
    });
    return ok({ contact_id: r.contactId, sem_cpf_email: r.semCpfEmail }, { requestId });
  } catch (err) {
    if (err instanceof ErpPdvError && err.codigo === "nao_encontrado") {
      return fail("not_found", "Cliente não encontrado no ERP.", 404, { requestId });
    }
    if (err instanceof ContatoEspelhoError) {
      switch (err.codigo) {
        case "contato_ambiguo":
        case "telefone_de_outro_cliente":
        case "sem_vinculo":
          return fail(err.codigo, err.message, 409, { requestId });
        case "cliente_sem_telefone":
          return fail(err.codigo, err.message, 422, { requestId });
        default:
          return fail("internal_error", err.message, 500, { requestId });
      }
    }
    return respostaDoErroDoErp(err, requestId);
  }
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ erp_id: string }> },
): Promise<Response> {
  return executar("vincular", ctx, (orgId) => requireSupportWrite(orgId));
}

export async function PATCH(
  _req: NextRequest,
  ctx: { params: Promise<{ erp_id: string }> },
): Promise<Response> {
  return executar("atualizar", ctx, (orgId) => requireSupportWrite(orgId));
}
