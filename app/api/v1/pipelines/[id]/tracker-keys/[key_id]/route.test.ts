import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";
import { criarBancoFalso, type Linha } from "../../../../../../../tests/helpers/banco-falso-de-eventos";

import { DELETE } from "./route";

/** DELETE /api/v1/pipelines/[id]/tracker-keys/[key_id] — revogar desativa na hora e não apaga. */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";
const FUNIL = "44444444-4444-4444-8444-444444444444";
const OUTRO_FUNIL = "55555555-5555-4555-8555-555555555555";
const K_ATIVA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const K_REVOGADA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const K_ALHEIA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const K_OUTRO_FUNIL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const chamar = (id: string, funil = FUNIL) =>
  DELETE(new NextRequest("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: funil, key_id: id }) });

const linha = (id: string, extra: Linha = {}): Linha => ({
  id, organization_id: ORG, pipeline_id: FUNIL, public_key: `pk_${id}`, label: id, allowed_origins: ["https://a.exemplo"],
  is_active: true, revoked_at: null, created_at: "2026-10-01T10:00:00Z", ...extra,
});

function banco() {
  const t = {
    crm_tracker_public_keys: [
      linha(K_ATIVA),
      linha(K_REVOGADA, { is_active: false, revoked_at: "2026-10-02T10:00:00Z" }),
      linha(K_ALHEIA, { organization_id: OUTRA_ORG }),
      linha(K_OUTRO_FUNIL, { pipeline_id: OUTRO_FUNIL }),
    ] as Linha[],
  };
  vi.mocked(createClient).mockResolvedValue(criarBancoFalso(t as never).client);
  return t;
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

describe("DELETE /pipelines/[id]/tracker-keys/[key_id]", () => {
  it("⭐ revoga: desativa na hora, marca a hora, mantém a linha e audita", async () => {
    const t = banco();
    const r = await chamar(K_ATIVA);
    expect(r.status).toBe(200);
    const alvo = t.crm_tracker_public_keys.find((l) => l.id === K_ATIVA)!;
    expect(alvo.is_active).toBe(false);
    expect(typeof alvo.revoked_at).toBe("string");
    expect(t.crm_tracker_public_keys).toHaveLength(4);
    expect((await r.json()).data.chave).toMatchObject({ id: K_ATIVA, is_active: false });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "tracker_key.revoked", resourceId: K_ATIVA }));
  });

  it("revogar de novo é 200 sem mexer na hora original e sem auditar outra vez", async () => {
    const t = banco();
    const r = await chamar(K_REVOGADA);
    expect(r.status).toBe(200);
    expect(t.crm_tracker_public_keys.find((l) => l.id === K_REVOGADA)!.revoked_at).toBe("2026-10-02T10:00:00Z");
    expect(audit).not.toHaveBeenCalled();
  });

  it("chave de outra organização, de outro funil ou inexistente: 404 e nada muda", async () => {
    const t = banco();
    expect((await chamar(K_ALHEIA)).status).toBe(404);
    expect((await chamar(K_OUTRO_FUNIL)).status).toBe(404);
    expect((await chamar("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).status).toBe(404);
    expect((await chamar("nao-e-uuid")).status).toBe(404);
    expect(t.crm_tracker_public_keys.find((l) => l.id === K_ALHEIA)!.is_active).toBe(true);
    expect(t.crm_tracker_public_keys.find((l) => l.id === K_OUTRO_FUNIL)!.is_active).toBe(true);
  });

  it("papel insuficiente: 403 e a chave segue ativa", async () => {
    autorizar(false);
    const t = banco();
    expect((await chamar(K_ATIVA)).status).toBe(403);
    expect(t.crm_tracker_public_keys.find((l) => l.id === K_ATIVA)!.is_active).toBe(true);
  });

  it("a guarda de suporte vem ANTES do efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("support_read_only", "Somente leitura.", 403, { requestId: "x" }) as never);
    const t = banco();
    expect((await chamar(K_ATIVA)).status).toBe(403);
    expect(t.crm_tracker_public_keys.find((l) => l.id === K_ATIVA)!.is_active).toBe(true);
  });
});
