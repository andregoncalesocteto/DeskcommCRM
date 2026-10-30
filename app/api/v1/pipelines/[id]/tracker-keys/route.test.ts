import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";
import { criarBancoFalso, type Linha } from "../../../../../../tests/helpers/banco-falso-de-eventos";

import { DELETE, GET, POST } from "./route";

/**
 * GET/POST /api/v1/pipelines/[id]/tracker-keys — as chaves públicas do rastreador.
 * O banco é um dublê que APLICA os filtros: apagar um `.eq` da rota deixa um teste vermelho.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const FUNIL = "44444444-4444-4444-8444-444444444444";
const FUNIL_ALHEIO = "55555555-5555-4555-8555-555555555555";

const ctx = { params: Promise.resolve({ id: FUNIL }) };
const get = () => new NextRequest(`http://localhost/api/v1/pipelines/${FUNIL}/tracker-keys`);
const post = (corpo: unknown) =>
  new NextRequest(`http://localhost/api/v1/pipelines/${FUNIL}/tracker-keys`, {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });

const chave = (id: string, extra: Linha = {}): Linha => ({
  id, organization_id: ORG, pipeline_id: FUNIL, public_key: `pk_${id}`, label: id, allowed_origins: ["https://a.exemplo"],
  is_active: true, revoked_at: null, created_at: `2026-10-0${id.length}T10:00:00Z`, ...extra,
});

const agora = Date.now();
const iso = (diasAtras: number) => new Date(agora - diasAtras * 86_400_000).toISOString();
const atividade = (chaveId: string, diasAtras: number, extra: Linha = {}): Linha => ({
  organization_id: ORG, type: "external_event", performed_at: iso(diasAtras), payload: { event: "page_view", chave_id: chaveId },
  lead: { pipeline_id: FUNIL }, ...extra,
});

function tabelas() {
  return {
    crm_pipelines: [
      { id: FUNIL, organization_id: ORG },
      { id: FUNIL_ALHEIO, organization_id: OUTRA_ORG },
    ] as Linha[],
    crm_leads: [{ id: "lead-1", organization_id: ORG, pipeline_id: FUNIL }] as Linha[],
    crm_lead_activities: [
      atividade("a", 2), atividade("a", 3), atividade("a", 20), atividade("b", 1, { type: "lead_edited" }),
    ] as Linha[],
    crm_tracker_public_keys: [
      chave("a", { created_at: "2026-10-01T10:00:00Z" }),
      chave("b", { created_at: "2026-10-03T10:00:00Z" }),
      chave("c", { organization_id: OUTRA_ORG, pipeline_id: FUNIL_ALHEIO }),
    ] as Linha[],
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

function banco(t = tabelas()) {
  const b = criarBancoFalso(t as never);
  vi.mocked(createClient).mockResolvedValue(b.client);
  return { t, b };
}

describe("GET /pipelines/[id]/tracker-keys", () => {
  it("lista só as chaves deste funil e desta organização, da mais nova para a mais antiga", async () => {
    banco();
    const r = await GET(get(), ctx);
    expect(r.status).toBe(200);
    const { data } = await r.json();
    expect(data.chaves.map((c: { id: string }) => c.id)).toEqual(["b", "a"]);
  });

  it("⭐ cada chave traz o uso: último recebimento e quantos nos últimos 7 dias (só os dela, só do tipo evento externo)", async () => {
    // chave "a": 3 linhas (2, 3 e 20 dias atrás); chave "b": só uma linha de OUTRO tipo, que não conta.
    const t = tabelas();
    t.crm_tracker_public_keys[0]!.id = "a";
    t.crm_tracker_public_keys[1]!.id = "b";
    banco(t);
    const { data } = await (await GET(get(), ctx)).json();
    const porId = Object.fromEntries(data.chaves.map((c: Linha) => [c.id as string, c]));
    expect(porId.a.recebidos_7_dias).toBe(2);
    expect(Date.parse(porId.a.ultimo_recebimento)).toBe(Date.parse(iso(2)));
    expect(porId.b).toMatchObject({ ultimo_recebimento: null, recebidos_7_dias: 0 });
  });

  it("devolve a chave pública inteira (não é segredo)", async () => {
    banco();
    const { data } = await (await GET(get(), ctx)).json();
    expect(data.chaves[0].public_key).toBe("pk_b");
  });

  it("funil de outra organização responde 404, como um que não existe", async () => {
    banco();
    const r = await GET(get(), { params: Promise.resolve({ id: FUNIL_ALHEIO }) });
    expect(r.status).toBe(404);
    const inexistente = await GET(get(), { params: Promise.resolve({ id: "66666666-6666-4666-8666-666666666666" }) });
    expect(inexistente.status).toBe(404);
  });

  it("papel insuficiente passa a resposta do requireRole", async () => {
    autorizar(false);
    banco();
    expect((await GET(get(), ctx)).status).toBe(403);
  });
});

describe("POST /pipelines/[id]/tracker-keys", () => {
  const corpo = { label: "Site da loja", allowed_origins: ["https://loja.exemplo/", "http://localhost:3000"] };

  it("cria com as origens normalizadas, a organização do JWT e o autor; audita", async () => {
    const { t } = banco();
    const r = await POST(post(corpo), ctx);
    expect(r.status).toBe(201);
    const nova = t.crm_tracker_public_keys.at(-1)!;
    expect(nova).toMatchObject({
      organization_id: ORG, pipeline_id: FUNIL, label: "Site da loja", created_by: USER,
      allowed_origins: ["https://loja.exemplo", "http://localhost:3000"],
    });
    // O valor da chave é do banco: a rota nunca o escolhe.
    expect(nova).not.toHaveProperty("public_key");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tracker_key.created", organizationId: ORG, resourceType: "crm_tracker_public_key" }),
    );
  });

  it("⭐ organization_id e pipeline_id no corpo são recusados; nada é gravado", async () => {
    const { t } = banco();
    const antes = t.crm_tracker_public_keys.length;
    expect((await POST(post({ ...corpo, organization_id: OUTRA_ORG }), ctx)).status).toBe(422);
    expect((await POST(post({ ...corpo, pipeline_id: FUNIL_ALHEIO }), ctx)).status).toBe(422);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([
    ["http fora de localhost", ["http://loja.exemplo"]],
    ["com caminho", ["https://loja.exemplo/cardapio"]],
    ["curinga", ["https://*.exemplo.com"]],
    ["uma boa e uma ruim", ["https://ok.exemplo", "javascript:alert(1)"]],
  ])("origem inválida (%s) é 422 com a origem na mensagem", async (_nome, origens) => {
    const { t } = banco();
    const antes = t.crm_tracker_public_keys.length;
    const r = await POST(post({ ...corpo, allowed_origins: origens }), ctx);
    expect(r.status).toBe(422);
    expect((await r.json()).error.message).toContain(origens.at(-1)!);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
  });

  it("sem origem nenhuma e sem rótulo é 422", async () => {
    banco();
    expect((await POST(post({ ...corpo, allowed_origins: [] }), ctx)).status).toBe(422);
    expect((await POST(post({ ...corpo, label: " " }), ctx)).status).toBe(422);
  });

  it("corpo que não é JSON é 422", async () => {
    banco();
    const r = await POST(new NextRequest("http://localhost/x", { method: "POST", body: "{" }), ctx);
    expect(r.status).toBe(422);
  });

  it("funil de outra organização: 404 e nada gravado", async () => {
    const { t } = banco();
    const antes = t.crm_tracker_public_keys.length;
    const r = await POST(post(corpo), { params: Promise.resolve({ id: FUNIL_ALHEIO }) });
    expect(r.status).toBe(404);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
  });

  it("papel insuficiente: 403 e nada gravado", async () => {
    autorizar(false);
    const { t } = banco();
    const antes = t.crm_tracker_public_keys.length;
    expect((await POST(post(corpo), ctx)).status).toBe(403);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
  });

  it("a guarda de suporte vem ANTES do efeito: negada, nada é gravado", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("support_read_only", "Somente leitura.", 403, { requestId: "x" }) as never);
    const { t } = banco();
    const antes = t.crm_tracker_public_keys.length;
    expect((await POST(post(corpo), ctx)).status).toBe(403);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
    expect(requireRole).not.toHaveBeenCalled();
  });
});

describe("DELETE /pipelines/[id]/tracker-keys — excluir as revogadas", () => {
  const apagar = (funil = FUNIL) =>
    DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: funil }) });
  const revogada = (id: string, extra: Linha = {}) => chave(id, { is_active: false, revoked_at: "2026-10-02T10:00:00Z", ...extra });

  function comRevogadas() {
    const t = tabelas();
    t.crm_tracker_public_keys.push(
      revogada("r1"),
      revogada("r2"),
      revogada("r3", { organization_id: OUTRA_ORG, pipeline_id: FUNIL_ALHEIO }),
      revogada("r4", { pipeline_id: "outro-funil-da-mesma-org" }),
    );
    return banco(t);
  }

  it("⭐ apaga SÓ as revogadas deste funil: ativa, outro funil e outra organização ficam", async () => {
    const { t } = comRevogadas();
    const r = await apagar();
    expect(r.status).toBe(200);
    expect((await r.json()).data.excluidas).toBe(2);
    expect(t.crm_tracker_public_keys.map((l) => l.id).sort()).toEqual(["a", "b", "c", "r3", "r4"]);
  });

  it("audita uma vez, com as chaves que saíram", async () => {
    comRevogadas();
    await apagar();
    expect(audit).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(audit).mock.calls[0]![0];
    expect(arg.action).toBe("tracker_key.purged");
    expect(arg.metadata).toMatchObject({ pipeline_id: FUNIL, quantidade: 2 });
  });

  it("sem nenhuma revogada: 200 com zero e nada é auditado", async () => {
    const { t } = banco();
    const antes = t.crm_tracker_public_keys.length;
    const r = await apagar();
    expect((await r.json()).data.excluidas).toBe(0);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
    expect(audit).not.toHaveBeenCalled();
  });

  it("funil de outra organização: 404 e nada apagado", async () => {
    const { t } = comRevogadas();
    const antes = t.crm_tracker_public_keys.length;
    expect((await apagar(FUNIL_ALHEIO)).status).toBe(404);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
  });

  it("papel insuficiente: 403 e nada apagado", async () => {
    autorizar(false);
    const { t } = comRevogadas();
    const antes = t.crm_tracker_public_keys.length;
    expect((await apagar()).status).toBe(403);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
  });

  it("a guarda de suporte vem ANTES do efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("support_read_only", "Somente leitura.", 403, { requestId: "x" }) as never);
    const { t } = comRevogadas();
    const antes = t.crm_tracker_public_keys.length;
    expect((await apagar()).status).toBe(403);
    expect(t.crm_tracker_public_keys.length).toBe(antes);
    expect(requireRole).not.toHaveBeenCalled();
  });
});
