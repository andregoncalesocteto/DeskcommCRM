/**
 * `crm_list_pipeline_events` — as chaves que um funil aceita, para quem integra consultar.
 *
 * Duas coisas custam caro errar: o ISOLAMENTO (a leitura roda com a chave de serviço, que ignora RLS, e o
 * `pipeline_id` vem do chamador) e vazar ID de etapa (o ponto do cadastro é que quem integra nunca precise de um).
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/types";
import { listarEventosDoFunil } from "@/lib/leads/eventos-do-funil/listar";
import { allTools } from "@/lib/mcp/tools";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FUNIL = "f1f1f1f1-1111-4111-8111-111111111111";
const OUTRO_FUNIL = "f2f2f2f2-2222-4222-8222-222222222222";
const ETAPA_COMPRAS = "e0e0e0e0-0000-4000-8000-00000000c0c0";
const ETAPA_VISITAS = "e0e0e0e0-0000-4000-8000-00000000d0d0";

interface Linha {
  [coluna: string]: unknown;
}

function bancoFalso(tabelas: Record<string, Linha[]>) {
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
      maybeSingle: async () => ({
        data: (tabelas[tabela] ?? []).find((l) => filtros.every(([c, v]) => l[c] === v)) ?? null,
        error: null,
      }),
      then: (resolve: (v: { data: Linha[]; error: null }) => unknown) => {
        const todas = (tabelas[tabela] ?? []).filter((l) => filtros.every(([c, v]) => l[c] === v));
        const filtradas = emIn ? todas.filter((l) => (emIn as [string, unknown[]])[1].includes(l[(emIn as [string, unknown[]])[0]])) : todas;
        return resolve({ data: filtradas, error: null });
      },
    };
    return construtor;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dublê mínimo do SupabaseClient
  return { from } as any;
}

const cad = (key: string, extra: Linha = {}): Linha => ({
  organization_id: ORG_A, pipeline_id: FUNIL, key, label: key.toUpperCase(), description: null,
  is_active: true, stage_id: null, respects_manual_move: true, state_key: null, value_path: null, dedupe_path: null, ...extra,
});

function tabelas() {
  return {
    crm_pipelines: [
      { id: FUNIL, organization_id: ORG_A },
      { id: OUTRO_FUNIL, organization_id: ORG_A },
    ],
    crm_stages: [
      { id: ETAPA_COMPRAS, organization_id: ORG_A, name: "Compras" },
      { id: ETAPA_VISITAS, organization_id: ORG_A, name: "Visitas" },
    ],
    crm_pipeline_events: [
      cad("purchase", { stage_id: ETAPA_COMPRAS, respects_manual_move: false, state_key: "pedido", value_path: "value", dedupe_path: "order_id" }),
      cad("page_view", { stage_id: ETAPA_VISITAS }),
      cad("antigo", { is_active: false }),
    ] as Linha[],
  };
}

describe("listarEventosDoFunil", () => {
  it("lista os eventos em ordem de chave, com o NOME da etapa e o que o cadastro faz", async () => {
    const r = await listarEventosDoFunil(bancoFalso(tabelas()), ORG_A, FUNIL);
    expect(r.pipeline_id).toBe(FUNIL);
    expect(r.eventos.map((e) => e.key)).toEqual(["antigo", "page_view", "purchase"]);
    expect(r.eventos.find((e) => e.key === "purchase")).toEqual({
      key: "purchase", label: "PURCHASE", description: null, ativo: true, etapa: "Compras",
      respeita_movimento_manual: false, guarda_estado: true, define_valor: true, repete_por_negocio: true,
    });
    expect(r.eventos.find((e) => e.key === "page_view")).toMatchObject({
      etapa: "Visitas", respeita_movimento_manual: true, guarda_estado: false, define_valor: false, repete_por_negocio: false,
    });
  });

  it("evento desativado aparece com ativo: false; sem etapa de destino, etapa é null", async () => {
    const r = await listarEventosDoFunil(bancoFalso(tabelas()), ORG_A, FUNIL);
    expect(r.eventos.find((e) => e.key === "antigo")).toMatchObject({ ativo: false, etapa: null });
  });

  it("⭐ nunca devolve id de etapa (nem o id do cadastro)", async () => {
    const r = await listarEventosDoFunil(bancoFalso(tabelas()), ORG_A, FUNIL);
    const texto = JSON.stringify(r.eventos);
    expect(texto).not.toContain(ETAPA_COMPRAS);
    expect(texto).not.toContain(ETAPA_VISITAS);
    expect(texto).not.toMatch(/stage_id|"id"/);
  });

  it("funil sem eventos devolve lista vazia", async () => {
    const r = await listarEventosDoFunil(bancoFalso(tabelas()), ORG_A, OUTRO_FUNIL);
    expect(r.eventos).toEqual([]);
  });

  it("⭐ ISOLAMENTO: funil de OUTRA organização é 404", async () => {
    const p = listarEventosDoFunil(bancoFalso(tabelas()), ORG_B, FUNIL);
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ status: 404 });
  });

  it("o cadastro de OUTRA organização ou de OUTRO funil não aparece", async () => {
    const t = tabelas();
    t.crm_pipeline_events.push(
      cad("intruso_de_outra_org", { organization_id: ORG_B }),
      cad("intruso_de_outro_funil", { pipeline_id: OUTRO_FUNIL }),
    );
    const r = await listarEventosDoFunil(bancoFalso(t), ORG_A, FUNIL);
    expect(r.eventos.map((e) => e.key)).not.toContain("intruso_de_outra_org");
    expect(r.eventos.map((e) => e.key)).not.toContain("intruso_de_outro_funil");
  });

  it("o nome da etapa só vem de etapa da MESMA organização", async () => {
    const t = tabelas();
    t.crm_stages = [{ id: ETAPA_COMPRAS, organization_id: ORG_B, name: "Compras da outra loja" }];
    const r = await listarEventosDoFunil(bancoFalso(t), ORG_A, FUNIL);
    expect(r.eventos.find((e) => e.key === "purchase")!.etapa).toBeNull();
  });

  it("a ferramenta está registrada como leitura de papel agent, com o escopo de leitura", () => {
    const t = allTools.find((x) => x.name === "crm_list_pipeline_events");
    expect(t).toMatchObject({ category: "read", requiresRole: "agent", requiresScope: "mcp:read" });
  });
});
