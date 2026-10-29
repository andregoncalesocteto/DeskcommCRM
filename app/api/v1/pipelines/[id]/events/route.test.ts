import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { comIdempotencia } from "@/lib/api/idempotency";
import { fail } from "@/lib/api/wrappers";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";
import { criarBancoFalso, type Linha, type OpcoesDoBancoFalso } from "../../../../../../tests/helpers/banco-falso-de-eventos";

import { GET, POST } from "./route";

/**
 * GET /api/v1/pipelines/[id]/events — o cadastro de eventos do funil, com os sinais de uso.
 *
 * O banco é um dublê que APLICA os filtros (organização, funil por junção, chave do evento, janela de 7 dias) e a
 * ordenação: apagar um `.eq` da rota deixa um teste vermelho, em vez de passar por causa de uma linha fixa.
 */

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
// A chave continua sendo lida de verdade; o recibo (tabela idempotency_keys) é um espião.
vi.mock("@/lib/api/idempotency", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  comIdempotencia: vi.fn(),
}));

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
  vi.mocked(audit).mockClear();
  vi.mocked(requireSupportWrite).mockReset();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(comIdempotencia).mockReset();
  vi.mocked(comIdempotencia).mockImplementation(async (e) => {
    const r = await e.executar();
    return { tipo: "executou", resposta: r.resposta, status: r.status } as never;
  });
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

// ---------------------------------------------------------------------------
// POST: criar um evento
// ---------------------------------------------------------------------------

const ETAPA_OK = "66666666-6666-4666-8666-666666666601";
const ETAPA_ARQUIVADA = "66666666-6666-4666-8666-666666666602";
const ETAPA_PERDA = "66666666-6666-4666-8666-666666666603";
const ETAPA_OUTRO_FUNIL = "66666666-6666-4666-8666-666666666604";
const ETAPA_OUTRA_ORG = "66666666-6666-4666-8666-666666666605";

function tabelasDoPost() {
  const t = tabelas();
  t.crm_pipeline_events = [];
  (t.crm_pipelines[0] as Linha).settings = { fields: [{ key: "forma_pagamento" }, { key: "cupom" }] };
  return {
    ...t,
    crm_stages: [
      { id: ETAPA_OK, name: "Compras", organization_id: ORG, pipeline_id: FUNIL, is_archived: false, is_lost: false },
      { id: ETAPA_ARQUIVADA, name: "Velha", organization_id: ORG, pipeline_id: FUNIL, is_archived: true, is_lost: false },
      { id: ETAPA_PERDA, name: "Cancelado", organization_id: ORG, pipeline_id: FUNIL, is_archived: false, is_lost: true },
      { id: ETAPA_OUTRO_FUNIL, name: "De outro funil", organization_id: ORG, pipeline_id: OUTRO_FUNIL, is_archived: false, is_lost: false },
      { id: ETAPA_OUTRA_ORG, name: "De outra loja", organization_id: OUTRA_ORG, pipeline_id: FUNIL, is_archived: false, is_lost: false },
    ] as Linha[],
  };
}

const reqPost = (corpo: unknown, cabecalhos: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/v1/pipelines/${FUNIL}/events`, {
    method: "POST",
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers: { "content-type": "application/json", ...cabecalhos },
  });

async function criar(corpo: unknown, t = tabelasDoPost(), opcoes: { cabecalhos?: Record<string, string>; erroEm?: OpcoesDoBancoFalso["erroEm"] } = {}) {
  const banco = criarBancoFalso(t as never, { erroEm: opcoes.erroEm });
  vi.mocked(createClient).mockResolvedValue(banco.client);
  const r = await POST(reqPost(corpo, opcoes.cabecalhos), ctx);
  return { r, corpo: await r.json(), banco, t };
}
const inserts = (banco: ReturnType<typeof criarBancoFalso>) => banco.chamadas.filter((c) => c.operacao === "insert" && c.tabela === "crm_pipeline_events");

const VALIDO = { key: "purchase", label: "Compra" };

describe("POST /pipelines/[id]/events: criar", () => {
  it("⭐ cria o evento com os padrões, a organização da SESSÃO e o funil do CAMINHO; audita", async () => {
    const { r, corpo, banco } = await criar({ ...VALIDO, stage_id: ETAPA_OK, state_key: "pedido", value_path: "value", value_unit: "reais", dedupe_path: "order_id", respects_manual_move: false });
    expect(r.status).toBe(201);
    expect(corpo.data.avisos).toEqual([]);
    expect(corpo.data.evento).toMatchObject({
      key: "purchase", label: "Compra", stage_id: ETAPA_OK, state_key: "pedido", value_path: "value", value_unit: "reais",
      dedupe_path: "order_id", respects_manual_move: false, is_active: true,
    });
    expect(inserts(banco)).toHaveLength(1);
    expect(inserts(banco)[0]!.valores).toMatchObject({ organization_id: ORG, pipeline_id: FUNIL, key: "purchase" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "pipeline_event.created", actorUserId: USER, organizationId: ORG, resourceType: "crm_pipeline_event",
      metadata: expect.objectContaining({ pipeline_id: FUNIL, key: "purchase", stage_id: ETAPA_OK }),
    }));
  });

  it("o cadastro mínimo (chave e nome) nasce ativo, respeitando o movimento manual e sem etapa", async () => {
    const { r, corpo } = await criar(VALIDO);
    expect(r.status).toBe(201);
    expect(corpo.data.evento).toMatchObject({ stage_id: null, respects_manual_move: true, is_active: true, state_key: null, value_path: null });
  });

  it("⭐ organization_id e pipeline_id no CORPO são recusados: a organização sai da sessão", async () => {
    const { r, banco } = await criar({ ...VALIDO, organization_id: OUTRA_ORG, pipeline_id: OUTRO_FUNIL });
    expect(r.status).toBe(422);
    expect(inserts(banco)).toHaveLength(0);
  });

  it("suporte temporário sem escrita: recusa antes de qualquer efeito", async () => {
    vi.mocked(requireSupportWrite).mockResolvedValue(fail("forbidden", "Somente leitura.", 403, { requestId: "x" }) as never);
    const { r, banco } = await criar(VALIDO);
    expect(r.status).toBe(403);
    expect(banco.chamadas).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("papel insuficiente: a recusa do requireRole, sem tocar o banco", async () => {
    autorizar(false);
    const { r, banco } = await criar(VALIDO);
    expect(r.status).toBe(403);
    expect(banco.chamadas).toHaveLength(0);
  });

  it("funil de OUTRA organização: 404 e nada é gravado", async () => {
    const t = tabelasDoPost();
    t.crm_pipelines = [{ id: FUNIL, organization_id: OUTRA_ORG }];
    const { r, banco } = await criar(VALIDO, t);
    expect(r.status).toBe(404);
    expect(inserts(banco)).toHaveLength(0);
  });
});

describe("POST: o corpo", () => {
  it.each([
    ["chave com maiúscula", { key: "Compra", label: "x" }],
    ["chave começando por número", { key: "1compra", label: "x" }],
    ["sem nome", { key: "compra", label: "  " }],
    ["nome grande demais", { key: "compra", label: "x".repeat(81) }],
    ["descrição grande demais", { key: "compra", label: "x", description: "y".repeat(501) }],
    ["caminho do valor sem unidade", { key: "compra", label: "x", value_path: "value" }],
    ["unidade sem caminho do valor", { key: "compra", label: "x", value_unit: "reais" }],
    ["unidade fora do vocabulário", { key: "compra", label: "x", value_path: "value", value_unit: "dolares" }],
    ["caminho com índice de lista", { key: "compra", label: "x", dedupe_path: "items[0].id" }],
    ["guardar em com hífen", { key: "compra", label: "x", state_key: "meu-estado" }],
    ["campo desconhecido", { key: "compra", label: "x", extra: 1 }],
    ["etapa que não é UUID", { key: "compra", label: "x", stage_id: "nao-e-uuid" }],
    ["corpo que não é JSON", "isto não é json"],
  ])("recusa %s (422), sem gravar", async (_nome, corpoRuim) => {
    const { r, corpo, banco } = await criar(corpoRuim);
    expect(r.status).toBe(422);
    expect(corpo.error.code).toBe("validation_failed");
    expect(inserts(banco)).toHaveLength(0);
  });

  it("aceita null para 'sem isto' nos opcionais", async () => {
    const { r } = await criar({ ...VALIDO, description: null, stage_id: null, state_key: null, value_path: null, value_unit: null, dedupe_path: null });
    expect(r.status).toBe(201);
  });
});

describe("POST: as validações contra o funil", () => {
  it.each([
    ["etapa de OUTRO funil", ETAPA_OUTRO_FUNIL, "não é deste funil"],
    ["etapa de OUTRA organização", ETAPA_OUTRA_ORG, "não é deste funil"],
    ["etapa inexistente", "66666666-6666-4666-8666-6666666666ff", "não é deste funil"],
    ["etapa arquivada", ETAPA_ARQUIVADA, "arquivada"],
    ["etapa de perda", ETAPA_PERDA, "é de perda"],
  ])("%s: 422 com a razão em português, e nada é gravado", async (_nome, etapa, trecho) => {
    const { r, corpo, banco } = await criar({ ...VALIDO, stage_id: etapa });
    expect(r.status).toBe(422);
    expect(corpo.error.message).toContain(trecho);
    expect(inserts(banco)).toHaveLength(0);
  });

  it("⭐ 'guardar em' igual à chave de um campo declarado da ficha: 422 (sobrescreveria um campo que a equipe edita)", async () => {
    const { r, corpo, banco } = await criar({ ...VALIDO, state_key: "forma_pagamento" });
    expect(r.status).toBe(422);
    expect(corpo.error.message).toContain("«forma_pagamento» já é um campo da ficha");
    expect(inserts(banco)).toHaveLength(0);
  });

  it("⭐ 'guardar em' já usado por OUTRO evento do funil: salva e devolve o aviso", async () => {
    const t = tabelasDoPost();
    t.crm_pipeline_events = [cadastro("begin_checkout", { label: "Revisão", state_key: "pedido" })];
    const { r, corpo, banco } = await criar({ ...VALIDO, state_key: "pedido" }, t);
    expect(r.status).toBe(201);
    expect(corpo.data.avisos).toHaveLength(1);
    expect(corpo.data.avisos[0]).toContain("«Revisão» já guarda o conteúdo em «pedido»");
    expect(inserts(banco)).toHaveLength(1);
  });

  it("'guardar em' usado só em OUTRO funil ou OUTRA organização não gera aviso", async () => {
    const t = tabelasDoPost();
    t.crm_pipeline_events = [
      cadastro("a", { state_key: "pedido", pipeline_id: OUTRO_FUNIL }),
      cadastro("b", { state_key: "pedido", organization_id: OUTRA_ORG }),
    ];
    const { corpo } = await criar({ ...VALIDO, state_key: "pedido" }, t);
    expect(corpo.data.avisos).toEqual([]);
  });

  it("chave já cadastrada no funil (índice único): 409, sem auditoria", async () => {
    const { r, corpo } = await criar(VALIDO, tabelasDoPost(), {
      erroEm: (tabela, operacao) => (tabela === "crm_pipeline_events" && operacao === "insert" ? { code: "23505", message: "duplicate" } : null),
    });
    expect(r.status).toBe(409);
    expect(corpo.error.code).toBe("state_conflict");
    expect(corpo.error.message).toContain("«purchase»");
    expect(audit).not.toHaveBeenCalled();
  });

  it("erro do banco no insert: 500 e sem auditoria", async () => {
    const { r } = await criar(VALIDO, tabelasDoPost(), {
      erroEm: (tabela, operacao) => (tabela === "crm_pipeline_events" && operacao === "insert" ? { message: "queda" } : null),
    });
    expect(r.status).toBe(500);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("POST: Idempotency-Key", () => {
  const CHAVE = "99999999-9999-4999-8999-999999999999";

  it("sem a chave, não há recibo", async () => {
    await criar(VALIDO);
    expect(comIdempotencia).not.toHaveBeenCalled();
  });

  it("chave que não é UUID: 400, sem gravar", async () => {
    const { r, banco } = await criar(VALIDO, tabelasDoPost(), { cabecalhos: { "Idempotency-Key": "abc" } });
    expect(r.status).toBe(400);
    expect(inserts(banco)).toHaveLength(0);
  });

  it("com a chave, o recibo é do endpoint DESTE funil e do corpo já validado", async () => {
    const { r } = await criar(VALIDO, tabelasDoPost(), { cabecalhos: { "Idempotency-Key": CHAVE } });
    expect(r.status).toBe(201);
    expect(comIdempotencia).toHaveBeenCalledTimes(1);
    expect(vi.mocked(comIdempotencia).mock.calls[0]![0]).toMatchObject({
      organizationId: ORG, endpoint: `/api/v1/pipelines/${FUNIL}/events`, chave: CHAVE, corpo: VALIDO,
    });
  });

  it("⭐ replay: devolve a resposta gravada (201) e NÃO grava de novo nem audita", async () => {
    vi.mocked(comIdempotencia).mockResolvedValue({ tipo: "replay", resposta: { evento: { id: "ja-existe" }, avisos: [] }, status: 201 } as never);
    const { r, corpo, banco } = await criar(VALIDO, tabelasDoPost(), { cabecalhos: { "Idempotency-Key": CHAVE } });
    expect(r.status).toBe(201);
    expect(corpo.data.evento.id).toBe("ja-existe");
    expect(inserts(banco)).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("mesma chave com outro conteúdo: 409 idempotency_conflict", async () => {
    vi.mocked(comIdempotencia).mockResolvedValue({ tipo: "conflito" } as never);
    const { r, corpo } = await criar(VALIDO, tabelasDoPost(), { cabecalhos: { "Idempotency-Key": CHAVE } });
    expect(r.status).toBe(409);
    expect(corpo.error.code).toBe("idempotency_conflict");
  });

  it("primeira execução ainda em curso: 409 idempotency_in_progress", async () => {
    vi.mocked(comIdempotencia).mockResolvedValue({ tipo: "em_curso" } as never);
    const { r, corpo } = await criar(VALIDO, tabelasDoPost(), { cabecalhos: { "Idempotency-Key": CHAVE } });
    expect(r.status).toBe(409);
    expect(corpo.error.code).toBe("idempotency_in_progress");
  });

  it("chave duplicada DENTRO do recibo: 409 e o recibo não é gravado (a exceção sobe)", async () => {
    // O espião real executa o efeito; a exceção do efeito sobe até a rota.
    const { r, corpo } = await criar(VALIDO, tabelasDoPost(), {
      cabecalhos: { "Idempotency-Key": CHAVE },
      erroEm: (tabela, operacao) => (tabela === "crm_pipeline_events" && operacao === "insert" ? { code: "23505", message: "dup" } : null),
    });
    expect(r.status).toBe(409);
    expect(corpo.error.code).toBe("state_conflict");
  });
});

