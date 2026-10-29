import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";
import { criarBancoFalso, type Linha, type OpcoesDoBancoFalso } from "../../../../../../tests/helpers/banco-falso-de-eventos";

import { GET } from "./route";

/**
 * GET /api/v1/pipelines/[id]/events — o cadastro de eventos do funil, com os sinais de uso.
 *
 * O banco é um dublê que APLICA os filtros (organização, funil por junção, chave do evento, janela de 7 dias) e a
 * ordenação: apagar um `.eq` da rota deixa um teste vermelho, em vez de passar por causa de uma linha fixa.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const FUNIL = "44444444-4444-4444-8444-444444444444";
const OUTRO_FUNIL = "55555555-5555-4555-8555-555555555555";

const agora = Date.now();
const iso = (diasAtras: number) => new Date(agora - diasAtras * 86_400_000).toISOString();

const ctx = { params: Promise.resolve({ id: FUNIL }) };
const req = () => new NextRequest(`http://localhost/api/v1/pipelines/${FUNIL}/events`);

function cadastro(key: string, extra: Linha = {}): Linha {
  return {
    id: `id-${key}`, organization_id: ORG, pipeline_id: FUNIL, key, label: key, description: null, stage_id: null,
    respects_manual_move: true, state_key: null, value_path: null, value_unit: null, dedupe_path: null, is_active: true,
    created_at: iso(10), updated_at: iso(10), ...extra,
  };
}
const atividade = (event: string, diasAtras: number, extra: Linha = {}): Linha => ({
  organization_id: ORG, type: "external_event", performed_at: iso(diasAtras), payload: { event }, lead: { pipeline_id: FUNIL }, ...extra,
});

function tabelas() {
  return {
    crm_pipelines: [{ id: FUNIL, organization_id: ORG }, { id: OUTRO_FUNIL, organization_id: ORG }] as Linha[],
    // DE PROPÓSITO fora de ordem: o `.order("key")` da rota é o que as põe em ordem.
    crm_pipeline_events: [cadastro("purchase"), cadastro("cart_sync"), cadastro("page_view")] as Linha[],
    crm_lead_activities: [] as Linha[],
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
  autorizar();
});

async function chamar(t: ReturnType<typeof tabelas>, erroEm?: OpcoesDoBancoFalso["erroEm"]) {
  vi.mocked(createClient).mockResolvedValue(criarBancoFalso(t as never, { erroEm }).client);
  const r = await GET(req(), ctx);
  return { r, corpo: await r.json() };
}

describe("GET /pipelines/[id]/events", () => {
  it("lista os eventos do funil em ordem de chave, com todos os campos do cadastro", async () => {
    const { r, corpo } = await chamar(tabelas());
    expect(r.status).toBe(200);
    expect(corpo.data.eventos.map((e: { key: string }) => e.key)).toEqual(["cart_sync", "page_view", "purchase"]);
    expect(corpo.data.eventos[0]).toMatchObject({
      key: "cart_sync", label: "cart_sync", stage_id: null, respects_manual_move: true, state_key: null,
      value_path: null, value_unit: null, dedupe_path: null, is_active: true,
    });
  });

  it("evento sem nenhum recebimento: ultimo_recebimento nulo e zero na semana", async () => {
    const { corpo } = await chamar(tabelas());
    expect(corpo.data.eventos.every((e: Linha) => e.ultimo_recebimento === null && e.recebidos_7_dias === 0)).toBe(true);
  });

  it("⭐ sinais de uso: o último recebimento é o mais recente e a contagem é só dos últimos 7 dias", async () => {
    const t = tabelas();
    t.crm_lead_activities.push(atividade("page_view", 1), atividade("page_view", 3), atividade("page_view", 6), atividade("page_view", 20), atividade("cart_sync", 40));
    const { corpo } = await chamar(t);
    const por = (k: string) => corpo.data.eventos.find((e: Linha) => e.key === k);
    expect(por("page_view")).toMatchObject({ recebidos_7_dias: 3 });
    expect(Date.parse(por("page_view").ultimo_recebimento)).toBeCloseTo(agora - 86_400_000, -4);
    // Só chegou há 40 dias: nunca foi "zero" para a tela, mas a semana é zero.
    expect(por("cart_sync")).toMatchObject({ recebidos_7_dias: 0 });
    expect(Date.parse(por("cart_sync").ultimo_recebimento)).toBeCloseTo(agora - 40 * 86_400_000, -4);
  });

  it("⭐ a atividade de OUTRO funil, de OUTRA organização ou de OUTRA chave não conta como uso", async () => {
    const t = tabelas();
    t.crm_lead_activities.push(
      atividade("page_view", 1, { lead: { pipeline_id: OUTRO_FUNIL } }),
      atividade("page_view", 1, { organization_id: OUTRA_ORG }),
      atividade("view_item", 1),
      atividade("page_view", 1, { type: "lead_edited" }),
    );
    const { corpo } = await chamar(t);
    const pv = corpo.data.eventos.find((e: Linha) => e.key === "page_view");
    expect(pv).toMatchObject({ ultimo_recebimento: null, recebidos_7_dias: 0 });
  });

  it("⭐ o cadastro de OUTRA organização ou de OUTRO funil não aparece", async () => {
    const t = tabelas();
    t.crm_pipeline_events.push(cadastro("intruso_org", { organization_id: OUTRA_ORG }), cadastro("intruso_funil", { pipeline_id: OUTRO_FUNIL }));
    const { corpo } = await chamar(t);
    const chaves = corpo.data.eventos.map((e: Linha) => e.key);
    expect(chaves).not.toContain("intruso_org");
    expect(chaves).not.toContain("intruso_funil");
  });

  it("⭐ funil de OUTRA organização: 404, o mesmo de um funil inexistente", async () => {
    const t = tabelas();
    t.crm_pipelines = [{ id: FUNIL, organization_id: OUTRA_ORG }];
    const { r, corpo } = await chamar(t);
    expect(r.status).toBe(404);
    expect(corpo.error.code).toBe("not_found");
  });

  it("papel insuficiente: devolve a recusa do requireRole e não toca o banco", async () => {
    autorizar(false);
    const t = tabelas();
    const banco = criarBancoFalso(t as never);
    vi.mocked(createClient).mockResolvedValue(banco.client);
    const r = await GET(req(), ctx);
    expect(r.status).toBe(403);
    expect(banco.chamadas).toHaveLength(0);
    expect(vi.mocked(requireRole)).toHaveBeenCalledWith("manager", expect.objectContaining({ resource: "pipeline_events" }));
  });

  it("falha do banco: 500, sem vazar", async () => {
    const { r, corpo } = await chamar(tabelas(), (tabela) => (tabela === "crm_pipeline_events" ? { message: "queda" } : null));
    expect(r.status).toBe(500);
    expect(corpo.error.code).toBe("internal_error");
  });
});
