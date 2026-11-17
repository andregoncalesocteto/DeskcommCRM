/**
 * /api/v1/pdv/lojas — as lojas que o tenant atende (módulo PDV, `pdv_stores`).
 *
 * GET (papel mínimo `agent`) lista. POST (`manager`) adiciona lojas do ERP: o corpo traz só
 * código e sigla; `erp_store_code`, `sigla` e `nome` gravados vêm do ERP, nunca do corpo.
 * O tenant sai da sessão; o filtro por `organization_id` é explícito além da RLS. Módulo
 * desligado = 404.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { recusaSeModuloDesligado, respostaDoErroDoErp } from "@/lib/pdv/api";
import { listarLojas } from "@/lib/pdv/erp/cliente";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS = "id, erp_store_code, sigla, nome, ativa, channel_session_id, created_at, updated_at";
/** Tag do endpoint no recibo de idempotência. */
const ENDPOINT = "/api/v1/pdv/lojas";

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
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("sigla", { ascending: true })
    .limit(500);
  if (lida.data.ativa) q = q.eq("ativa", lida.data.ativa === "true");

  const { data, error } = await q;
  if (error) return fail("internal_error", "Não foi possível ler as lojas.", 500, { requestId });

  return ok(data ?? [], { requestId });
}

const adicionarSchema = z.object({
  lojas: z
    .array(z.object({ codigo: z.string().trim().min(1).max(40), sigla: z.string().trim().min(1).max(20) }))
    .min(1)
    .max(50),
});

type LojaGravada = {
  id: string;
  erp_store_code: string;
  sigla: string;
  nome: string;
  ativa: boolean;
  channel_session_id: string | null;
};
type Resultado = { adicionadas: LojaGravada[]; ja_existiam: LojaGravada[] };
class RecusaDaAdicao extends Error {
  constructor(readonly resposta: Response) {
    super("recusa");
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pdv_stores" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const desligado = await recusaSeModuloDesligado(requestId);
  if (desligado) return desligado;

  const corpo = adicionarSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: corpo.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.string().uuid().safeParse(chave).success) {
    return fail("validation_error", "Idempotency-Key deve ser UUID", 400, { requestId });
  }

  const supabase = await createClient();

  /** O efeito. Lança em falha, para o helper não gravar recibo de operação que falhou. */
  async function adicionar(): Promise<Resultado> {
    let doErp;
    try {
      doErp = await listarLojas(org.orgId);
    } catch (err) {
      throw new RecusaDaAdicao(respostaDoErroDoErp(err, requestId));
    }
    // Nome e sigla gravados saem do ERP; o corpo só escolhe QUAIS lojas.
    const pedidas = new Map(corpo.data!.lojas.map((l) => [l.codigo, l.sigla]));
    const achadas = doErp.filter((l) => pedidas.has(l.codigo) && l.sigla === pedidas.get(l.codigo));
    const faltam = [...pedidas.keys()].filter((c) => !achadas.some((l) => l.codigo === c));
    if (faltam.length) {
      throw new RecusaDaAdicao(
        fail("validation_failed", "Há lojas que o ERP não tem com esse código e sigla.", 422, {
          requestId,
          details: { codigos_nao_encontrados: faltam },
        }),
      );
    }

    const lerExistentes = async (): Promise<LojaGravada[]> => {
      const { data, error } = await supabase
        .from("pdv_stores")
        .select(COLUNAS)
        .eq("organization_id", org.orgId);
      if (error) throw new Error("Erro ao ler lojas.");
      return (data ?? []) as LojaGravada[];
    };
    const jaExistem = (existentes: LojaGravada[], l: { codigo: string; sigla: string }) =>
      existentes.find((e) => e.sigla === l.sigla || e.erp_store_code === l.codigo);

    const existentes = await lerExistentes();
    const ja_existiam: LojaGravada[] = [];
    const adicionadas: LojaGravada[] = [];
    for (const l of achadas) {
      const igual = jaExistem(existentes, l);
      if (igual) {
        ja_existiam.push(igual);
        continue;
      }
      const { data, error } = await supabase
        .from("pdv_stores")
        .insert({ organization_id: org.orgId, erp_store_code: l.codigo, sigla: l.sigla, nome: l.nome })
        .select(COLUNAS)
        .single();
      if (error?.code === "23505") {
        // Corrida: outra requisição gravou a mesma loja entre a leitura e o insert.
        const igualAgora = jaExistem(await lerExistentes(), l);
        if (!igualAgora) throw new Error("Erro ao adicionar loja.");
        ja_existiam.push(igualAgora);
        continue;
      }
      if (error || !data) throw new Error("Erro ao adicionar loja.");
      adicionadas.push(data as LojaGravada);
    }

    if (adicionadas.length) {
      void audit({
        action: "pdv.store.updated",
        actorUserId: user.id,
        organizationId: org.orgId,
        resourceType: "pdv_store",
        resourceId: adicionadas[0]!.id,
        requestId,
        metadata: {
          operacao: "adicionar",
          lojas: adicionadas.map((a) => ({ id: a.id, sigla: a.sigla, erp_store_code: a.erp_store_code })),
        },
      });
    }
    return { adicionadas, ja_existiam };
  }

  const status = (r: Resultado) => (r.adicionadas.length ? 201 : 200);

  try {
    if (chave === null) {
      const r = await adicionar();
      return ok(r, { requestId, status: status(r) });
    }
    const desfecho = await comIdempotencia({
      db: supabase,
      organizationId: org.orgId,
      endpoint: ENDPOINT,
      chave,
      corpo: corpo.data,
      executar: async () => {
        const r = await adicionar();
        return { resposta: r, status: status(r) };
      },
    });
    if (desfecho.tipo === "conflito") {
      return fail("idempotency_conflict", "Esta chave de idempotência já foi usada com outro conteúdo.", 409, {
        requestId,
      });
    }
    if (desfecho.tipo === "em_curso") {
      return fail(
        "idempotency_in_progress",
        "A mesma requisição ainda está em curso. Tente de novo em instantes.",
        409,
        { requestId },
      );
    }
    return ok(desfecho.resposta, { requestId, status: desfecho.status === 201 ? 201 : 200 });
  } catch (err) {
    if (err instanceof RecusaDaAdicao) return err.resposta;
    return fail("internal_error", "Não foi possível adicionar as lojas.", 500, { requestId });
  }
}
