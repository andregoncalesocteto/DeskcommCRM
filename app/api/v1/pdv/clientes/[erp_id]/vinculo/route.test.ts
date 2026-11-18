/**
 * Vínculo do cliente do ERP com o contato do CRM (ADR-007): POST vincula e PATCH atualiza.
 * Mede o que cada resposta promete, a ordem das guardas, a auditoria sem dado pessoal e o
 * isolamento entre tenants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import type * as espelho from "@/lib/pdv/contato-espelho";
import {
  atualizarContatoDoErp,
  ContatoEspelhoError,
  vincularClienteDoErp,
} from "@/lib/pdv/contato-espelho";
import { obterCliente } from "@/lib/pdv/erp/cliente";
import { ErpPdvError } from "@/lib/pdv/erp/resposta";
import type { Cliente } from "@/lib/pdv/erp/tipos";

import { PATCH, POST } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/pdv/erp/cliente", () => ({ obterCliente: vi.fn() }));
vi.mock("@/lib/pdv/contato-espelho", async (orig) => ({
  ...(await orig<typeof espelho>()),
  vincularClienteDoErp: vi.fn(),
  atualizarContatoDoErp: vi.fn(),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CPF = "529.982.247-25";

const CLIENTE: Cliente = {
  id: "c-1",
  nome: "Maria da Silva",
  telefone: "+5519998765432",
  email: "maria@exemplo.com",
  cpf: CPF,
  data_nascimento: "1987-03-14",
  enderecos: [],
};

const ctx = (erpId: string) => ({ params: Promise.resolve({ erp_id: erpId }) });
const req = (metodo: string, erpId: string) =>
  new NextRequest(`http://localhost/api/v1/pdv/clientes/${erpId}/vinculo`, { method: metodo });
const vincular = (erpId = "c-1") => POST(req("POST", erpId), ctx(erpId));
const atualizar = (erpId = "c-1") => PATCH(req("PATCH", erpId), ctx(erpId));

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
  vi.mocked(vincularClienteDoErp).mockReset().mockResolvedValue({
    contactId: "ct-1",
    contatoCriado: true,
    vinculoNovo: true,
    semCpfEmail: false,
  });
  vi.mocked(atualizarContatoDoErp)
    .mockReset()
    .mockResolvedValue({ contactId: "ct-1", semCpfEmail: false });
  vi.mocked(requireSupportWrite).mockReset().mockResolvedValue(null);
  vi.mocked(audit).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true } as never);
  como(ORG_A);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/v1/pdv/clientes/{erp_id}/vinculo (Vincular ao CRM)", () => {
  it("vincula com os dados lidos do ERP, responde 201 e audita uma vez", async () => {
    const res = await vincular();
    expect(res.status).toBe(201);
    expect(obterCliente).toHaveBeenCalledWith(ORG_A, "c-1", { camposSensiveis: true });
    expect(vincularClienteDoErp).toHaveBeenCalledWith(ORG_A, CLIENTE);
    expect((await res.json()).data).toEqual({
      contact_id: "ct-1",
      contato_criado: true,
      vinculo_novo: true,
      sem_cpf_email: false,
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pdv.customer.linked",
        organizationId: ORG_A,
        actorUserId: "u1",
        resourceId: "ct-1",
        metadata: { erp_customer_id: "c-1", contato_criado: true },
      }),
    );
  });

  it("já vinculado: responde 200 e NÃO audita (repetir o clique não é efeito)", async () => {
    vi.mocked(vincularClienteDoErp).mockResolvedValue({
      contactId: "ct-1",
      contatoCriado: false,
      vinculoNovo: false,
      semCpfEmail: false,
    });
    const res = await vincular();
    expect(res.status).toBe(200);
    expect(audit).not.toHaveBeenCalled();
  });

  it("avisa quando CPF e e-mail não foram copiados", async () => {
    vi.mocked(vincularClienteDoErp).mockResolvedValue({
      contactId: "ct-1",
      contatoCriado: true,
      vinculoNovo: true,
      semCpfEmail: true,
    });
    expect((await (await vincular()).json()).data.sem_cpf_email).toBe(true);
  });

  it.each([
    ["contato_ambiguo", 409],
    ["telefone_de_outro_cliente", 409],
    ["cliente_sem_telefone", 422],
  ] as const)("%s vira %i, sem auditar", async (codigo, status) => {
    vi.mocked(vincularClienteDoErp).mockRejectedValue(new ContatoEspelhoError(codigo, "Mensagem fixa."));
    const res = await vincular();
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(codigo);
    expect(audit).not.toHaveBeenCalled();
  });

  it("falha ao vincular é 500", async () => {
    vi.mocked(vincularClienteDoErp).mockRejectedValue(
      new ContatoEspelhoError("falha_ao_vincular", "Não foi possível vincular o contato do cliente."),
    );
    expect((await vincular()).status).toBe(500);
  });

  it("cliente inexistente no ERP é 404 e não escreve nada", async () => {
    vi.mocked(obterCliente).mockRejectedValue(new ErpPdvError("nao_encontrado", "Sem cliente."));
    expect((await vincular("c-x")).status).toBe(404);
    expect(vincularClienteDoErp).not.toHaveBeenCalled();
  });

  it("acompanhamento somente leitura é barrado ANTES do efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(
      fail("forbidden", "Este acompanhamento permite somente leitura.", 403) as never,
    );
    expect((await vincular()).status).toBe(403);
    expect(vincularClienteDoErp).not.toHaveBeenCalled();
  });

  it("ERP fora do ar é 502 e não escreve nada", async () => {
    vi.mocked(obterCliente).mockRejectedValue(new ErpPdvError("erp_indisponivel", "Fora do ar."));
    expect((await vincular()).status).toBe(502);
    expect(vincularClienteDoErp).not.toHaveBeenCalled();
  });

  it("isolamento: cada tenant usa a própria organização, nunca o corpo", async () => {
    await vincular();
    como(ORG_B);
    await vincular();
    expect(vi.mocked(vincularClienteDoErp).mock.calls.map((c) => c[0])).toEqual([ORG_A, ORG_B]);
    expect(vi.mocked(obterCliente).mock.calls.map((c) => c[0])).toEqual([ORG_A, ORG_B]);
  });

  it("módulo desligado é 404; papel insuficiente é 403; limite excedido é 429", async () => {
    vi.mocked(moduloLigado).mockResolvedValue(false);
    expect((await vincular()).status).toBe(404);
    vi.mocked(moduloLigado).mockResolvedValue(true);
    como(null);
    expect((await vincular()).status).toBe(403);
    como(ORG_A);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false } as never);
    const res = await vincular();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(obterCliente).not.toHaveBeenCalled();
    expect(requireRole).toHaveBeenCalledWith("agent", expect.anything());
  });

  it("identificador vazio ou enorme é 422", async () => {
    expect((await vincular("   ")).status).toBe(422);
    expect((await vincular("a".repeat(101))).status).toBe(422);
    expect(obterCliente).not.toHaveBeenCalled();
  });

  it("CPF e telefone não vão para a auditoria nem para a resposta de erro", async () => {
    await vincular();
    vi.mocked(vincularClienteDoErp).mockRejectedValue(
      new ContatoEspelhoError("telefone_de_outro_cliente", "O contato já está vinculado."),
    );
    const erro = JSON.stringify(await (await vincular()).json());
    const auditado = JSON.stringify(vi.mocked(audit).mock.calls);
    for (const dado of [CPF, "52998224725", "998765432", "maria@exemplo.com", "Maria da Silva"]) {
      expect(erro).not.toContain(dado);
      expect(auditado).not.toContain(dado);
    }
  });
});

describe("PATCH /api/v1/pdv/clientes/{erp_id}/vinculo (Atualizar dados)", () => {
  it("atualiza com os dados do ERP, responde 200 e audita", async () => {
    const res = await atualizar();
    expect(res.status).toBe(200);
    expect(atualizarContatoDoErp).toHaveBeenCalledWith(ORG_A, CLIENTE);
    expect(vincularClienteDoErp).not.toHaveBeenCalled();
    expect((await res.json()).data).toEqual({ contact_id: "ct-1", sem_cpf_email: false });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pdv.customer.updated",
        organizationId: ORG_A,
        resourceId: "ct-1",
        metadata: { erp_customer_id: "c-1" },
      }),
    );
  });

  it("sem vínculo é 409 sem_vinculo e não audita", async () => {
    vi.mocked(atualizarContatoDoErp).mockRejectedValue(
      new ContatoEspelhoError("sem_vinculo", "Este cliente ainda não está vinculado ao CRM."),
    );
    const res = await atualizar();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("sem_vinculo");
    expect(audit).not.toHaveBeenCalled();
  });

  it("acompanhamento somente leitura é barrado antes do efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(
      fail("forbidden", "Este acompanhamento permite somente leitura.", 403) as never,
    );
    expect((await atualizar()).status).toBe(403);
    expect(atualizarContatoDoErp).not.toHaveBeenCalled();
  });
});
