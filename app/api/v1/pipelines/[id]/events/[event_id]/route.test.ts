import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";
import { criarBancoFalso, type Linha, type OpcoesDoBancoFalso } from "../../../../../../../tests/helpers/banco-falso-de-eventos";

import { DELETE, PATCH } from "./route";

/**
 * PATCH/DELETE /api/v1/pipelines/[id]/events/[event_id] — editar e desativar um evento do funil.
 *
 * O banco é um dublê que APLICA os filtros: apagar o `.eq("organization_id")` ou o do funil do UPDATE deixa um teste
 * vermelho. As validações contra o funil só valem para o que MUDOU, e a chave é imutável depois do primeiro registro.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const FUNIL = "44444444-4444-4444-8444-444444444444";
const OUTRO_FUNIL = "55555555-5555-4555-8555-555555555555";
const EV = "77777777-7777-4777-8777-777777777701";
const EV_2 = "77777777-7777-4777-8777-777777777702";
const ETAPA_OK = "66666666-6666-4666-8666-666666666601";
const ETAPA_ARQUIVADA = "66666666-6666-4666-8666-666666666602";
const ETAPA_PERDA = "66666666-6666-4666-8666-666666666603";

const ctx = (event_id = EV, id = FUNIL) => ({ params: Promise.resolve({ id, event_id }) });
const patchReq = (corpo: unknown) =>
  new NextRequest(`http://localhost/api/v1/pipelines/${FUNIL}/events/${EV}`, {
    method: "PATCH",
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
const deleteReq = () => new NextRequest(`http://localhost/api/v1/pipelines/${FUNIL}/events/${EV}`, { method: "DELETE" });

function evento(id: string, key: string, extra: Linha = {}): Linha {
  return {
    id, organization_id: ORG, pipeline_id: FUNIL, key, label: key, description: null, stage_id: null, respects_manual_move: true,
    state_key: null, value_path: null, value_unit: null, dedupe_path: null, is_active: true, created_at: "2026-10-29T10:00:00Z", updated_at: "2026-10-29T10:00:00Z",
    ...extra,
  };
}

function tabelas(extra: { eventos?: Linha[]; atividades?: Linha[] } = {}) {
  return {
    crm_pipelines: [{ id: FUNIL, organization_id: ORG, settings: { fields: [{ key: "forma_pagamento" }] } }] as Linha[],
    crm_stages: [
      { id: ETAPA_OK, name: "Compras", organization_id: ORG, pipeline_id: FUNIL, is_archived: false, is_lost: false },
      { id: ETAPA_ARQUIVADA, name: "Velha", organization_id: ORG, pipeline_id: FUNIL, is_archived: true, is_lost: false },
      { id: ETAPA_PERDA, name: "Cancelado", organization_id: ORG, pipeline_id: FUNIL, is_archived: false, is_lost: true },
    ] as Linha[],
    crm_pipeline_events: (extra.eventos ?? [evento(EV, "purchase", { label: "Compra" })]) as Linha[],
    crm_lead_activities: (extra.atividades ?? []) as Linha[],
  };
}

function autorizar(ok = true) {
  if (!ok) {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: fail("forbidden", "Sem permissão.", 403, { requestId: "x" }) } as never);
    return;
  }
  const user: AuthUser = {
    id: USER, email: "a@example.com", full_name: null, avatar_url: null, is_platform_admin: false, idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG, organization_name: "Org", role: "manager" }],
  };
  vi.mocked(requireRole).mockResolvedValue({ ok: true, user, org: { orgId: ORG, name: "Org", role: "manager" } });
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(createClient).mockReset();
  vi.mocked(audit).mockClear();
  vi.mocked(requireSupportWrite).mockReset();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  autorizar();
});

async function editar(corpo: unknown, t = tabelas(), opcoes: { id?: string; erroEm?: OpcoesDoBancoFalso["erroEm"] } = {}) {
  const banco = criarBancoFalso(t as never, { erroEm: opcoes.erroEm });
  vi.mocked(createClient).mockResolvedValue(banco.client);
  const r = await PATCH(patchReq(corpo), ctx(opcoes.id));
  return { r, corpo: await r.json(), banco, t };
}
async function desativar(t = tabelas(), opcoes: { id?: string; erroEm?: OpcoesDoBancoFalso["erroEm"] } = {}) {
  const banco = criarBancoFalso(t as never, { erroEm: opcoes.erroEm });
  vi.mocked(createClient).mockResolvedValue(banco.client);
  const r = await DELETE(deleteReq(), ctx(opcoes.id));
  return { r, corpo: await r.json(), banco, t };
}
const updates = (banco: ReturnType<typeof criarBancoFalso>) => banco.chamadas.filter((c) => c.operacao === "update");

describe("PATCH: editar", () => {
  it("altera a etapa de destino: o UPDATE leva SÓ o que mudou e a auditoria registra de/para", async () => {
    const { r, corpo, banco } = await editar({ stage_id: ETAPA_OK });
    expect(r.status).toBe(200);
    expect(corpo.data.evento).toMatchObject({ id: EV, key: "purchase", stage_id: ETAPA_OK });
    expect(updates(banco)).toHaveLength(1);
    expect(updates(banco)[0]!.valores).toEqual({ stage_id: ETAPA_OK });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "pipeline_event.updated", actorUserId: USER, organizationId: ORG, resourceId: EV,
      metadata: expect.objectContaining({ pipeline_id: FUNIL, key: "purchase", campos: ["stage_id"], stage_id: { de: null, para: ETAPA_OK } }),
    }));
  });

  it("⭐ o UPDATE é filtrado pela organização da SESSÃO, pelo funil do caminho e pelo id", async () => {
    const { banco } = await editar({ label: "Compra concluída" });
    const filtros = updates(banco)[0]!.filtros;
    expect(filtros).toEqual(expect.arrayContaining([["organization_id", ORG], ["pipeline_id", FUNIL], ["id", EV]]));
  });

  it("reenviar o mesmo valor não é mudança: 200, sem UPDATE e sem auditoria", async () => {
    const { r, banco } = await editar({ label: "Compra", is_active: true });
    expect(r.status).toBe(200);
    expect(updates(banco)).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("null limpa o campo (a etapa de destino, por exemplo)", async () => {
    const t = tabelas({ eventos: [evento(EV, "purchase", { stage_id: ETAPA_OK })] });
    const { r, corpo } = await editar({ stage_id: null }, t);
    expect(r.status).toBe(200);
    expect(corpo.data.evento.stage_id).toBeNull();
  });

  it("desativar pela edição também vale (is_active: false), e fica auditado como edição", async () => {
    const { r, corpo } = await editar({ is_active: false });
    expect(r.status).toBe(200);
    expect(corpo.data.evento.is_active).toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "pipeline_event.updated", metadata: expect.objectContaining({ campos: ["is_active"] }) }));
  });
});

describe("PATCH: a chave é imutável depois do primeiro registro", () => {
  it("⭐ evento que já recebeu registros: mudar a chave é 409, e nada é gravado", async () => {
    const t = tabelas({
      atividades: [{ organization_id: ORG, type: "external_event", performed_at: "2026-10-29T10:00:00Z", payload: { event: "purchase" }, lead: { pipeline_id: FUNIL } }],
    });
    const { r, corpo, banco } = await editar({ key: "compra" }, t);
    expect(r.status).toBe(409);
    expect(corpo.error.message).toContain("já recebeu registros");
    expect(updates(banco)).toHaveLength(0);
  });

  it("evento que nunca recebeu nada: a chave pode mudar", async () => {
    const { r, corpo } = await editar({ key: "compra" });
    expect(r.status).toBe(200);
    expect(corpo.data.evento.key).toBe("compra");
  });

  it("o registro de OUTRO funil (mesma chave) não trava a mudança neste funil", async () => {
    const t = tabelas({
      atividades: [{ organization_id: ORG, type: "external_event", performed_at: "2026-10-29T10:00:00Z", payload: { event: "purchase" }, lead: { pipeline_id: OUTRO_FUNIL } }],
    });
    const { r } = await editar({ key: "compra" }, t);
    expect(r.status).toBe(200);
  });

  it("mandar a MESMA chave não é mudança, mesmo com registros", async () => {
    const t = tabelas({
      atividades: [{ organization_id: ORG, type: "external_event", performed_at: "2026-10-29T10:00:00Z", payload: { event: "purchase" }, lead: { pipeline_id: FUNIL } }],
    });
    const { r } = await editar({ key: "purchase", label: "Compra nova" }, t);
    expect(r.status).toBe(200);
  });

  it("chave nova que já existe no funil (índice único): 409", async () => {
    const { r, corpo } = await editar({ key: "outro" }, tabelas({ eventos: [evento(EV, "purchase"), evento(EV_2, "outro")] }), {
      erroEm: (tabela, operacao) => (tabela === "crm_pipeline_events" && operacao === "update" ? { code: "23505", message: "dup" } : null),
    });
    expect(r.status).toBe(409);
    expect(corpo.error.message).toContain("«outro»");
  });
});

describe("PATCH: as validações valem para o que MUDOU", () => {
  it("⭐ editar só o nome de um evento cuja etapa foi arquivada depois NÃO quebra", async () => {
    const t = tabelas({ eventos: [evento(EV, "purchase", { stage_id: ETAPA_ARQUIVADA })] });
    const { r } = await editar({ label: "Novo nome" }, t);
    expect(r.status).toBe(200);
  });

  it.each([
    ["etapa arquivada", ETAPA_ARQUIVADA, "arquivada"],
    ["etapa de perda", ETAPA_PERDA, "é de perda"],
    ["etapa inexistente", "66666666-6666-4666-8666-6666666666ff", "não é deste funil"],
  ])("trocar para %s: 422", async (_nome, etapa, trecho) => {
    const { r, corpo, banco } = await editar({ stage_id: etapa });
    expect(r.status).toBe(422);
    expect(corpo.error.message).toContain(trecho);
    expect(updates(banco)).toHaveLength(0);
  });

  it("'guardar em' igual a campo declarado da ficha: 422", async () => {
    const { r } = await editar({ state_key: "forma_pagamento" });
    expect(r.status).toBe(422);
  });

  it("'guardar em' já usado por OUTRO evento: salva e avisa; o próprio evento não conta como outro", async () => {
    const t = tabelas({ eventos: [evento(EV, "purchase", { state_key: "pedido" }), evento(EV_2, "begin_checkout", { label: "Revisão", state_key: "checkout" })] });
    const { r, corpo } = await editar({ state_key: "checkout" }, t);
    expect(r.status).toBe(200);
    expect(corpo.data.avisos).toHaveLength(1);
    expect(corpo.data.avisos[0]).toContain("«Revisão»");
    // Reenviar o próprio "guardar em" (sem mudança) não avisa de si mesmo.
    const t2 = tabelas({ eventos: [evento(EV, "purchase", { state_key: "pedido" })] });
    const igual = await editar({ state_key: "pedido", label: "Compra" }, t2);
    expect(igual.corpo.data.avisos).toEqual([]);
  });

  it("⭐ o par do valor vale para o RESULTADO: só a unidade, num evento sem caminho, é 422", async () => {
    expect((await editar({ value_unit: "reais" })).r.status).toBe(422);
    expect((await editar({ value_path: "value", value_unit: "reais" })).r.status).toBe(200);
  });

  it("limpar só o caminho do valor (a unidade fica) é 422; limpar os dois é aceito", async () => {
    const t = () => tabelas({ eventos: [evento(EV, "purchase", { value_path: "value", value_unit: "reais" })] });
    expect((await editar({ value_path: null }, t())).r.status).toBe(422);
    expect((await editar({ value_path: null, value_unit: null }, t())).r.status).toBe(200);
  });
});

describe("PATCH: o corpo, a autoria e os recortes", () => {
  it.each([
    ["corpo vazio", {}],
    ["organization_id no corpo", { organization_id: OUTRA_ORG }],
    ["pipeline_id no corpo", { pipeline_id: OUTRO_FUNIL }],
    ["campo desconhecido", { extra: 1 }],
    ["chave com maiúscula", { key: "Compra" }],
    ["corpo que não é JSON", "não é json"],
  ])("recusa %s (422)", async (_nome, corpoRuim) => {
    const { r, banco } = await editar(corpoRuim);
    expect(r.status).toBe(422);
    expect(updates(banco)).toHaveLength(0);
  });

  it("evento de OUTRO funil, de OUTRA organização ou inexistente: 404", async () => {
    for (const eventos of [
      [evento(EV, "purchase", { pipeline_id: OUTRO_FUNIL })],
      [evento(EV, "purchase", { organization_id: OUTRA_ORG })],
      [],
    ]) {
      const { r, banco } = await editar({ label: "x" }, tabelas({ eventos }));
      expect(r.status).toBe(404);
      expect(updates(banco)).toHaveLength(0);
    }
  });

  it("id que não é UUID: 404 sem tocar o banco", async () => {
    const { r, banco } = await editar({ label: "x" }, tabelas(), { id: "nao-e-uuid" });
    expect(r.status).toBe(404);
    expect(banco.chamadas).toHaveLength(0);
  });

  it("suporte temporário sem escrita: recusa antes de qualquer efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "Somente leitura.", 403, { requestId: "x" }) as never);
    const { r, banco } = await editar({ label: "x" });
    expect(r.status).toBe(403);
    expect(banco.chamadas).toHaveLength(0);
  });

  it("papel insuficiente: a recusa do requireRole, sem tocar o banco", async () => {
    autorizar(false);
    const { r, banco } = await editar({ label: "x" });
    expect(r.status).toBe(403);
    expect(banco.chamadas).toHaveLength(0);
  });

  it("falha do banco no UPDATE: 500 e sem auditoria", async () => {
    const { r } = await editar({ label: "x" }, tabelas(), {
      erroEm: (tabela, operacao) => (tabela === "crm_pipeline_events" && operacao === "update" ? { message: "queda" } : null),
    });
    expect(r.status).toBe(500);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("DELETE: desativar (lógico)", () => {
  it("⭐ desativa, não apaga: UPDATE de is_active, nenhum DELETE, e audita pipeline_event.deactivated", async () => {
    const { r, corpo, banco, t } = await desativar();
    expect(r.status).toBe(200);
    expect(corpo.data.evento).toMatchObject({ id: EV, is_active: false });
    expect(updates(banco)[0]!.valores).toEqual({ is_active: false });
    expect(banco.chamadas.filter((c) => c.operacao === "delete")).toHaveLength(0);
    expect(t.crm_pipeline_events).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "pipeline_event.deactivated", resourceId: EV, metadata: expect.objectContaining({ pipeline_id: FUNIL, key: "purchase" }),
    }));
  });

  it("o UPDATE é filtrado pela organização da SESSÃO, pelo funil e pelo id", async () => {
    const { banco } = await desativar();
    expect(updates(banco)[0]!.filtros).toEqual(expect.arrayContaining([["organization_id", ORG], ["pipeline_id", FUNIL], ["id", EV]]));
  });

  it("já desativado: 200, no-op (sem UPDATE e sem auditoria)", async () => {
    const t = tabelas({ eventos: [evento(EV, "purchase", { is_active: false })] });
    const { r, banco } = await desativar(t);
    expect(r.status).toBe(200);
    expect(updates(banco)).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("evento de OUTRO funil, OUTRA organização ou id inválido: 404", async () => {
    expect((await desativar(tabelas({ eventos: [evento(EV, "p", { organization_id: OUTRA_ORG })] }))).r.status).toBe(404);
    expect((await desativar(tabelas({ eventos: [evento(EV, "p", { pipeline_id: OUTRO_FUNIL })] }))).r.status).toBe(404);
    expect((await desativar(tabelas(), { id: "nao-e-uuid" })).r.status).toBe(404);
  });

  it("suporte sem escrita e papel insuficiente: recusam antes de qualquer efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "Somente leitura.", 403, { requestId: "x" }) as never);
    const a = await desativar();
    expect(a.r.status).toBe(403);
    expect(a.banco.chamadas).toHaveLength(0);
    vi.mocked(requireSupportWrite).mockResolvedValue(null);
    autorizar(false);
    const b = await desativar();
    expect(b.r.status).toBe(403);
    expect(b.banco.chamadas).toHaveLength(0);
  });

  it("falha do banco: 500 e sem auditoria", async () => {
    const { r } = await desativar(tabelas(), { erroEm: (tabela, operacao) => (tabela === "crm_pipeline_events" && operacao === "update" ? { message: "queda" } : null) });
    expect(r.status).toBe(500);
    expect(audit).not.toHaveBeenCalled();
  });
});
