/**
 * `crm_add_lead_events` — o registro que SÓ CRESCE, para quem integra com o CRM.
 *
 * O que o teste guarda, em ordem de quanto custa errar:
 *
 * 1. ISOLAMENTO. A ferramenta roda com a chave de serviço (que ignora RLS) e o
 *    `lead_id` vem do cliente do MCP: sem o filtro de organização manual, um
 *    token da loja A escreveria na linha do tempo da loja B. O teste usa um banco
 *    falso que SÓ devolve a linha quando a organização bate, então tirar o
 *    `.eq("organization_id", …)` do código o deixa vermelho.
 * 2. NADA SE PERDE, NADA SE DUPLICA. Cada evento vira UMA linha, com a hora em
 *    que aconteceu (não a do envio) — e reenviar o lote por falha de rede não
 *    multiplica as linhas, desde que o cliente mande `event_id`.
 * 3. O LOTE TEM TETO. Sem ele, uma chamada escreveria milhares de linhas.
 */
import { describe, expect, it } from "vitest";

import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import { ACTIVITY_LABELS, activityLabel } from "@/lib/leads/activity-vocabulary";
import {
  MAX_BYTES_DA_CHAMADA,
  MAX_BYTES_DO_EVENTO,
  MAX_EVENTOS_POR_CHAMADA,
  eventoExternoSchema,
  registrarEventosDoNegocio,
  validarLote,
  type EventoExterno,
} from "@/lib/leads/eventos-externos";
import { ApiError } from "@/lib/api/types";
import type { Actor } from "@/lib/api/handlers/types";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LEAD = "11111111-2222-4333-8444-555555555555";
const CONTATO = "99999999-8888-4777-8666-555555555555";
const AGORA = new Date("2026-10-28T18:00:00.000Z");
const ATOR: Actor = { type: "api_token", id: "tok-1", role: "agent" };

// ---------------------------------------------------------------------------
// Um banco falso mínimo: só devolve a linha quando TODOS os `.eq` batem.
// ---------------------------------------------------------------------------
interface Linha {
  [coluna: string]: unknown;
}
function bancoFalso(tabelas: Record<string, Linha[]>) {
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
        inseridos.push(...(Array.isArray(linhas) ? linhas : [linhas]));
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

function lote(n: number): EventoExterno[] {
  return Array.from({ length: n }, (_, i) => ({
    event: "view_item",
    at: new Date(AGORA.getTime() - (n - i) * 1000).toISOString(),
    data: { item_id: `item-${i}`, item_name: `Item ${i}` },
  }));
}

describe("contrato do evento", () => {
  it("aceita o evento mínimo e o completo", () => {
    expect(eventoExternoSchema.safeParse({ event: "page_view" }).success).toBe(true);
    expect(
      eventoExternoSchema.safeParse({
        event: "view_item",
        at: "2026-10-28T17:59:00-03:00",
        event_id: "ev-1",
        data: { item_id: "pz-1", price: 59.9 },
      }).success,
    ).toBe(true);
  });

  it("recusa nome de evento fora do padrão e chave que o contrato não conhece", () => {
    expect(eventoExternoSchema.safeParse({ event: "Page View" }).success).toBe(false);
    expect(eventoExternoSchema.safeParse({ event: "" }).success).toBe(false);
    expect(eventoExternoSchema.safeParse({ event: "page_view", dado: 1 }).success).toBe(false);
    expect(eventoExternoSchema.safeParse({ event: "page_view", at: "ontem" }).success).toBe(false);
  });
});

describe("validarLote — o lote tem teto", () => {
  it("passa um lote normal", () => {
    expect(validarLote(lote(3), AGORA)).toEqual([]);
  });

  it("recusa lote vazio e lote acima do teto", () => {
    expect(validarLote([], AGORA).length).toBeGreaterThan(0);
    expect(validarLote(lote(MAX_EVENTOS_POR_CHAMADA), AGORA)).toEqual([]);
    expect(validarLote(lote(MAX_EVENTOS_POR_CHAMADA + 1), AGORA).length).toBeGreaterThan(0);
  });

  it("recusa um evento grande demais, dizendo QUAL", () => {
    const grande: EventoExterno = { event: "view_item", data: { lixo: "x".repeat(MAX_BYTES_DO_EVENTO) } };
    const problemas = validarLote([lote(1)[0]!, grande], AGORA);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("#2");
  });

  it("recusa a chamada inteira quando a soma passa do teto", () => {
    const quase: EventoExterno[] = Array.from({ length: 12 }, () => ({
      event: "cart_sync",
      data: { texto: "x".repeat(MAX_BYTES_DO_EVENTO - 200) },
    }));
    expect(quase.length * (MAX_BYTES_DO_EVENTO - 200)).toBeGreaterThan(MAX_BYTES_DA_CHAMADA);
    expect(validarLote(quase, AGORA).join(" ")).toMatch(/chamada/i);
  });

  it("recusa hora do evento no futuro e hora velha demais", () => {
    const futuro = new Date(AGORA.getTime() + 10 * 60_000).toISOString();
    const velho = new Date(AGORA.getTime() - 31 * 86_400_000).toISOString();
    expect(validarLote([{ event: "page_view", at: futuro }], AGORA).length).toBe(1);
    expect(validarLote([{ event: "page_view", at: velho }], AGORA).length).toBe(1);
    // dentro da tolerância de relógio do aparelho
    const quaseAgora = new Date(AGORA.getTime() + 60_000).toISOString();
    expect(validarLote([{ event: "page_view", at: quaseAgora }], AGORA)).toEqual([]);
  });
});

describe("a linha do tempo guarda a HORA DO EVENTO", () => {
  it("buildLeadActivityRow leva performed_at quando o emissor manda, e só então", () => {
    const base = {
      organizationId: ORG_A,
      leadId: LEAD,
      type: "external_event" as const,
      sourceModule: "integracao_externa",
      actor: ATOR,
      reason: "Evento page_view",
    };
    expect(buildLeadActivityRow(base)).not.toHaveProperty("performed_at");
    expect(buildLeadActivityRow({ ...base, performedAt: "2026-10-28T17:00:00.000Z" }).performed_at).toBe(
      "2026-10-28T17:00:00.000Z",
    );
  });

  it("o tipo novo tem rótulo próprio, não o de reserva", () => {
    expect(ACTIVITY_LABELS.external_event).toBeTruthy();
    expect(activityLabel("external_event")).toBe(ACTIVITY_LABELS.external_event);
  });
});

describe("registrarEventosDoNegocio", () => {
  const tabelas = () => ({
    crm_leads: [{ id: LEAD, organization_id: ORG_A, contact_id: CONTATO }],
    contacts: [{ id: CONTATO, organization_id: ORG_A, is_personal: false }],
    crm_lead_activities: [] as Linha[],
  });

  it("grava UMA linha por evento, na hora em que ele aconteceu", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    const eventos = lote(3);
    const r = await registrarEventosDoNegocio(client, { organizationId: ORG_A, leadId: LEAD, actor: ATOR, eventos, agora: AGORA });

    expect(r).toEqual({ lead_id: LEAD, registrados: 3, repetidos: 0 });
    expect(inseridos).toHaveLength(3);
    expect(inseridos.map((l) => l.performed_at)).toEqual(eventos.map((e) => e.at));
    expect(inseridos.every((l) => l.type === "external_event" && l.organization_id === ORG_A && l.lead_id === LEAD)).toBe(true);
    expect(inseridos[0]!.contact_id).toBe(CONTATO);
    expect(inseridos[0]!.payload).toEqual({ event: "view_item", at: eventos[0]!.at, data: eventos[0]!.data });
  });

  it("sem `at`, a hora é a da chamada", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    await registrarEventosDoNegocio(client, { organizationId: ORG_A, leadId: LEAD, actor: ATOR, eventos: [{ event: "page_view" }], agora: AGORA });
    expect(inseridos[0]!.performed_at).toBe(AGORA.toISOString());
  });

  it("ISOLAMENTO: pedido de OUTRA organização é recusado e nada é escrito", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    const chamada = registrarEventosDoNegocio(client, { organizationId: ORG_B, leadId: LEAD, actor: ATOR, eventos: lote(1), agora: AGORA });
    await expect(chamada).rejects.toBeInstanceOf(ApiError);
    await expect(chamada).rejects.toMatchObject({ status: 404 });
    expect(inseridos).toHaveLength(0);
  });

  it("contato marcado como pessoal está fora da operação: recusa", async () => {
    const t = tabelas();
    t.contacts[0]!.is_personal = true;
    const { client, inseridos } = bancoFalso(t);
    await expect(
      registrarEventosDoNegocio(client, { organizationId: ORG_A, leadId: LEAD, actor: ATOR, eventos: lote(1), agora: AGORA }),
    ).rejects.toMatchObject({ status: 403, code: "contato_pessoal" });
    expect(inseridos).toHaveLength(0);
  });

  it("REENVIO: event_id que já está gravado não vira linha de novo", async () => {
    const t = tabelas();
    t.crm_lead_activities.push({
      organization_id: ORG_A, lead_id: LEAD, type: "external_event", payload: { event: "view_item", event_id: "ev-1" },
    });
    const { client, inseridos } = bancoFalso(t);
    const r = await registrarEventosDoNegocio(client, {
      organizationId: ORG_A, leadId: LEAD, actor: ATOR, agora: AGORA,
      eventos: [
        { event: "view_item", event_id: "ev-1" },
        { event: "view_item", event_id: "ev-2" },
      ],
    });
    expect(r).toMatchObject({ registrados: 1, repetidos: 1 });
    expect(inseridos).toHaveLength(1);
    expect((inseridos[0]!.payload as Linha).event_id).toBe("ev-2");
  });

  it("o mesmo event_id duas vezes NO MESMO lote também conta uma vez", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    const r = await registrarEventosDoNegocio(client, {
      organizationId: ORG_A, leadId: LEAD, actor: ATOR, agora: AGORA,
      eventos: [{ event: "page_view", event_id: "x" }, { event: "page_view", event_id: "x" }],
    });
    expect(r).toMatchObject({ registrados: 1, repetidos: 1 });
    expect(inseridos).toHaveLength(1);
  });

  it("lote inválido não escreve nada e explica o porquê", async () => {
    const { client, inseridos } = bancoFalso(tabelas());
    await expect(
      registrarEventosDoNegocio(client, { organizationId: ORG_A, leadId: LEAD, actor: ATOR, eventos: [], agora: AGORA }),
    ).rejects.toMatchObject({ status: 422 });
    expect(inseridos).toHaveLength(0);
  });
});
