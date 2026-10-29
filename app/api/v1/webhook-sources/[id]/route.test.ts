import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";
import { criarBancoFalso, type Linha } from "../../../../../tests/helpers/banco-falso-de-eventos";

import { PATCH } from "./route";

/**
 * PATCH /api/v1/webhook-sources/[id] — a configuração do VALOR e do JSON do pedido (etapa 3 de "Eventos do funil").
 * O banco é um dublê que APLICA os filtros (organização, id): apagar um `.eq` da rota deixa um teste vermelho.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const FONTE = "44444444-4444-4444-8444-444444444444";
const FONTE_ALHEIA = "55555555-5555-4555-8555-555555555555";
const FUNIL = "66666666-6666-4666-8666-666666666666";
const OUTRO_FUNIL = "77777777-7777-4777-8777-777777777777";

const patch = (corpo: unknown, id = FONTE) =>
  PATCH(
    new NextRequest(`http://localhost/api/v1/webhook-sources/${id}`, { method: "PATCH", body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ id }) },
  );

function tabelas() {
  return {
    webhook_sources: [
      {
        id: FONTE, organization_id: ORG, default_pipeline_id: FUNIL, authorize_ai_on_capture: false,
        update_existing_lead_on_capture: false, reuse_open_lead_on_capture: false, secret_encrypted: null,
        value_path: null, value_unit: null, payload_state_key: null,
      },
      { id: FONTE_ALHEIA, organization_id: OUTRA_ORG, default_pipeline_id: FUNIL },
    ] as Linha[],
    crm_pipelines: [
      { id: FUNIL, organization_id: ORG, settings: { fields: [{ key: "cupom" }, { key: "forma_pagamento" }] } },
      { id: OUTRO_FUNIL, organization_id: ORG, settings: { fields: [{ key: "pedido" }] } },
    ] as Linha[],
  };
}

function autorizar() {
  const user: AuthUser = {
    id: USER, email: "a@example.com", full_name: null, avatar_url: null, is_platform_admin: false, idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG, organization_name: "Org", role: "manager" }],
  };
  vi.mocked(requireRole).mockResolvedValue({ ok: true, user, org: { orgId: ORG, name: "Org", role: "manager" } });
}

let t: ReturnType<typeof tabelas>;
beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(createClient).mockReset();
  vi.mocked(requireSupportWrite).mockReset();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  autorizar();
  t = tabelas();
  vi.mocked(createClient).mockResolvedValue(criarBancoFalso(t as never).client);
});

const fonte = () => t.webhook_sources.find((l) => l.id === FONTE)!;

describe("PATCH webhook-sources — valor da venda", () => {
  it("grava caminho e unidade juntos", async () => {
    const r = await patch({ value_path: "pedido.total", value_unit: "reais" });
    expect(r.status).toBe(200);
    expect(fonte()).toMatchObject({ value_path: "pedido.total", value_unit: "reais" });
  });

  it("⭐ um sem o outro é recusado e nada é gravado", async () => {
    expect((await patch({ value_path: "value" })).status).toBe(400);
    expect((await patch({ value_unit: "reais" })).status).toBe(400);
    expect(fonte().value_path).toBeNull();
  });

  it("limpar os dois com null é aceito", async () => {
    fonte().value_path = "value";
    fonte().value_unit = "reais";
    expect((await patch({ value_path: null, value_unit: null })).status).toBe(200);
    expect(fonte()).toMatchObject({ value_path: null, value_unit: null });
  });
});

describe("PATCH webhook-sources — onde guardar o JSON do pedido", () => {
  it("grava a chave livre", async () => {
    const r = await patch({ payload_state_key: "pedido_json" });
    expect(r.status).toBe(200);
    expect(fonte().payload_state_key).toBe("pedido_json");
  });

  it("⭐ chave igual a um campo DECLARADO do funil da fonte é recusada (422) e nada é gravado", async () => {
    const r = await patch({ payload_state_key: "cupom" });
    expect(r.status).toBe(422);
    expect((await r.json()).error.message).toContain("«cupom»");
    expect(fonte().payload_state_key).toBeNull();
  });

  it("⭐ a conferência usa o funil NOVO quando o mesmo PATCH troca o funil da fonte", async () => {
    // «pedido» é campo declarado do OUTRO funil, não do atual: aceita no atual, recusa no novo.
    expect((await patch({ payload_state_key: "pedido" })).status).toBe(200);
    t = tabelas();
    vi.mocked(createClient).mockResolvedValue(criarBancoFalso(t as never).client);
    expect((await patch({ payload_state_key: "pedido", default_pipeline_id: OUTRO_FUNIL })).status).toBe(422);
    expect(fonte().payload_state_key).toBeNull();
  });

  it("formato inválido é recusado (maiúscula, hífen, começa por número)", async () => {
    for (const ruim of ["Pedido", "pedido-json", "1pedido", "a".repeat(65)]) {
      expect((await patch({ payload_state_key: ruim })).status, ruim).toBe(400);
    }
  });

  it("null limpa a chave", async () => {
    fonte().payload_state_key = "pedido_json";
    expect((await patch({ payload_state_key: null })).status).toBe(200);
    expect(fonte().payload_state_key).toBeNull();
  });

  it("fonte de outra organização: 404 e nada muda", async () => {
    const r = await patch({ payload_state_key: "pedido_json" }, FONTE_ALHEIA);
    expect(r.status).toBe(404);
    expect(t.webhook_sources.find((l) => l.id === FONTE_ALHEIA)!.payload_state_key).toBeUndefined();
  });

  it("a guarda de suporte vem antes do efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("support_read_only", "Somente leitura.", 403, { requestId: "x" }) as never);
    expect((await patch({ payload_state_key: "pedido_json" })).status).toBe(403);
    expect(fonte().payload_state_key).toBeNull();
  });
});
