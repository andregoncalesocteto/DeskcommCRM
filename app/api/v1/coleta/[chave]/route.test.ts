import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarEventosDoFunil } from "@/lib/leads/eventos-do-funil/registrar";
import { identificarPedido } from "@/lib/tracker/identificar-pedido";
import { PUBLIC_PATHS } from "@/lib/auth/public-paths";
import { criarBancoFalso, type Linha } from "../../../../../tests/helpers/banco-falso-de-eventos";

import { OPTIONS, POST } from "./route";

/**
 * A porta pública de coleta: chave, origem, CORS e o que chega à operação de registro.
 * O banco é um dublê que APLICA os filtros (chave, ativa, revogada): apagar um `.eq` da resolução deixa teste vermelho.
 */

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/leads/eventos-do-funil/registrar", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registrarEventosDoFunil: vi.fn(async () => ({ lead_id: "x", resultados: [] })),
}));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/tracker/identificar-pedido", () => ({ identificarPedido: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const FUNIL = "44444444-4444-4444-8444-444444444444";
const PEDIDO = "77777777-7777-4777-8777-777777777777";
const CHAVE = `pk_${"a1".repeat(18)}`;
const CHAVE_REVOGADA = `pk_${"b2".repeat(18)}`;
const ORIGEM = "https://loja.exemplo";

function tabelas() {
  const base = { organization_id: ORG, pipeline_id: FUNIL, allowed_origins: [ORIGEM, "http://localhost:3000"] };
  return {
    crm_tracker_public_keys: [
      { id: "k1", public_key: CHAVE, is_active: true, revoked_at: null, ...base },
      { id: "k2", public_key: CHAVE_REVOGADA, is_active: false, revoked_at: "2026-10-01T00:00:00Z", ...base },
    ] as Linha[],
    crm_pipeline_events: [
      { organization_id: ORG, pipeline_id: FUNIL, key: "purchase", is_active: true },
      { organization_id: ORG, pipeline_id: FUNIL, key: "page_view", is_active: true },
      { organization_id: ORG, pipeline_id: FUNIL, key: "antigo", is_active: false },
      { organization_id: OUTRA_ORG, pipeline_id: FUNIL, key: "da_outra_org", is_active: true },
    ] as Linha[],
  };
}

const eventos = [{ event: "page_view", event_id: "e1", data: { screen_name: "home" } }];
const corpo = (extra: Record<string, unknown> = {}) => JSON.stringify({ idtrack: "x", events: eventos, ...extra });

const ctx = (chave = CHAVE) => ({ params: Promise.resolve({ chave }) });
const post = (texto: string, origin: string | null = ORIGEM, chave = CHAVE) =>
  POST(
    new NextRequest(`http://localhost/api/v1/coleta/${chave}`, {
      method: "POST",
      body: texto,
      headers: { "content-type": "text/plain", ...(origin ? { origin } : {}) },
    }),
    ctx(chave),
  );
const preflight = (origin: string | null, chave = CHAVE) =>
  OPTIONS(
    new NextRequest(`http://localhost/api/v1/coleta/${chave}`, { method: "OPTIONS", headers: origin ? { origin } : {} }),
    ctx(chave),
  );

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(createAdminClient).mockReturnValue(criarBancoFalso(tabelas() as never).client as never);
  vi.mocked(registrarEventosDoFunil).mockReset();
  vi.mocked(registrarEventosDoFunil).mockResolvedValue({ lead_id: "x", resultados: [] });
  vi.mocked(identificarPedido).mockReset();
  vi.mocked(identificarPedido).mockResolvedValue(PEDIDO);
  vi.mocked(checkRateLimit).mockReset();
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, count: 1, limit: 60, window_sec: 60 });
});

describe("o caminho é público para o proxy, e só o formato exato da chave", () => {
  const publico = (p: string) => PUBLIC_PATHS.some((re) => re.test(p));
  it("aceita /api/v1/coleta/<chave>", () => expect(publico(`/api/v1/coleta/${CHAVE}`)).toBe(true));
  it.each([
    "/api/v1/coleta",
    "/api/v1/coleta/",
    "/api/v1/coleta/pk_curta",
    `/api/v1/coleta/${CHAVE}/extra`,
    `/api/v1/coleta/${CHAVE.toUpperCase()}`,
    "/api/v1/coleta/qualquer",
  ])("não libera %s", (p) => expect(publico(p)).toBe(false));
});

describe("OPTIONS (preflight)", () => {
  it("origem da chave: 204 com os cabeçalhos de CORS só para ela", async () => {
    const r = await preflight(ORIGEM);
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGEM);
    expect(r.headers.get("access-control-allow-methods")).toContain("POST");
    expect(r.headers.get("vary")).toBe("Origin");
  });

  it("⭐ origem fora da lista: 403 e NENHUM cabeçalho de CORS", async () => {
    const r = await preflight("https://invasor.exemplo");
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("sem Origin: 403; chave revogada ou desconhecida: 404 sem CORS", async () => {
    expect((await preflight(null)).status).toBe(403);
    const revogada = await preflight(ORIGEM, CHAVE_REVOGADA);
    expect(revogada.status).toBe(404);
    expect(revogada.headers.get("access-control-allow-origin")).toBeNull();
    expect((await preflight(ORIGEM, `pk_${"c3".repeat(18)}`)).status).toBe(404);
    expect((await preflight(ORIGEM, "pk_malformada")).status).toBe(404);
  });
});

describe("POST", () => {
  it("⭐ organização e funil vêm SÓ da chave; o ator é a chave; responde 200 com CORS", async () => {
    const r = await post(corpo());
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGEM);
    expect(registrarEventosDoFunil).toHaveBeenCalledTimes(1);
    const entrada = vi.mocked(registrarEventosDoFunil).mock.calls[0]![1];
    expect(entrada).toMatchObject({
      organizationId: ORG, leadId: PEDIDO, actor: { type: "webhook_source", id: "k1" }, eventos, origem: "navegador", chaveId: "k1",
    });
    expect(vi.mocked(identificarPedido).mock.calls[0]![1]).toMatchObject({ organizationId: ORG, pipelineId: FUNIL });
  });

  it("⭐ organization_id, pipeline_id e lead_id no corpo são recusados (422) e nada é registrado", async () => {
    for (const intruso of [{ organization_id: "x" }, { pipeline_id: "x" }, { lead_id: PEDIDO }]) {
      expect((await post(corpo(intruso))).status).toBe(422);
    }
    expect(registrarEventosDoFunil).not.toHaveBeenCalled();
  });

  it("⭐ origem não listada: 403 sem CORS e nada registrado", async () => {
    const r = await post(corpo(), "https://invasor.exemplo");
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    expect(registrarEventosDoFunil).not.toHaveBeenCalled();
  });

  it("sem cabeçalho Origin (curl, servidor): 403", async () => {
    expect((await post(corpo(), null)).status).toBe(403);
    expect(registrarEventosDoFunil).not.toHaveBeenCalled();
  });

  it("⭐ chave revogada, desconhecida e malformada: a MESMA resposta 404, sem registrar", async () => {
    const respostas = await Promise.all([
      post(corpo(), ORIGEM, CHAVE_REVOGADA),
      post(corpo(), ORIGEM, `pk_${"c3".repeat(18)}`),
      post(corpo(), ORIGEM, "pk_malformada"),
    ]);
    expect(respostas.map((r) => r.status)).toEqual([404, 404, 404]);
    const corpos = await Promise.all(respostas.map((r) => r.json().then((j) => j.error.code + j.error.message)));
    expect(new Set(corpos).size).toBe(1);
    expect(registrarEventosDoFunil).not.toHaveBeenCalled();
  });

  it("lote de 20 passa; 21 é recusado", async () => {
    const lote = (n: number) => Array.from({ length: n }, (_, i) => ({ event: "page_view", event_id: `e${i}` }));
    expect((await post(JSON.stringify({ events: lote(20) }))).status).toBe(200);
    expect((await post(JSON.stringify({ events: lote(21) }))).status).toBe(422);
  });

  it.each([
    ["vazio", ""],
    ["não é JSON", "{"],
    ["sem eventos", JSON.stringify({ events: [] })],
    ["evento sem event_id", JSON.stringify({ events: [{ event: "page_view" }] })],
    ["nome de evento fora do padrão", JSON.stringify({ events: [{ event: "Page View", event_id: "1" }] })],
    ["campo desconhecido no evento", JSON.stringify({ events: [{ event: "a", event_id: "1", extra: 1 }] })],
  ])("corpo inválido (%s): 422 com CORS e nada registrado", async (_nome, texto) => {
    const r = await post(texto);
    expect(r.status).toBe(422);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGEM);
    expect(registrarEventosDoFunil).not.toHaveBeenCalled();
  });

  it("corpo acima de 64 KB é recusado", async () => {
    const grande = JSON.stringify({ events: [{ event: "page_view", event_id: "1", data: { texto: "x".repeat(70_000) } }] });
    expect((await post(grande)).status).toBe(422);
  });

  it("pedido não identificado: 200 igual, e a operação de registro não roda", async () => {
    vi.mocked(identificarPedido).mockResolvedValue(null);
    const r = await post(corpo());
    expect(r.status).toBe(200);
    expect(registrarEventosDoFunil).not.toHaveBeenCalled();
  });

  it("falha interna na operação: 500 sem vazar a mensagem, ainda com CORS", async () => {
    vi.mocked(registrarEventosDoFunil).mockRejectedValue(new Error("detalhe interno do banco"));
    const r = await post(corpo());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("detalhe interno");
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGEM);
  });
});

describe("limite de taxa", () => {
  const estourar = (balde: string) =>
    vi.mocked(checkRateLimit).mockImplementation(async (b, limit) => ({
      allowed: !b.startsWith(balde), count: limit + 1, limit, window_sec: 60,
    }));

  it("⭐ o contador por IP estourado: 429 com Retry-After (1 a 60) e CORS, sem registrar", async () => {
    estourar("coleta:ip:");
    const r = await post(corpo());
    expect(r.status).toBe(429);
    const espera = Number(r.headers.get("retry-after"));
    expect(espera).toBeGreaterThanOrEqual(1);
    expect(espera).toBeLessThanOrEqual(60);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGEM);
    expect(registrarEventosDoFunil).not.toHaveBeenCalled();
  });

  it("⭐ o contador por chave estourado: 429 também", async () => {
    estourar("coleta:chave:");
    const r = await post(corpo());
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).not.toBeNull();
    expect(registrarEventosDoFunil).not.toHaveBeenCalled();
  });

  it("os contadores levam a chave (não vazam de um site para outro) e o IP do cliente", async () => {
    await POST(
      new NextRequest(`http://localhost/api/v1/coleta/${CHAVE}`, {
        method: "POST", body: corpo(), headers: { origin: ORIGEM, "x-forwarded-for": "203.0.113.9" },
      }),
      ctx(),
    );
    const baldes = vi.mocked(checkRateLimit).mock.calls.map((c) => c[0]);
    expect(baldes).toContain("coleta:ip:k1:203.0.113.9");
    expect(baldes).toContain("coleta:chave:k1");
  });

  it("origem recusada e chave desconhecida nem chegam a gastar contador", async () => {
    await post(corpo(), "https://invasor.exemplo");
    await post(corpo(), ORIGEM, "pk_malformada");
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("a resposta não vaza e não varia com o pedido", () => {
  it("⭐ idtrack que não acha pedido e idtrack válido recebem o MESMO corpo, sem efeito na forma", async () => {
    vi.mocked(identificarPedido).mockResolvedValue(PEDIDO);
    const valido = await post(corpo());
    vi.mocked(identificarPedido).mockResolvedValue(null);
    const inexistente = await post(corpo({ idtrack: "ffffffff-ffff-4fff-8fff-ffffffffffff" }));
    expect(inexistente.status).toBe(valido.status);
    expect(await inexistente.json()).toEqual(await valido.json());
  });

  it("⭐ o que a operação devolve (id do pedido, etapa, valor, recusas) nunca chega ao navegador", async () => {
    vi.mocked(registrarEventosDoFunil).mockResolvedValue({
      lead_id: PEDIDO,
      resultados: [
        { event: "page_view", event_id: "e1", resultado: "registrado", estado: "aplicado", valor: "aplicado", movimento: "movido", etapa: "Compras" },
      ],
    } as never);
    const texto = JSON.stringify(await (await post(corpo())).json());
    expect(texto).not.toContain(PEDIDO);
    expect(texto).not.toContain("Compras");
    expect(texto).not.toContain("movido");
    expect(JSON.parse(texto).data).toEqual({ eventos: [{ event_id: "e1", resultado: "recebido" }] });
  });

  it("evento que o funil recusaria também volta como recebido (a recusa não é oráculo)", async () => {
    vi.mocked(registrarEventosDoFunil).mockResolvedValue({
      lead_id: PEDIDO,
      resultados: [{ event: "page_view", event_id: "e1", resultado: "recusado", codigo: "evento_nao_cadastrado", mensagem: "m" }],
    } as never);
    const j = await (await post(corpo())).json();
    expect(j.data.eventos[0].resultado).toBe("recebido");
    expect(JSON.stringify(j)).not.toContain("evento_nao_cadastrado");
  });
});

describe("modo de depuração: a lista de nomes de evento cadastrados", () => {
  it("⭐ com debug, a resposta traz SÓ os nomes ativos do funil da chave, em ordem", async () => {
    const j = await (await post(corpo({ debug: true }))).json();
    expect(j.data.chaves_cadastradas).toEqual(["page_view", "purchase"]);
  });

  it("sem debug o campo não existe", async () => {
    const j = await (await post(corpo())).json();
    expect(j.data).not.toHaveProperty("chaves_cadastradas");
  });

  it("⭐ a lista é a mesma com idtrack bom e com idtrack que não acha pedido (não revela nada do contato)", async () => {
    vi.mocked(identificarPedido).mockResolvedValue(PEDIDO);
    const bom = await (await post(corpo({ debug: true }))).json();
    vi.mocked(identificarPedido).mockResolvedValue(null);
    const ruim = await (await post(corpo({ debug: true, idtrack: "nada" }))).json();
    expect(ruim).toEqual(bom);
  });

  it("debug que não é booleano é recusado", async () => {
    expect((await post(corpo({ debug: "sim" }))).status).toBe(422);
  });
});
