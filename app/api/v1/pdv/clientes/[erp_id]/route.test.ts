/**
 * Ficha do cliente do PDV (somente leitura, ADR-007): ficha completa com o estado do vínculo, sem
 * endereço, inexistente, isolamento entre tenants, papel, módulo, limite, ausência de CPF/nascimento
 * em log e a prova de que abrir a ficha NÃO escreve nada (nem vínculo, nem contato).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moduloLigado } from "@/lib/instalacao/modulos";
import type * as espelho from "@/lib/pdv/contato-espelho";
import {
  atualizarContatoDoErp,
  ContatoEspelhoError,
  consultarVinculo,
  vincularClienteDoErp,
} from "@/lib/pdv/contato-espelho";
import { obterCliente } from "@/lib/pdv/erp/cliente";
import { ErpPdvError } from "@/lib/pdv/erp/resposta";
import type { Cliente } from "@/lib/pdv/erp/tipos";

import { GET } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn() }));
vi.mock("@/lib/pdv/erp/cliente", () => ({ obterCliente: vi.fn() }));
vi.mock("@/lib/pdv/contato-espelho", async (orig) => ({
  ...(await orig<typeof espelho>()),
  consultarVinculo: vi.fn(),
  vincularClienteDoErp: vi.fn(),
  atualizarContatoDoErp: vi.fn(),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CPF = "529.982.247-25";
const NASC = "1987-03-14";

const CLIENTE: Cliente = {
  id: "c-1",
  nome: "Maria da Silva",
  telefone: "+5519998765432",
  email: "maria@exemplo.com",
  cpf: CPF,
  data_nascimento: NASC,
  enderecos: [
    {
      id: "e-1",
      cep: "13000000",
      uf: "SP",
      cidade: "Campinas",
      bairro: "Centro",
      endereco: "Rua A, 1",
      complemento: null,
      principal: true,
      loja_entrega: { codigo: "01", sigla: "CMP" },
    },
    {
      id: "e-2",
      cep: "13000001",
      uf: "SP",
      cidade: "Campinas",
      bairro: "Cambuí",
      endereco: "Rua B, 2",
      complemento: "ap 3",
      principal: false,
      loja_entrega: null,
    },
  ],
};

const chamar = (erpId = "c-1") =>
  GET(new NextRequest(`http://localhost/api/v1/pdv/clientes/${erpId}`), {
    params: Promise.resolve({ erp_id: erpId }),
  });

function como(orgId: string | null) {
  vi.mocked(requireRole).mockResolvedValue(
    orgId
      ? ({ ok: true, user: { id: "u1" }, org: { orgId, name: "O", role: "agent" } } as never)
      : ({ ok: false, response: fail("forbidden_role", "Papel insuficiente.", 403, {}) } as never),
  );
}

beforeEach(() => {
  vi.mocked(moduloLigado).mockResolvedValue(true);
  vi.mocked(obterCliente).mockReset().mockResolvedValue(CLIENTE);
  vi.mocked(consultarVinculo).mockReset().mockResolvedValue({ estado: "livre" });
  vi.mocked(vincularClienteDoErp).mockReset();
  vi.mocked(atualizarContatoDoErp).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  como(ORG_A);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/v1/pdv/clientes/{erp_id}", () => {
  it("ficha completa: pede campos sensíveis, consulta o vínculo e devolve tudo", async () => {
    const res = await chamar();
    expect(res.status).toBe(200);
    expect(obterCliente).toHaveBeenCalledWith(ORG_A, "c-1", { camposSensiveis: true });
    expect(consultarVinculo).toHaveBeenCalledWith(ORG_A, CLIENTE);
    const { data } = await res.json();
    expect(data).toMatchObject({
      id: "c-1",
      vinculo: { estado: "livre" },
      nome: "Maria da Silva",
      telefone: "+5519998765432",
      email: "maria@exemplo.com",
      cpf: CPF,
      data_nascimento: NASC,
    });
    expect(data.enderecos).toHaveLength(2);
    expect(data.enderecos.filter((e: { principal: boolean }) => e.principal)).toHaveLength(1);
    expect(data.enderecos[0].loja_entrega).toEqual({ codigo: "01", sigla: "CMP" });
    expect(data.enderecos[1].loja_entrega).toBeNull();
  });

  it("abrir a ficha só lê: nunca cria vínculo nem contato (ADR-007)", async () => {
    await chamar();
    expect(vincularClienteDoErp).not.toHaveBeenCalled();
    expect(atualizarContatoDoErp).not.toHaveBeenCalled();
  });

  it("devolve o estado do vínculo em snake_case, com o nome do contato só quando existe", async () => {
    vi.mocked(consultarVinculo).mockResolvedValueOnce({
      estado: "vinculado",
      contactId: "ct-1",
      contatoNome: "Maria da Silva",
    });
    expect((await (await chamar()).json()).data.vinculo).toEqual({
      estado: "vinculado",
      contact_id: "ct-1",
      contato_nome: "Maria da Silva",
    });
    vi.mocked(consultarVinculo).mockResolvedValueOnce({
      estado: "telefone_de_outro",
      contatoNome: "Outra Maria",
    });
    expect((await (await chamar()).json()).data.vinculo).toEqual({
      estado: "telefone_de_outro",
      contato_nome: "Outra Maria",
    });
    for (const estado of ["telefone_ausente", "ambiguo"] as const) {
      vi.mocked(consultarVinculo).mockResolvedValueOnce({ estado });
      expect((await (await chamar()).json()).data.vinculo).toEqual({ estado });
    }
  });

  it("ERP sem endereço principal: principal ausente sai como false na API", async () => {
    vi.mocked(obterCliente).mockResolvedValue({
      ...CLIENTE,
      enderecos: [
        { id: "e-1", cep: "13060000", uf: "SP", cidade: "Campinas", bairro: "Centro", endereco: "Rua A, 1", complemento: null, loja_entrega: null },
      ],
    });
    const res = await chamar();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.enderecos).toHaveLength(1);
    expect(data.enderecos[0].principal).toBe(false);
    expect(data.enderecos[0].loja_entrega).toBeNull();
  });

  it("sem endereço: lista vazia, e CPF/nascimento ausentes viram null", async () => {
    vi.mocked(obterCliente).mockResolvedValue({
      ...CLIENTE,
      cpf: undefined,
      data_nascimento: null,
      enderecos: [],
    });
    const { data } = await (await chamar()).json();
    expect(data.enderecos).toEqual([]);
    expect(data.cpf).toBeNull();
    expect(data.data_nascimento).toBeNull();
  });

  it("cliente inexistente no ERP vira 404 e não consulta o vínculo", async () => {
    vi.mocked(obterCliente).mockRejectedValue(new ErpPdvError("nao_encontrado", "Sem cliente."));
    const res = await chamar("c-x");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(consultarVinculo).not.toHaveBeenCalled();
  });

  it("falha ao ler o vínculo é 500 sem dado pessoal", async () => {
    vi.mocked(consultarVinculo).mockRejectedValue(
      new ContatoEspelhoError("falha_ao_vincular", "Não foi possível vincular o contato do cliente."),
    );
    const res = await chamar();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain(CPF);
  });

  it("erros do ERP seguem a tabela da busca (502, 504, 409)", async () => {
    vi.mocked(obterCliente).mockRejectedValueOnce(new ErpPdvError("erp_indisponivel", "Fora do ar."));
    expect((await chamar()).status).toBe(502);
    vi.mocked(obterCliente).mockRejectedValueOnce(new ErpPdvError("tempo_esgotado", "Demorou."));
    expect((await chamar()).status).toBe(504);
    vi.mocked(obterCliente).mockRejectedValueOnce(new ErpPdvError("erp_nao_configurado", "Sem ERP."));
    const res = await chamar();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("erp_nao_configurado");
  });

  it("isolamento: a organização vem da sessão; o outro tenant usa a própria", async () => {
    await chamar();
    como(ORG_B);
    await chamar();
    expect(vi.mocked(obterCliente).mock.calls.map((c) => c[0])).toEqual([ORG_A, ORG_B]);
    expect(vi.mocked(consultarVinculo).mock.calls.map((c) => c[0])).toEqual([ORG_A, ORG_B]);
  });

  it("módulo desligado devolve 404 sem chamar o ERP", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(false);
    expect((await chamar()).status).toBe(404);
    expect(obterCliente).not.toHaveBeenCalled();
  });

  it("papel insuficiente é recusado antes de tudo", async () => {
    como(null);
    expect((await chamar()).status).toBe(403);
    expect(obterCliente).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith("agent", expect.anything());
  });

  it("limite de taxa excedido devolve 429 com Retry-After", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const res = await chamar();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(obterCliente).not.toHaveBeenCalled();
  });

  it("identificador vazio ou enorme é 422", async () => {
    expect((await chamar("   ")).status).toBe(422);
    expect((await chamar("a".repeat(101))).status).toBe(422);
    expect(obterCliente).not.toHaveBeenCalled();
  });

  it("CPF e nascimento não vão para log nem para a resposta de erro", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    await chamar();
    vi.mocked(consultarVinculo).mockRejectedValueOnce(
      new ContatoEspelhoError("falha_ao_vincular", "Não foi possível vincular o contato do cliente."),
    );
    const erro = await (await chamar()).json();
    vi.mocked(obterCliente).mockRejectedValueOnce(new ErpPdvError("erp_indisponivel", "Fora do ar."));
    const erro2 = await (await chamar()).json();
    const saidas = JSON.stringify([erro, erro2]);
    const logs = JSON.stringify(espioes.flatMap((e) => e.mock.calls));
    for (const dado of [CPF, "52998224725", NASC]) {
      expect(saidas).not.toContain(dado);
      expect(logs).not.toContain(dado);
    }
  });
});
