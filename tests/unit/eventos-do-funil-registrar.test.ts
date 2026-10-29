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
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";
import {
  eventoDoFunilSchema,
  registrarEventosDoFunil,
  type EventoDoFunil,
} from "@/lib/leads/eventos-do-funil/registrar";
import { allTools } from "@/lib/mcp/tools";

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
function bancoFalso(
  tabelas: Record<string, Linha[]>,
  recusa?: (linhas: Linha[]) => { code: string; message: string } | null,
) {
  const inseridos: Linha[] = [];
  const from = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let emIn: [string, unknown[]] | null = null;
    const construtor = {
      select: () => construtor,
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return construtor;
      },
      in: (coluna: string, valores: unknown[]) => {
        emIn = [coluna, valores];
        return construtor;
      },
      maybeSingle: async () => {
        const achou = (tabelas[tabela] ?? []).find((l) => filtros.every(([c, v]) => l[c] === v));
        return { data: achou ?? null, error: null };
      },
      insert: async (linhas: Linha | Linha[]) => {
        const lista = Array.isArray(linhas) ? linhas : [linhas];
        const erro = recusa?.(lista) ?? null;
        if (erro) return { error: erro };
        inseridos.push(...lista);
        return { error: null };
      },
      then: (resolve: (v: { data: Linha[]; error: null }) => unknown) => {
        const todas = (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, v]) => l[c] === v));
        const filtradas = emIn
          ? todas.filter((l) => {
              const [coluna, valores] = emIn as [string, unknown[]];
              const caminho = coluna.split("->>");
              const valor = caminho.length === 2 ? (l.payload as Linha)?.[caminho[1]!] : l[coluna];
              return valores.includes(valor);
            })
          : todas;
        return resolve({ data: filtradas, error: null });
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
