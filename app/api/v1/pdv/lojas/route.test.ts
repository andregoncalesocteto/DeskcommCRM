/**
 * Rotas de leitura de lojas do PDV: papéis, módulo desligado, ERP e isolamento entre tenants.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { ErpPdvError } from "@/lib/pdv/erp/resposta";
import { listarLojas } from "@/lib/pdv/erp/cliente";
import { createClient } from "@/lib/supabase/server";

import { GET as lojasDoErp } from "./erp/route";
import { GET as lojasDoTenant } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn() }));
vi.mock("@/lib/pdv/erp/cliente", () => ({ listarLojas: vi.fn() }));

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const LINHAS = [
  { organization_id: ORG_A, id: "1", erp_store_code: "001", sigla: "CTR", nome: "Centro", ativa: true },
  { organization_id: ORG_A, id: "2", erp_store_code: "002", sigla: "NRT", nome: "Norte", ativa: false },
  { organization_id: ORG_B, id: "3", erp_store_code: "009", sigla: "SUL", nome: "Sul", ativa: true },
];

/** Banco falso: só devolve o que passou pelos `.eq()` pedidos (como a RLS + o filtro explícito). */
function fakeSupabase(erro: { code: string } | null = null) {
  const filtros: Array<[string, unknown]> = [];
  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (c: string, v: unknown) => {
      filtros.push([c, v]);
      return builder;
    },
    then: (res: (v: unknown) => unknown) =>
      res({
        data: erro ? null : LINHAS.filter((l) => filtros.every(([c, v]) => (l as never)[c] === v)),
        error: erro,
      }),
  };
  return { from: () => builder };
}

function como(org: string, ok = true) {
  vi.mocked(requireRole).mockResolvedValue(
    ok
      ? ({ ok: true, user: {}, org: { orgId: org, name: "O", role: "manager" } } as never)
      : ({ ok: false, response: fail("forbidden_role", "Papel insuficiente.", 403, {}) } as never),
  );
}

const req = (q = "") => new NextRequest(`http://localhost/api/v1/pdv/lojas${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(moduloLigado).mockResolvedValue(true);
  vi.mocked(createClient).mockResolvedValue(fakeSupabase() as never);
});

describe("GET /api/v1/pdv/lojas", () => {
  it("devolve as lojas do tenant no wrapper, com X-Request-Id", async () => {
    como(ORG_A);
    const res = await lojasDoTenant(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
    const body = await res.json();
    expect(body.data.map((l: { sigla: string }) => l.sigla)).toEqual(["CTR", "NRT"]);
  });

  it("isola os tenants: a org B só vê a sua loja", async () => {
    como(ORG_B);
    const body = await (await lojasDoTenant(req())).json();
    expect(body.data.map((l: { sigla: string }) => l.sigla)).toEqual(["SUL"]);
  });

  it("aplica o filtro ativa", async () => {
    como(ORG_A);
    const body = await (await lojasDoTenant(req("?ativa=true"))).json();
    expect(body.data).toHaveLength(1);
  });

  it("recusa consulta inválida com 422", async () => {
    como(ORG_A);
    expect((await lojasDoTenant(req("?ativa=talvez"))).status).toBe(422);
  });

  it("propaga o 403 do papel insuficiente", async () => {
    como(ORG_A, false);
    expect((await lojasDoTenant(req())).status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("módulo desligado devolve 404", async () => {
    como(ORG_A);
    vi.mocked(moduloLigado).mockResolvedValue(false);
    const res = await lojasDoTenant(req());
    expect(res.status).toBe(404);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("erro de banco vira 500 sem vazar a mensagem", async () => {
    como(ORG_A);
    vi.mocked(createClient).mockResolvedValue(fakeSupabase({ code: "XX000" }) as never);
    const res = await lojasDoTenant(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
  });
});

describe("GET /api/v1/pdv/lojas/erp", () => {
  const LOJAS_ERP = [
    { codigo: "001", sigla: "CTR", nome: "Centro", endereco: "Rua A", ativa: true },
    { codigo: "005", sigla: "LST", nome: "Leste", endereco: "Rua B", ativa: true },
  ];

  it("marca as lojas que o tenant já tem", async () => {
    como(ORG_A);
    vi.mocked(listarLojas).mockResolvedValue(LOJAS_ERP);
    const body = await (await lojasDoErp(req())).json();
    expect(listarLojas).toHaveBeenCalledWith(ORG_A);
    expect(body.data.map((l: { ja_cadastrada: boolean }) => l.ja_cadastrada)).toEqual([true, false]);
  });

  it("a marca respeita o tenant: na org B nenhuma loja do ERP está cadastrada", async () => {
    como(ORG_B);
    vi.mocked(listarLojas).mockResolvedValue(LOJAS_ERP);
    const body = await (await lojasDoErp(req())).json();
    expect(body.data.every((l: { ja_cadastrada: boolean }) => !l.ja_cadastrada)).toBe(true);
  });

  it("papel abaixo de manager é recusado antes de falar com o ERP", async () => {
    como(ORG_A, false);
    expect((await lojasDoErp(req())).status).toBe(403);
    expect(listarLojas).not.toHaveBeenCalled();
  });

  it("módulo desligado devolve 404 sem falar com o ERP", async () => {
    como(ORG_A);
    vi.mocked(moduloLigado).mockResolvedValue(false);
    expect((await lojasDoErp(req())).status).toBe(404);
    expect(listarLojas).not.toHaveBeenCalled();
  });

  it("ERP não configurado devolve o erro estável erp_nao_configurado", async () => {
    como(ORG_A);
    vi.mocked(listarLojas).mockRejectedValue(new ErpPdvError("erp_nao_configurado", "sem servidor"));
    const res = await lojasDoErp(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("erp_nao_configurado");
  });

  it("ERP fora do ar devolve 502 erp_indisponivel, sem endereço no corpo", async () => {
    como(ORG_A);
    vi.mocked(listarLojas).mockRejectedValue(
      new ErpPdvError("erp_indisponivel", "Não foi possível falar com o ERP.", { host: "erp.exemplo" }),
    );
    const res = await lojasDoErp(req());
    expect(res.status).toBe(502);
    const corpo = await res.json();
    expect(corpo.error.code).toBe("erp_indisponivel");
    expect(JSON.stringify(corpo)).not.toContain("erp.exemplo");
  });

  it("resposta ilegível do ERP também é 502", async () => {
    como(ORG_A);
    vi.mocked(listarLojas).mockRejectedValue(new ErpPdvError("resposta_invalida", "x"));
    expect((await lojasDoErp(req())).status).toBe(502);
  });

  it("erro de banco ao ler pdv_stores vira 500", async () => {
    como(ORG_A);
    vi.mocked(listarLojas).mockResolvedValue(LOJAS_ERP);
    vi.mocked(createClient).mockResolvedValue(fakeSupabase({ code: "XX000" }) as never);
    expect((await lojasDoErp(req())).status).toBe(500);
  });
});
