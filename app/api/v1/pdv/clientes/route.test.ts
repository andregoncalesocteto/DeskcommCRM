/**
 * Busca de cliente do PDV: modos, vazio, truncado, erros do ERP, papel, módulo, limite de taxa
 * e ausência do termo (CPF/telefone) em log e em resposta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { buscarCliente } from "@/lib/pdv/erp/cliente";
import { ErpPdvError } from "@/lib/pdv/erp/resposta";

import { GET } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn() }));
vi.mock("@/lib/pdv/erp/cliente", () => ({ buscarCliente: vi.fn() }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CPF = "529.982.247-25";
const TELEFONE = "(19) 99876-5432";

const req = (q: string) => new NextRequest(`http://localhost/api/v1/pdv/clientes${q}`);
const url = (modo: string, termo: string) =>
  req(`?modo=${modo}&q=${encodeURIComponent(termo)}`);

function como(ok = true) {
  vi.mocked(requireRole).mockResolvedValue(
    ok
      ? ({ ok: true, user: { id: "u1" }, org: { orgId: ORG, name: "O", role: "agent" } } as never)
      : ({ ok: false, response: fail("forbidden_role", "Papel insuficiente.", 403, {}) } as never),
  );
}

beforeEach(() => {
  vi.mocked(moduloLigado).mockResolvedValue(true);
  vi.mocked(buscarCliente).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  como();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/v1/pdv/clientes", () => {
  it.each([
    ["telefone", TELEFONE],
    ["nome", "maria"],
    ["cpf", CPF],
  ])("busca por %s chama o ERP com o modo e o termo", async (modo, termo) => {
    vi.mocked(buscarCliente).mockResolvedValue({
      clientes: [{ id: "c-1", nome: "Maria", endereco_principal: "Rua A, 1" }],
      total_encontrado: 1,
      truncado: false,
    });
    const res = await GET(url(modo, termo));
    expect(res.status).toBe(200);
    expect(buscarCliente).toHaveBeenCalledWith(ORG, modo, termo);
    const body = await res.json();
    expect(body.data).toEqual({
      clientes: [{ id: "c-1", nome: "Maria", endereco_principal: "Rua A, 1" }],
      total_encontrado: 1,
      truncado: false,
    });
  });

  it("lista vazia não é erro", async () => {
    vi.mocked(buscarCliente).mockResolvedValue({ clientes: [], total_encontrado: 0, truncado: false });
    const res = await GET(url("nome", "xyzzy"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ clientes: [], total_encontrado: 0, truncado: false });
  });

  it("repassa truncado e total_encontrado", async () => {
    vi.mocked(buscarCliente).mockResolvedValue({
      clientes: [
        { id: "c-2", nome: "Maria A", endereco_principal: null },
        { id: "c-1", nome: "Maria B", endereco_principal: null },
      ],
      total_encontrado: 3,
      truncado: true,
    });
    const body = await (await GET(url("nome", "maria"))).json();
    expect(body.data.truncado).toBe(true);
    expect(body.data.total_encontrado).toBe(3);
  });

  it("não deixa passar CPF, telefone nem e-mail que o ERP mande a mais", async () => {
    vi.mocked(buscarCliente).mockResolvedValue({
      clientes: [
        { id: "c-1", nome: "Maria", endereco_principal: null, cpf: CPF, telefone: "+5519998765432", email: "m@x.com" },
      ],
      total_encontrado: 1,
      truncado: false,
    } as never);
    const texto = JSON.stringify(await (await GET(url("nome", "maria"))).json());
    expect(texto).not.toMatch(/cpf|telefone|email|529\.982|m@x\.com/);
  });

  it.each([
    ["sem modo", "?q=maria"],
    ["modo desconhecido", "?modo=email&q=maria"],
    ["sem q", "?modo=nome"],
    ["q vazio", "?modo=nome&q=%20%20"],
    ["q enorme", `?modo=nome&q=${"a".repeat(101)}`],
  ])("Zod recusa %s com 422 sem chamar o ERP", async (_n, q) => {
    const res = await GET(req(q));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("validation_failed");
    expect(buscarCliente).not.toHaveBeenCalled();
  });

  it("termo_invalido do ERP vira 422 com a mensagem do ERP", async () => {
    vi.mocked(buscarCliente).mockRejectedValue(new ErpPdvError("termo_invalido", "CPF inválido."));
    const res = await GET(url("cpf", "111.111.111-11"));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.message).toBe("CPF inválido.");
  });

  it("erp_indisponivel e tempo_esgotado viram 502/504 com código erp_indisponivel", async () => {
    vi.mocked(buscarCliente).mockRejectedValueOnce(new ErpPdvError("erp_indisponivel", "Fora do ar."));
    const a = await GET(url("nome", "maria"));
    expect(a.status).toBe(502);
    expect((await a.json()).error.code).toBe("erp_indisponivel");

    vi.mocked(buscarCliente).mockRejectedValueOnce(new ErpPdvError("tempo_esgotado", "Demorou."));
    const b = await GET(url("nome", "maria"));
    expect(b.status).toBe(504);
    expect((await b.json()).error.code).toBe("erp_indisponivel");
  });

  it("erp_nao_configurado é estável (409)", async () => {
    vi.mocked(buscarCliente).mockRejectedValue(new ErpPdvError("erp_nao_configurado", "Sem ERP."));
    const res = await GET(url("nome", "maria"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("erp_nao_configurado");
  });

  it("módulo desligado devolve 404", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(false);
    const res = await GET(url("nome", "maria"));
    expect(res.status).toBe(404);
    expect(buscarCliente).not.toHaveBeenCalled();
  });

  it("papel insuficiente é recusado antes de tudo", async () => {
    como(false);
    const res = await GET(url("nome", "maria"));
    expect(res.status).toBe(403);
    expect(buscarCliente).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith("agent", expect.anything());
  });

  it("limite de taxa excedido devolve 429 com Retry-After", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const res = await GET(url("nome", "maria"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(buscarCliente).not.toHaveBeenCalled();
  });

  it("o termo não aparece em log nem na resposta de erro", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    vi.mocked(buscarCliente).mockRejectedValueOnce(new ErpPdvError("erp_indisponivel", "Fora do ar."));
    const a = await GET(url("cpf", CPF));
    vi.mocked(buscarCliente).mockRejectedValueOnce(new ErpPdvError("termo_invalido", "CPF inválido."));
    const b = await GET(url("telefone", TELEFONE));
    const c = await GET(req(`?modo=nada&q=${encodeURIComponent(CPF)}`));
    const saidas = JSON.stringify([await a.json(), await b.json(), await c.json()]);
    const logs = JSON.stringify(espioes.flatMap((e) => e.mock.calls));
    for (const termo of [CPF, "52998224725", TELEFONE, "998765432"]) {
      expect(saidas).not.toContain(termo);
      expect(logs).not.toContain(termo);
    }
  });
});
