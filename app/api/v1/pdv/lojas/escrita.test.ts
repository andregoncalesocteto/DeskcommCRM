/**
 * Escrita de lojas do PDV: POST (adicionar do ERP) e PATCH (ativa + conexão).
 * Papéis, idempotência, conexão de outro tenant, nome vindo do ERP e auditoria.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moduloLigado } from "@/lib/instalacao/modulos";
import { listarLojas } from "@/lib/pdv/erp/cliente";
import { ErpPdvError } from "@/lib/pdv/erp/resposta";
import { createClient } from "@/lib/supabase/server";

import { PATCH } from "./[id]/route";
import { POST } from "./route";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/instalacao/modulos", () => ({ moduloLigado: vi.fn() }));
vi.mock("@/lib/pdv/erp/cliente", () => ({ listarLojas: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONEXAO_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONEXAO_B = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LOJA_ID = "11111111-1111-4111-8111-111111111111";
const CHAVE = "22222222-2222-4222-8222-222222222222";

type Linha = Record<string, unknown>;
let tabelas: Record<string, Linha[]>;
const lojas = () => tabelas.pdv_stores ?? [];
let recibos: Map<string, { hash: string; resposta: unknown; status: number }>;

/** Banco falso em memória: select/insert/update com `.eq()`, único (org, sigla) e (org, código). */
function fakeSupabase() {
  return {
    from(nome: string) {
      const filtros: Array<[string, unknown]> = [];
      let op: "select" | "insert" | "update" = "select";
      let valores: Linha = {};
      const casa = (l: Linha) => filtros.every(([c, v]) => l[c] === v);
      const executar = () => {
        const tabela = (tabelas[nome] ??= []);
        if (op === "insert") {
          const dup = tabela.some(
            (l) =>
              l.organization_id === valores.organization_id &&
              (l.sigla === valores.sigla || l.erp_store_code === valores.erp_store_code),
          );
          if (dup) return { data: null, error: { code: "23505" } };
          const nova = { id: `loja-${tabela.length + 1}`, ativa: true, channel_session_id: null, ...valores };
          tabela.push(nova);
          return { data: [nova], error: null };
        }
        if (op === "update") {
          const alvo = tabela.filter(casa);
          alvo.forEach((l) => Object.assign(l, valores));
          return { data: alvo, error: null };
        }
        return { data: tabela.filter(casa), error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        insert: (v: Linha) => ((op = "insert"), (valores = v), b),
        update: (v: Linha) => ((op = "update"), (valores = v), b),
        eq: (c: string, v: unknown) => (filtros.push([c, v]), b),
        single: async () => {
          const r = executar();
          return r.error ? r : { data: (r.data as Linha[])[0] ?? null, error: null };
        },
        maybeSingle: async () => {
          const r = executar();
          return r.error ? r : { data: (r.data as Linha[])[0] ?? null, error: null };
        },
        then: (res: (v: unknown) => unknown) => res(executar()),
      };
      return b;
    },
  };
}

vi.mock("@/lib/api/idempotency", () => ({
  chaveDaRequisicao: (req: Request) => req.headers.get("Idempotency-Key"),
  comIdempotencia: async (e: {
    chave: string;
    corpo: unknown;
    executar: () => Promise<{ resposta: unknown; status: number }>;
  }) => {
    const hash = JSON.stringify(e.corpo);
    const antes = recibos.get(e.chave);
    if (antes) {
      return antes.hash === hash
        ? { tipo: "replay", resposta: antes.resposta, status: antes.status }
        : { tipo: "conflito" };
    }
    const r = await e.executar();
    recibos.set(e.chave, { hash, ...r });
    return { tipo: "executou", ...r };
  },
}));

const LOJAS_ERP = [
  { codigo: "001", sigla: "CTR", nome: "Centro (nome do ERP)", endereco: "Rua A", ativa: true },
  { codigo: "005", sigla: "LST", nome: "Leste", endereco: "Rua B", ativa: true },
];

function como(org: string, papelOk = true) {
  vi.mocked(requireRole).mockResolvedValue(
    papelOk
      ? ({ ok: true, user: { id: USER }, org: { orgId: org, name: "O", role: "manager" } } as never)
      : ({ ok: false, response: fail("forbidden_role", "Papel insuficiente.", 403, {}) } as never),
  );
}

const post = (corpo: unknown, chave?: string) =>
  POST(
    new NextRequest("http://localhost/api/v1/pdv/lojas", {
      method: "POST",
      body: JSON.stringify(corpo),
      headers: chave ? { "Idempotency-Key": chave } : {},
    }),
  );
const patch = (corpo: unknown, id = LOJA_ID) =>
  PATCH(
    new NextRequest(`http://localhost/api/v1/pdv/lojas/${id}`, { method: "PATCH", body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  recibos = new Map();
  tabelas = {
    pdv_stores: [],
    channel_sessions: [
      { id: CONEXAO_A, organization_id: ORG_A },
      { id: CONEXAO_B, organization_id: ORG_B },
    ],
  };
  vi.mocked(moduloLigado).mockResolvedValue(true);
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(listarLojas).mockResolvedValue(LOJAS_ERP);
  vi.mocked(createClient).mockResolvedValue(fakeSupabase() as never);
});

describe("POST /api/v1/pdv/lojas", () => {
  it("grava código, sigla e nome vindos do ERP e audita", async () => {
    como(ORG_A);
    const res = await post({ lojas: [{ codigo: "001", sigla: "CTR" }] });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.adicionadas).toHaveLength(1);
    expect(lojas()[0]).toMatchObject({
      organization_id: ORG_A,
      erp_store_code: "001",
      sigla: "CTR",
      nome: "Centro (nome do ERP)",
    });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      action: "pdv.store.updated",
      organizationId: ORG_A,
      actorUserId: USER,
    });
  });

  it("ignora nome e organization_id mandados no corpo", async () => {
    como(ORG_A);
    await post({ lojas: [{ codigo: "001", sigla: "CTR", nome: "Hackeada", organization_id: ORG_B }] });
    expect(lojas()[0]).toMatchObject({ organization_id: ORG_A, nome: "Centro (nome do ERP)" });
  });

  it("recusa 422 a loja que o ERP não tem (ou com sigla diferente) e não grava nada", async () => {
    como(ORG_A);
    const res = await post({ lojas: [{ codigo: "001", sigla: "CTR" }, { codigo: "999", sigla: "XXX" }] });
    expect(res.status).toBe(422);
    expect((await res.json()).error.details.codigos_nao_encontrados).toEqual(["999"]);
    expect(lojas()).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("adicionar loja que já existe não duplica, responde 200 e não audita", async () => {
    como(ORG_A);
    await post({ lojas: [{ codigo: "001", sigla: "CTR" }] });
    vi.mocked(audit).mockClear();
    const res = await post({ lojas: [{ codigo: "001", sigla: "CTR" }] });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.adicionadas).toHaveLength(0);
    expect(data.ja_existiam).toHaveLength(1);
    expect(lojas()).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("Idempotency-Key: o replay devolve a mesma resposta sem reexecutar", async () => {
    como(ORG_A);
    const a = await post({ lojas: [{ codigo: "001", sigla: "CTR" }] }, CHAVE);
    const b = await post({ lojas: [{ codigo: "001", sigla: "CTR" }] }, CHAVE);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await b.json()).toEqual(await a.json());
    expect(listarLojas).toHaveBeenCalledTimes(1);
    expect(lojas()).toHaveLength(1);
  });

  it("mesma chave com corpo diferente devolve 409 idempotency_conflict", async () => {
    como(ORG_A);
    await post({ lojas: [{ codigo: "001", sigla: "CTR" }] }, CHAVE);
    const res = await post({ lojas: [{ codigo: "005", sigla: "LST" }] }, CHAVE);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("idempotency_conflict");
  });

  it("chave que não é UUID devolve 400", async () => {
    como(ORG_A);
    expect((await post({ lojas: [{ codigo: "001", sigla: "CTR" }] }, "abc")).status).toBe(400);
  });

  it("corpo inválido ou vazio devolve 422", async () => {
    como(ORG_A);
    expect((await post({ lojas: [] })).status).toBe(422);
    expect((await post(null)).status).toBe(422);
  });

  it("papel abaixo de manager é recusado antes de falar com o ERP", async () => {
    como(ORG_A, false);
    expect((await post({ lojas: [{ codigo: "001", sigla: "CTR" }] })).status).toBe(403);
    expect(listarLojas).not.toHaveBeenCalled();
  });

  it("módulo desligado devolve 404", async () => {
    como(ORG_A);
    vi.mocked(moduloLigado).mockResolvedValue(false);
    expect((await post({ lojas: [{ codigo: "001", sigla: "CTR" }] })).status).toBe(404);
  });

  it("acompanhamento somente leitura é recusado antes do efeito", async () => {
    como(ORG_A);
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "leitura", 403) as never);
    expect((await post({ lojas: [{ codigo: "001", sigla: "CTR" }] })).status).toBe(403);
    expect(listarLojas).not.toHaveBeenCalled();
  });

  it("ERP não configurado devolve 409 e ERP fora do ar devolve 502", async () => {
    como(ORG_A);
    vi.mocked(listarLojas).mockRejectedValueOnce(new ErpPdvError("erp_nao_configurado", "sem servidor"));
    expect((await post({ lojas: [{ codigo: "001", sigla: "CTR" }] })).status).toBe(409);
    vi.mocked(listarLojas).mockRejectedValueOnce(new ErpPdvError("erp_indisponivel", "fora"));
    expect((await post({ lojas: [{ codigo: "001", sigla: "CTR" }] })).status).toBe(502);
  });

  it("o mesmo código no tenant B é loja separada (único por organização)", async () => {
    como(ORG_A);
    await post({ lojas: [{ codigo: "001", sigla: "CTR" }] });
    como(ORG_B);
    const res = await post({ lojas: [{ codigo: "001", sigla: "CTR" }] });
    expect(res.status).toBe(201);
    expect(lojas().map((l) => l.organization_id)).toEqual([ORG_A, ORG_B]);
  });
});

describe("PATCH /api/v1/pdv/lojas/{id}", () => {
  beforeEach(() => {
    tabelas.pdv_stores = [
      { id: LOJA_ID, organization_id: ORG_A, erp_store_code: "001", sigla: "CTR", nome: "Centro", ativa: true, channel_session_id: null },
    ];
  });

  it("altera ativa e a conexão do próprio tenant, e audita", async () => {
    como(ORG_A);
    const res = await patch({ ativa: false, channel_session_id: CONEXAO_A });
    expect(res.status).toBe(200);
    expect(lojas()[0]).toMatchObject({ ativa: false, channel_session_id: CONEXAO_A });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({
      action: "pdv.store.updated",
      resourceId: LOJA_ID,
      organizationId: ORG_A,
    });
  });

  it("conexão de outro tenant devolve 422 e não grava nem audita", async () => {
    como(ORG_A);
    const res = await patch({ channel_session_id: CONEXAO_B });
    expect(res.status).toBe(422);
    expect(lojas()[0]!.channel_session_id).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });

  it("null desliga a conexão", async () => {
    como(ORG_A);
    lojas()[0]!.channel_session_id = CONEXAO_A;
    expect((await patch({ channel_session_id: null })).status).toBe(200);
    expect(lojas()[0]!.channel_session_id).toBeNull();
  });

  it("loja de outro tenant devolve 404", async () => {
    como(ORG_B);
    expect((await patch({ ativa: false })).status).toBe(404);
    expect(lojas()[0]!.ativa).toBe(true);
  });

  it("recusa corpo vazio, campo estranho (nome) e id que não é UUID", async () => {
    como(ORG_A);
    expect((await patch({})).status).toBe(422);
    expect((await patch({ nome: "x" })).status).toBe(422);
    expect((await patch({ ativa: true }, "nao-uuid")).status).toBe(404);
  });

  it("papel abaixo de manager devolve 403, módulo desligado 404, suporte leitura 403", async () => {
    como(ORG_A, false);
    expect((await patch({ ativa: false })).status).toBe(403);
    como(ORG_A);
    vi.mocked(moduloLigado).mockResolvedValue(false);
    expect((await patch({ ativa: false })).status).toBe(404);
    vi.mocked(moduloLigado).mockResolvedValue(true);
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "leitura", 403) as never);
    expect((await patch({ ativa: false })).status).toBe(403);
    expect(lojas()[0]!.ativa).toBe(true);
  });
});
