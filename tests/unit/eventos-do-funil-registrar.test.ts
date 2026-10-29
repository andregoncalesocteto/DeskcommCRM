/**
 * `crm_track_event` — validação contra o CADASTRO do funil e registro no histórico.
 *
 * O que o teste guarda, em ordem de quanto custa errar:
 *
 * 1. ISOLAMENTO. A operação roda com a chave de serviço (que ignora RLS) e o `lead_id` vem do chamador. O banco
 *    falso SÓ devolve a linha quando organização (e funil) batem, então tirar um `.eq` do código deixa vermelho.
 * 2. O CONTRATO ESTRITO (ADR-0009). Evento sem cadastro ativo no funil DO PEDIDO é recusado, evento a evento, com a
 *    lista das chaves válidas; um evento recusado nunca derruba os outros do lote.
 * 3. NADA SE PERDE, NADA SE DUPLICA. Um resultado por evento, na ordem enviada; reenvio e corrida contam `repetido`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";
import {
  eventoDoFunilSchema,
  registrarEventosDoFunil,
  type EventoDoFunil,
} from "@/lib/leads/eventos-do-funil/registrar";
import { allTools } from "@/lib/mcp/tools";

// A atualização do pedido é do handler de leads (merge atômico, auditoria): aqui ele é um espião.
const atualizacoes = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({})));
const movimentos = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown> => ({})));
vi.mock("@/app/api/v1/leads/_handler", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateLeadHandler: atualizacoes,
  moveLeadHandler: movimentos,
}));

beforeEach(() => {
  atualizacoes.mockClear();
  movimentos.mockReset();
  movimentos.mockResolvedValue({});
});

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FUNIL = "f1f1f1f1-1111-4111-8111-111111111111";
const OUTRO_FUNIL = "f2f2f2f2-2222-4222-8222-222222222222";
const LEAD = "11111111-2222-4333-8444-555555555555";
const CONTATO = "99999999-8888-4777-8666-555555555555";
const AGORA = new Date("2026-10-29T18:00:00.000Z");
const ATOR: Actor = { type: "api_token", id: "tok-1", role: "agent" };

interface Linha {
  [coluna: string]: unknown;
}

/** Banco falso mínimo: só devolve a linha quando TODOS os `.eq` batem. `recusa` simula o índice único. */
/** Lê a coluna de uma linha; `payload->>campo` entra no JSON, como o PostgREST faz. */
function valorDa(l: Linha, coluna: string): unknown {
  const partes = coluna.split("->>");
  return partes.length === 2 ? (l[partes[0]!] as Linha | undefined)?.[partes[1]!] : l[coluna];
}

function bancoFalso(
  tabelas: Record<string, Linha[]>,
  recusa?: (linhas: Linha[]) => { code: string; message: string } | null,
) {
  const inseridos: Linha[] = [];
  const from = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let emIn: [string, unknown[]] | null = null;
    let ordem: { coluna: string; crescente: boolean } | null = null;
    let teto: number | null = null;
    const construtor = {
      select: () => construtor,
      order: (coluna: string, opcoes?: { ascending?: boolean }) => {
        ordem = { coluna, crescente: opcoes?.ascending !== false };
        return construtor;
      },
      limit: (n: number) => {
        teto = n;
        return construtor;
      },
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return construtor;
      },
      in: (coluna: string, valores: unknown[]) => {
        emIn = [coluna, valores];
        return construtor;
      },
      maybeSingle: async () => {
        const achou = (tabelas[tabela] ?? []).find((l) => filtros.every(([c, v]) => valorDa(l, c) === v));
        return { data: achou ?? null, error: null };
      },
      insert: async (linhas: Linha | Linha[]) => {
        const lista = Array.isArray(linhas) ? linhas : [linhas];
        const erro = recusa?.(lista) ?? null;
        if (erro) return { error: erro };
        inseridos.push(...lista);
        (tabelas[tabela] ??= []).push(...lista);
        return { error: null };
      },
      then: (resolve: (v: { data: Linha[]; error: null }) => unknown) => {
        const todas = (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, v]) => valorDa(l, c) === v));
        const filtradas = emIn
          ? todas.filter((l) => {
              const [coluna, valores] = emIn as [string, unknown[]];
              return valores.includes(valorDa(l, coluna));
            })
          : todas;
        const ordenadas = ordem
          ? [...filtradas].sort((a, b) => {
              const { coluna, crescente } = ordem as { coluna: string; crescente: boolean };
              const x = String(a[coluna]), y = String(b[coluna]);
              return (x < y ? -1 : x > y ? 1 : 0) * (crescente ? 1 : -1);
            })
          : filtradas;
        return resolve({ data: teto === null ? ordenadas : ordenadas.slice(0, teto), error: null });
      },
    };
    return construtor;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dublê mínimo do SupabaseClient
  return { client: { from } as any, inseridos };
}

const cadastro = (key: string, extra: Linha = {}): Linha => ({
  organization_id: ORG_A, pipeline_id: FUNIL, key, is_active: true, ...extra,
});

function tabelas() {
  return {
    crm_leads: [{ id: LEAD, organization_id: ORG_A, contact_id: CONTATO, pipeline_id: FUNIL }],
    contacts: [{ id: CONTATO, organization_id: ORG_A, is_personal: false }],
    crm_pipeline_events: [
      cadastro("page_view"),
      cadastro("view_item"),
      cadastro("purchase"),
      cadastro("encerrado", { is_active: false }),
    ] as Linha[],
    crm_lead_activities: [] as Linha[],
  };
}

const ev = (event: string, event_id: string, extra: Partial<EventoDoFunil> = {}): EventoDoFunil => ({ event, event_id, ...extra });
const chamar = (client: unknown, eventos: EventoDoFunil[], org = ORG_A) =>
  registrarEventosDoFunil(client as never, { organizationId: org, leadId: LEAD, actor: ATOR, eventos, agora: AGORA });

describe("o contrato da entrada", () => {
  it("event_id é OBRIGATÓRIO; o resto é como em crm_add_lead_events", () => {
    expect(eventoDoFunilSchema.safeParse({ event: "page_view" }).success).toBe(false);
    expect(eventoDoFunilSchema.safeParse({ event: "page_view", event_id: "" }).success).toBe(false);
    expect(eventoDoFunilSchema.safeParse({ event: "page_view", event_id: "e1" }).success).toBe(true);
    expect(eventoDoFunilSchema.safeParse({ event: "Page View", event_id: "e1" }).success).toBe(false);
    expect(eventoDoFunilSchema.safeParse({ event: "page_view", event_id: "e1", extra: 1 }).success).toBe(false);
    expect(eventoDoFunilSchema.safeParse({ event: "view_item", event_id: "e1", at: "2026-10-29T17:59:00-03:00", data: { a: 1 } }).success).toBe(true);
  });

  it("a ferramenta está registrada como escrita de papel agent, com o escopo de escrita", () => {
    const t = allTools.find((x) => x.name === "crm_track_event");
    expect(t).toBeDefined();
    expect(t).toMatchObject({ category: "write", requiresRole: "agent", requiresScope: "mcp:write" });
  });
});

describe("um resultado por evento, na ordem enviada", () => {
  it("lote misto: válido, desconhecido, repetido e inativo", async () => {
    const t = tabelas();
    t.crm_lead_activities.push({
      organization_id: ORG_A, lead_id: LEAD, type: "external_event", payload: { event: "view_item", event_id: "ja-gravado" },
    });
    const { client, inseridos } = bancoFalso(t);
    const r = await chamar(client, [
      ev("page_view", "e1"),
      ev("nao_existe", "e2"),
      ev("view_item", "ja-gravado"),
      ev("encerrado", "e4"),
      ev("purchase", "e5"),
    ]);

    expect(r.lead_id).toBe(LEAD);
    expect(r.resultados.map((x) => [x.event_id, x.resultado])).toEqual([
      ["e1", "registrado"],
      ["e2", "recusado"],
      ["ja-gravado", "repetido"],
      ["e4", "recusado"],
      ["e5", "registrado"],
    ]);
    expect(r.resultados[1]).toMatchObject({ codigo: "evento_nao_cadastrado" });
    expect(r.resultados[3]).toMatchObject({ codigo: "evento_inativo" });
    // Só os dois registrados viraram linha: a recusa não grava nada.
    expect(inseridos.map((l) => (l.payload as Linha).event_id)).toEqual(["e1", "e5"]);
  });

  it("recusar um evento não derruba os outros do lote", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    const r = await chamar(client, [ev("nao_existe", "x1"), ev("page_view", "x2"), ev("nao_existe_2", "x3"), ev("view_item", "x4")]);
    expect(r.resultados.map((x) => x.resultado)).toEqual(["recusado", "registrado", "recusado", "registrado"]);
    expect(inseridos).toHaveLength(2);
  });

  it("evento_nao_cadastrado lista as chaves ATIVAS, em ordem, e não cita as desativadas", async () => {
    const { client } = bancoFalso(tabelas());
    const r = await chamar(client, [ev("compra", "e1")]);
    const msg = (r.resultados[0] as { mensagem: string }).mensagem;
    expect(msg).toContain('"compra"');
    expect(msg).toContain("Eventos ativos: page_view, purchase, view_item.");
    expect(msg).not.toContain("encerrado");
  });

  it("funil sem nenhum evento ativo explica onde cadastrar", async () => {
    const t = tabelas();
    t.crm_pipeline_events = [];
    const { client } = bancoFalso(t);
    const r = await chamar(client, [ev("page_view", "e1")]);
    expect((r.resultados[0] as { mensagem: string }).mensagem).toContain("não tem eventos ativos");
  });

  it("o mesmo event_id duas vezes NO MESMO lote: o segundo é repetido", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    const r = await chamar(client, [ev("page_view", "igual"), ev("view_item", "igual")]);
    expect(r.resultados.map((x) => x.resultado)).toEqual(["registrado", "repetido"]);
    expect(inseridos).toHaveLength(1);
  });
});

describe("o que é gravado", () => {
  it("uma linha external_event por evento, com a hora do evento, o contato e o JSON", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    await chamar(client, [ev("view_item", "e1", { at: "2026-10-29T14:59:00-03:00", data: { item_id: "pz-1", price: 59.9 } })]);
    expect(inseridos).toHaveLength(1);
    const linha = inseridos[0]!;
    expect(linha).toMatchObject({ type: "external_event", organization_id: ORG_A, lead_id: LEAD, contact_id: CONTATO });
    expect(linha.performed_at).toBe("2026-10-29T17:59:00.000Z");
    expect(linha.payload).toEqual({
      event: "view_item", at: "2026-10-29T17:59:00.000Z", event_id: "e1", data: { item_id: "pz-1", price: 59.9 },
    });
  });

  it("sem `at`, a hora é a da chamada", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    await chamar(client, [ev("page_view", "e1")]);
    expect(inseridos[0]!.performed_at).toBe(AGORA.toISOString());
  });
});

describe("⭐ isolamento", () => {
  it("pedido de OUTRA organização: 404 e nada é escrito", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    const p = chamar(client, [ev("page_view", "e1")], ORG_B);
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ status: 404 });
    expect(inseridos).toHaveLength(0);
  });

  it("o cadastro de OUTRA organização não valida o evento", async () => {
    const t = tabelas();
    t.crm_pipeline_events = [cadastro("purchase", { organization_id: ORG_B })];
    const { client, inseridos } = bancoFalso(t);
    const r = await chamar(client, [ev("purchase", "e1")]);
    expect(r.resultados[0]).toMatchObject({ resultado: "recusado", codigo: "evento_nao_cadastrado" });
    expect(inseridos).toHaveLength(0);
  });

  it("o funil sai do PEDIDO: o cadastro de OUTRO funil da mesma organização não vale", async () => {
    const t = tabelas();
    t.crm_pipeline_events = [cadastro("purchase", { pipeline_id: OUTRO_FUNIL })];
    const { client } = bancoFalso(t);
    const r = await chamar(client, [ev("purchase", "e1")]);
    expect(r.resultados[0]).toMatchObject({ resultado: "recusado", codigo: "evento_nao_cadastrado" });
  });

  it("contato marcado como pessoal está fora da operação: 403", async () => {
    const t = tabelas();
    t.contacts[0]!.is_personal = true;
    const { client, inseridos } = bancoFalso(t);
    await expect(chamar(client, [ev("page_view", "e1")])).rejects.toMatchObject({ status: 403, code: "contato_pessoal" });
    expect(inseridos).toHaveLength(0);
  });
});

describe("limites", () => {
  it("o lote vazio e o lote acima de 50 são recusados inteiros (422)", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    await expect(chamar(client, [])).rejects.toMatchObject({ status: 422 });
    const muitos = Array.from({ length: 51 }, (_, i) => ev("page_view", `m-${i}`));
    await expect(chamar(client, muitos)).rejects.toMatchObject({ status: 422 });
    expect(inseridos).toHaveLength(0);
  });

  it("a chamada acima de 64 KB é recusada inteira (422)", async () => {
    const { client } = bancoFalso(tabelas());
    const grande = (i: number) => ev("view_item", `g-${i}`, { data: { texto: "x".repeat(7_000) } });
    await expect(chamar(client, Array.from({ length: 10 }, (_, i) => grande(i)))).rejects.toMatchObject({ status: 422 });
  });

  it("evento acima de 8 KB: recusado SÓ ele (evento_grande)", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    const r = await chamar(client, [
      ev("view_item", "pequeno"),
      ev("view_item", "grande", { data: { texto: "x".repeat(9_000) } }),
    ]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado" });
    expect(r.resultados[1]).toMatchObject({ resultado: "recusado", codigo: "evento_grande" });
    expect(inseridos).toHaveLength(1);
  });

  it.each([
    ["hora no futuro", "2026-10-29T18:10:00.000Z"],
    ["hora com mais de 30 dias", "2026-09-20T00:00:00.000Z"],
  ])("%s: recusado SÓ ele (hora_fora_da_janela)", async (_nome, at) => {
    const { client, inseridos } = bancoFalso(tabelas());
    const r = await chamar(client, [ev("page_view", "ok"), ev("page_view", "fora", { at })]);
    expect(r.resultados.map((x) => x.resultado)).toEqual(["registrado", "recusado"]);
    expect(r.resultados[1]).toMatchObject({ codigo: "hora_fora_da_janela" });
    expect(inseridos).toHaveLength(1);
  });

  it("até 5 minutos no futuro é tolerado (relógio de aparelho adianta)", async () => {
    const { client } = bancoFalso(tabelas());
    const r = await chamar(client, [ev("page_view", "e1", { at: "2026-10-29T18:04:00.000Z" })]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado" });
  });
});

describe("corrida: o banco recusa o event_id repetido (23505)", () => {
  it("o lote cai por UM event_id que outra chamada gravou: os outros gravam e esse volta repetido", async () => {
    const colide = (linhas: Linha[]) =>
      linhas.some((l) => (l.payload as Linha).event_id === "disputado") ? { code: "23505", message: "duplicate" } : null;
    const { client, inseridos } = bancoFalso(tabelas(), colide);
    const r = await chamar(client, [ev("page_view", "a"), ev("view_item", "disputado"), ev("purchase", "c")]);
    expect(r.resultados.map((x) => [x.event_id, x.resultado])).toEqual([
      ["a", "registrado"], ["disputado", "repetido"], ["c", "registrado"],
    ]);
    expect(inseridos.map((l) => (l.payload as Linha).event_id)).toEqual(["a", "c"]);
  });

  it("erro que não é de unicidade é falha: 500", async () => {
    const { client } = bancoFalso(tabelas(), () => ({ code: "XX000", message: "queda" }));
    await expect(chamar(client, [ev("page_view", "a")])).rejects.toMatchObject({ status: 500 });
  });
});

// ---------------------------------------------------------------------------
// repetição de negócio, estado e valor
// ---------------------------------------------------------------------------

function tabelasCom(cadastros: Linha[], extra: { status?: string; atividades?: Linha[] } = {}) {
  const t = tabelas();
  t.crm_pipeline_events = cadastros;
  if (extra.status) (t.crm_leads[0] as Linha).status = extra.status;
  if (extra.atividades) t.crm_lead_activities.push(...extra.atividades);
  return t;
}

const atividade = (event: string, event_id: string, performed_at: string, data?: Linha): Linha => ({
  organization_id: ORG_A, lead_id: LEAD, type: "external_event", performed_at,
  payload: { event, event_id, at: performed_at, ...(data ? { data } : {}) },
});

const CARRINHO = cadastro("cart_sync", { state_key: "cart" });
const COMPRA = cadastro("purchase", { state_key: "pedido", value_path: "value", value_unit: "reais", dedupe_path: "order_id" });
const hora = (min: number) => new Date(Date.UTC(2026, 9, 29, 17, min)).toISOString();
const ultimaAtualizacao = () => atualizacoes.mock.calls.at(-1) as unknown[];

describe("repetição de negócio (dedupe_path)", () => {
  it("o mesmo order_id com OUTRO event_id: repetido, e nada é gravado nem atualizado", async () => {
    const { client, inseridos } = bancoFalso(
      tabelasCom([COMPRA], { atividades: [atividade("purchase", "antigo", hora(0), { order_id: "PED-1", value: 50 })] }),
    );
    const r = await chamar(client, [ev("purchase", "novo", { data: { order_id: "PED-1", value: 60 } })]);
    expect(r.resultados[0]).toEqual({ event: "purchase", event_id: "novo", resultado: "repetido" });
    expect(inseridos).toHaveLength(0);
    expect(atualizacoes).not.toHaveBeenCalled();
  });

  it("order_id diferente é outro fato: registra", async () => {
    const { client, inseridos } = bancoFalso(
      tabelasCom([COMPRA], { atividades: [atividade("purchase", "antigo", hora(0), { order_id: "PED-1", value: 50 })] }),
    );
    const r = await chamar(client, [ev("purchase", "novo", { data: { order_id: "PED-2", value: 60 } })]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado" });
    expect(inseridos).toHaveLength(1);
  });

  it("dois fatos com o mesmo order_id NO MESMO lote: o segundo é repetido", async () => {
    const { client, inseridos } = bancoFalso(tabelasCom([COMPRA]));
    const r = await chamar(client, [
      ev("purchase", "a", { data: { order_id: "PED-9", value: 10 } }),
      ev("purchase", "b", { data: { order_id: "PED-9", value: 10 } }),
    ]);
    expect(r.resultados.map((x) => x.resultado)).toEqual(["registrado", "repetido"]);
    expect(inseridos).toHaveLength(1);
    expect(atualizacoes).toHaveBeenCalledTimes(1);
  });

  it("evento sem o campo da chave de negócio não é tratado como repetido", async () => {
    const { client, inseridos } = bancoFalso(tabelasCom([COMPRA]));
    const r = await chamar(client, [ev("purchase", "a", { data: { value: 10 } }), ev("purchase", "b", { data: { value: 10 } })]);
    expect(r.resultados.map((x) => x.resultado)).toEqual(["registrado", "registrado"]);
    expect(inseridos).toHaveLength(2);
  });

  it("⭐ o MESMO event_id já gravado é REAPLICADO (queda no meio de uma chamada anterior): estado e valor voltam", async () => {
    const { client, inseridos } = bancoFalso(
      tabelasCom([COMPRA], { atividades: [atividade("purchase", "p1", hora(0), { order_id: "PED-1", value: 73.9 })] }),
    );
    const r = await chamar(client, [ev("purchase", "p1", { at: hora(0), data: { order_id: "PED-1", value: 73.9 } })]);
    expect(r.resultados[0]).toEqual({
      event: "purchase", event_id: "p1", resultado: "repetido", estado: "aplicado", valor: "aplicado", movimento: "sem_destino",
    });
    expect(inseridos).toHaveLength(0); // não gravou de novo
    expect(ultimaAtualizacao()[3]).toEqual({ custom_fields: { pedido: { order_id: "PED-1", value: 73.9 } }, value_cents: 7390 });
  });
});

describe("estado (state_key): o mais novo vence", () => {
  const itens = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ item_id: `i${i}` })) });

  it("grava o conteúdo do evento em custom_fields[state_key], pelo handler de leads", async () => {
    const { client } = bancoFalso(tabelasCom([CARRINHO]));
    const r = await chamar(client, [ev("cart_sync", "c1", { data: itens(2) })]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado", estado: "aplicado", valor: "sem_campo" });
    expect(atualizacoes).toHaveBeenCalledTimes(1);
    const [, ctx, leadId, patch] = ultimaAtualizacao() as [unknown, Record<string, unknown>, string, Record<string, unknown>];
    expect(ctx).toMatchObject({ organization_id: ORG_A, actor: ATOR });
    expect(leadId).toBe(LEAD);
    expect(patch).toEqual({ custom_fields: { cart: itens(2) } });
  });

  it("evento ATRASADO (hora anterior à do último da mesma chave): registrado, mas o estado não é sobrescrito", async () => {
    const { client, inseridos } = bancoFalso(
      tabelasCom([CARRINHO], { atividades: [atividade("cart_sync", "novo", hora(50), itens(3))] }),
    );
    const r = await chamar(client, [ev("cart_sync", "velho", { at: hora(40), data: itens(1) })]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado", estado: "ignorado_antigo" });
    expect(inseridos).toHaveLength(1); // o histórico guarda todas as versões
    expect(atualizacoes).not.toHaveBeenCalled();
  });

  it("hora IGUAL à do último vale (reaplicar regrava o mesmo valor)", async () => {
    const { client } = bancoFalso(tabelasCom([CARRINHO], { atividades: [atividade("cart_sync", "outro", hora(50), itens(1))] }));
    const r = await chamar(client, [ev("cart_sync", "este", { at: hora(50), data: itens(2) })]);
    expect(r.resultados[0]).toMatchObject({ estado: "aplicado" });
  });

  it("⭐ no mesmo lote vence o de hora mais nova, qualquer que seja a ordem de chegada", async () => {
    const { client } = bancoFalso(tabelasCom([CARRINHO]));
    const r = await chamar(client, [
      ev("cart_sync", "novo", { at: hora(50), data: itens(3) }),
      ev("cart_sync", "velho", { at: hora(40), data: itens(1) }),
    ]);
    expect(r.resultados.map((x) => (x as { estado: string }).estado)).toEqual(["aplicado", "ignorado_antigo"]);
    expect(atualizacoes).toHaveBeenCalledTimes(1);
    expect((ultimaAtualizacao()[3] as Record<string, unknown>).custom_fields).toEqual({ cart: itens(3) });
  });

  it("outro evento (outra chave) não conta como 'último' do estado", async () => {
    const { client } = bancoFalso(
      tabelasCom([CARRINHO, cadastro("begin_checkout", { state_key: "checkout" })], {
        atividades: [atividade("begin_checkout", "b1", hora(59), { value: 1 })],
      }),
    );
    const r = await chamar(client, [ev("cart_sync", "c1", { at: hora(10), data: itens(1) })]);
    expect(r.resultados[0]).toMatchObject({ estado: "aplicado" });
  });

  it("sem state_key o conteúdo não vai ao pedido, e nenhuma atualização sai", async () => {
    const { client } = bancoFalso(tabelas());
    const r = await chamar(client, [ev("page_view", "p1", { data: { screen_name: "home" } })]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado", estado: "sem_state_key", valor: "sem_campo" });
    expect(atualizacoes).not.toHaveBeenCalled();
  });
});

describe("valor da venda (value_path)", () => {
  it("reais viram value_cents; estado e valor vão na MESMA atualização", async () => {
    const { client } = bancoFalso(tabelasCom([COMPRA]));
    const r = await chamar(client, [ev("purchase", "p1", { data: { order_id: "PED-1", value: 73.9, items: [{ item_id: "pz-1" }] } })]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado", estado: "aplicado", valor: "aplicado" });
    expect(atualizacoes).toHaveBeenCalledTimes(1);
    expect(ultimaAtualizacao()[3]).toEqual({
      custom_fields: { pedido: { order_id: "PED-1", value: 73.9, items: [{ item_id: "pz-1" }] } },
      value_cents: 7390,
    });
  });

  it("unidade em centavos exige inteiro", async () => {
    const { client } = bancoFalso(tabelasCom([cadastro("compra_cent", { value_path: "pedido.total", value_unit: "centavos" })]));
    const ok = await chamar(client, [ev("compra_cent", "a", { data: { pedido: { total: 6890 } } })]);
    expect(ok.resultados[0]).toMatchObject({ valor: "aplicado" });
    expect((ultimaAtualizacao()[3] as Record<string, unknown>).value_cents).toBe(6890);
    const ruim = await chamar(client, [ev("compra_cent", "b", { data: { pedido: { total: 68.9 } } })]);
    expect(ruim.resultados[0]).toMatchObject({ resultado: "recusado", codigo: "valor_invalido" });
  });

  it.each([
    ["negativo", { order_id: "P", value: -5 }],
    ["texto", { order_id: "P", value: "muito" }],
    ["campo ausente", { order_id: "P" }],
    ["nulo", { order_id: "P", value: null }],
  ])("valor %s: recusado (valor_invalido) e NADA é gravado para esse evento", async (_nome, data) => {
    const { client, inseridos } = bancoFalso(tabelasCom([COMPRA]));
    const r = await chamar(client, [ev("purchase", "p1", { data })]);
    expect(r.resultados[0]).toMatchObject({ resultado: "recusado", codigo: "valor_invalido" });
    expect(inseridos).toHaveLength(0);
    expect(atualizacoes).not.toHaveBeenCalled();
  });

  it("valor inválido não derruba os outros eventos do lote", async () => {
    const { client, inseridos } = bancoFalso(tabelasCom([COMPRA, CARRINHO]));
    const r = await chamar(client, [
      ev("cart_sync", "c1", { data: { items: [] } }),
      ev("purchase", "p1", { data: { order_id: "P", value: -1 } }),
    ]);
    expect(r.resultados.map((x) => x.resultado)).toEqual(["registrado", "recusado"]);
    expect(inseridos).toHaveLength(1);
  });

  it("não há teto: uma venda de R$ 5.000.000 é aceita", async () => {
    const { client } = bancoFalso(tabelasCom([COMPRA]));
    await chamar(client, [ev("purchase", "p1", { data: { order_id: "P", value: 5_000_000 } })]);
    expect((ultimaAtualizacao()[3] as Record<string, unknown>).value_cents).toBe(500_000_000);
  });
});

describe("pedido encerrado", () => {
  it.each(["won", "lost"])("pedido %s: o evento é REGISTRADO, mas estado e valor não mudam", async (status) => {
    const { client, inseridos } = bancoFalso(tabelasCom([COMPRA, CARRINHO], { status }));
    const r = await chamar(client, [
      ev("cart_sync", "c1", { data: { items: [] } }),
      ev("purchase", "p1", { data: { order_id: "P", value: 10 } }),
    ]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado", estado: "ignorado_pedido_encerrado", valor: "sem_campo" });
    expect(r.resultados[1]).toMatchObject({ resultado: "registrado", estado: "ignorado_pedido_encerrado", valor: "ignorado_pedido_encerrado" });
    expect(inseridos).toHaveLength(2);
    expect(atualizacoes).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// o movimento da etapa
// ---------------------------------------------------------------------------

const ETAPAS: Linha[] = [
  { id: "st-conv", name: "Conversas", position: 1000, is_archived: false, is_won: false, is_lost: false },
  { id: "st-vis", name: "Visitas", position: 2000, is_archived: false, is_won: false, is_lost: false },
  { id: "st-visu", name: "Visualizações", position: 2500, is_archived: false, is_won: false, is_lost: false },
  { id: "st-car", name: "Carrinho", position: 2750, is_archived: false, is_won: false, is_lost: false },
  { id: "st-rev", name: "Revisão", position: 2875, is_archived: false, is_won: false, is_lost: false },
  { id: "st-comp", name: "Compras", position: 3000, is_archived: false, is_won: true, is_lost: false },
  { id: "st-hum", name: "Chamar humano", position: 5500, is_archived: false, is_won: false, is_lost: false },
  { id: "st-arq", name: "Arquivada", position: 4000, is_archived: true, is_won: false, is_lost: false },
].map((e) => ({ ...e, organization_id: ORG_A, pipeline_id: FUNIL }));

const FUNIL_DO_CARDAPIO = [
  cadastro("page_view", { stage_id: "st-vis" }),
  cadastro("view_item", { stage_id: "st-visu" }),
  cadastro("cart_sync", { stage_id: "st-car", state_key: "cart" }),
  cadastro("begin_checkout", { stage_id: "st-rev" }),
  cadastro("purchase", { stage_id: "st-comp", respects_manual_move: false, state_key: "pedido", value_path: "value", value_unit: "reais" }),
];
// Os cadastros acima não declaram `respects_manual_move`: o padrão da tabela é verdadeiro.
for (const c of FUNIL_DO_CARDAPIO) c.respects_manual_move ??= true;

function tabelasDoCardapio(extra: { etapa?: string; status?: string; atividades?: Linha[]; cadastros?: Linha[]; etapas?: Linha[] } = {}) {
  const t = tabelasCom(extra.cadastros ?? FUNIL_DO_CARDAPIO, { status: extra.status, atividades: extra.atividades });
  (t.crm_leads[0] as Linha).stage_id = extra.etapa ?? "st-conv";
  return { ...t, crm_stages: extra.etapas ?? ETAPAS };
}
const movimentoManual = (quem: string): Linha => ({
  organization_id: ORG_A, lead_id: LEAD, type: "stage_changed", actor_kind: quem, performed_at: hora(1),
});
const destinosChamados = () => movimentos.mock.calls.map((c) => (c[3] as { to_stage_id: string }).to_stage_id);
const movimentoDe = (r: { resultados: unknown[] }, i: number) => (r.resultados[i] as { movimento: string }).movimento;

describe("movimento: o card avança pelo cadastro e nunca retrocede", () => {
  it("⭐ a sequência page_view → view_item → cart_sync → begin_checkout → purchase termina em Compras", async () => {
    const { client } = bancoFalso(tabelasDoCardapio());
    const r = await chamar(client, [
      ev("page_view", "1", { at: hora(1) }),
      ev("view_item", "2", { at: hora(2) }),
      ev("cart_sync", "3", { at: hora(3), data: { items: [{ item_id: "x" }] } }),
      ev("begin_checkout", "4", { at: hora(4) }),
      ev("purchase", "5", { at: hora(5), data: { value: 68.9 } }),
    ]);
    expect(destinosChamados()).toEqual(["st-vis", "st-visu", "st-car", "st-rev", "st-comp"]);
    expect(r.resultados.map((x) => (x as { etapa?: string }).etapa)).toEqual(["Visitas", "Visualizações", "Carrinho", "Revisão", "Compras"]);
    expect(r.resultados.every((x) => (x as { movimento: string }).movimento === "movido")).toBe(true);
    expect(movimentos.mock.calls[0]![2]).toBe(LEAD);
    expect(movimentos.mock.calls[0]![1]).toMatchObject({ organization_id: ORG_A, actor: ATOR });
  });

  it("evento de nível menor depois NÃO retrocede: o card em Revisão fica em Revisão", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-rev" }));
    const r = await chamar(client, [ev("page_view", "1"), ev("view_item", "2")]);
    expect(r.resultados.map((x) => (x as { movimento: string }).movimento)).toEqual(["ja_na_etapa_ou_adiante", "ja_na_etapa_ou_adiante"]);
    expect(movimentos).not.toHaveBeenCalled();
  });

  it("mover para a etapa em que o card já está não chama o handler (não gera stage_changed)", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-vis" }));
    const r = await chamar(client, [ev("page_view", "1")]);
    expect(movimentoDe(r, 0)).toBe("ja_na_etapa_ou_adiante");
    expect(movimentos).not.toHaveBeenCalled();
  });

  it("⭐ o desvio por 'Chamar humano' (fora do mapa, depois na ordem do quadro) não trava a compra", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-hum" }));
    const r = await chamar(client, [ev("purchase", "5", { data: { value: 10 } })]);
    expect(movimentoDe(r, 0)).toBe("movido");
    expect(destinosChamados()).toEqual(["st-comp"]);
  });

  it("evento sem etapa de destino só registra", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ cadastros: [cadastro("page_view")] }));
    const r = await chamar(client, [ev("page_view", "1")]);
    expect(movimentoDe(r, 0)).toBe("sem_destino");
    expect(movimentos).not.toHaveBeenCalled();
  });

  it("etapa de destino arquivada: só registra", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ cadastros: [cadastro("page_view", { stage_id: "st-arq" })] }));
    const r = await chamar(client, [ev("page_view", "1")]);
    expect(movimentoDe(r, 0)).toBe("etapa_arquivada");
    expect(movimentos).not.toHaveBeenCalled();
  });

  it("pedido encerrado não se move", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ status: "lost" }));
    const r = await chamar(client, [ev("page_view", "1")]);
    expect(movimentoDe(r, 0)).toBe("pedido_encerrado");
    expect(movimentos).not.toHaveBeenCalled();
  });

  it("um movimento que fecha o pedido vale para os eventos seguintes do MESMO lote", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-car" }));
    const r = await chamar(client, [ev("purchase", "5", { at: hora(5), data: { value: 10 } }), ev("page_view", "6", { at: hora(6) })]);
    expect(r.resultados.map((x) => (x as { movimento: string }).movimento)).toEqual(["movido", "pedido_encerrado"]);
    expect(movimentos).toHaveBeenCalledTimes(1);
  });
});

describe("movimento: respeitar a equipe", () => {
  it("⭐ último movimento de uma PESSOA e flag ligado: registra, grava estado e valor, e não move", async () => {
    const { client, inseridos } = bancoFalso(tabelasDoCardapio({ etapa: "st-vis", atividades: [movimentoManual("user")] }));
    const r = await chamar(client, [ev("cart_sync", "3", { data: { items: [] } })]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado", estado: "aplicado", movimento: "respeita_movimento_manual" });
    expect(inseridos).toHaveLength(1);
    expect(atualizacoes).toHaveBeenCalledTimes(1);
    expect(movimentos).not.toHaveBeenCalled();
  });

  it("flag DESLIGADO (a compra): o evento move mesmo depois de uma pessoa", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-car", atividades: [movimentoManual("user")] }));
    const r = await chamar(client, [ev("purchase", "5", { data: { value: 10 } })]);
    expect(movimentoDe(r, 0)).toBe("movido");
  });

  it.each(["system", "ai"])("último movimento por %s não é manual: move", async (quem) => {
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-vis", atividades: [movimentoManual(quem)] }));
    const r = await chamar(client, [ev("cart_sync", "3", { data: { items: [] } })]);
    expect(movimentoDe(r, 0)).toBe("movido");
  });

  it("⭐ depois que o evento move (ator do token), os seguintes voltam a mover", async () => {
    const abertas = ["s1", "s2", "s3", "s4"].map((id, i) => ({
      id, name: id, position: (i + 1) * 1000, is_archived: false, is_won: false, is_lost: false, organization_id: ORG_A, pipeline_id: FUNIL,
    }));
    const { client } = bancoFalso(
      tabelasDoCardapio({
        etapa: "s1",
        etapas: abertas,
        atividades: [movimentoManual("user")],
        cadastros: [
          cadastro("a", { stage_id: "s2" }),
          cadastro("b", { stage_id: "s3", respects_manual_move: false }),
          cadastro("c", { stage_id: "s4" }),
        ].map((c) => ({ respects_manual_move: true, ...c })),
      }),
    );
    const r = await chamar(client, [ev("a", "1", { at: hora(1) }), ev("b", "2", { at: hora(2) }), ev("c", "3", { at: hora(3) })]);
    expect(r.resultados.map((x) => (x as { movimento: string }).movimento)).toEqual(["respeita_movimento_manual", "movido", "movido"]);
    expect(destinosChamados()).toEqual(["s3", "s4"]);
  });
});

describe("movimento: as recusas e a corrida", () => {
  it("⭐ o estado e o valor são gravados ANTES do movimento (o ganho já enxerga o total)", async () => {
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-rev" }));
    await chamar(client, [ev("purchase", "5", { data: { value: 68.9 } })]);
    expect(atualizacoes).toHaveBeenCalledTimes(1);
    expect(movimentos).toHaveBeenCalledTimes(1);
    expect(atualizacoes.mock.invocationCallOrder[0]!).toBeLessThan(movimentos.mock.invocationCallOrder[0]!);
  });

  it("recusa do funil (campo obrigatório, motivo): 'recusado_pelo_funil' com a mensagem, e estado e valor permanecem", async () => {
    movimentos.mockRejectedValue(new ApiError(422, "campos_obrigatorios", { faltando: ["forma_pagamento"] }, "", "Falta o campo Forma de pagamento."));
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-rev" }));
    const r = await chamar(client, [ev("purchase", "5", { data: { value: 68.9 } })]);
    expect(r.resultados[0]).toMatchObject({
      resultado: "registrado", estado: "aplicado", valor: "aplicado",
      movimento: "recusado_pelo_funil", mensagem_do_movimento: "Falta o campo Forma de pagamento.",
    });
    expect(atualizacoes).toHaveBeenCalledTimes(1);
  });

  it("reabertura recusada pelo funil (409) também vira 'recusado_pelo_funil'", async () => {
    movimentos.mockRejectedValue(new ApiError(409, "reabertura_cria_novo", undefined, "", "Negócio encerrado."));
    const { client } = bancoFalso(tabelasDoCardapio({ etapa: "st-rev" }));
    const r = await chamar(client, [ev("purchase", "5", { data: { value: 1 } })]);
    expect(movimentoDe(r, 0)).toBe("recusado_pelo_funil");
  });

  it("⭐ movimento simultâneo (409 lead_stage_changed_concurrent): 'conflito', sem erro para quem chama", async () => {
    movimentos.mockRejectedValue(new ApiError(409, "lead_stage_changed_concurrent", undefined, "", "Lead foi modificado concorrentemente."));
    const { client } = bancoFalso(tabelasDoCardapio());
    const r = await chamar(client, [ev("page_view", "1")]);
    expect(r.resultados[0]).toMatchObject({ resultado: "registrado", movimento: "conflito" });
  });

  it("erro inesperado do movimento NÃO é engolido", async () => {
    movimentos.mockRejectedValue(new ApiError(500, "internal_error", undefined, "", "queda"));
    const { client } = bancoFalso(tabelasDoCardapio());
    await expect(chamar(client, [ev("page_view", "1")])).rejects.toMatchObject({ status: 500 });
  });
});

