import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_PIPELINE, GOV_STAGE, columnExists, seedGov, sql } from "./gov-helpers";

/**
 * FONTE DE WEBHOOK DE ENTRADA — o campo do valor da venda (migration 9042): caminho e unidade juntos ou nenhum dos dois,
 * unidade só reais/centavos, caminho só com nomes separados por ponto. Roda contra Postgres real via `pnpm test:db`.
 */

const FONTE = "ffffffff-9042-4000-8000-000000000001";

const inserir = (extra: string) =>
  `insert into public.webhook_sources (id, organization_id, name, kind, path_token, default_pipeline_id, default_stage_id, field_map ${extra.split("|")[0]})
     values ('${FONTE}', '${GOV_ORG}', 'Fonte do valor', 'lead_capture', 'tok-9042', '${GOV_PIPELINE}', '${GOV_STAGE}', '{}' ${extra.split("|")[1] ?? ""})`;

const recusa = (comando: string) => {
  try {
    sql(comando);
    return "";
  } catch (e) {
    return String((e as Error).message);
  }
};

beforeAll(() => {
  seedGov();
  sql(`delete from public.webhook_sources where id = '${FONTE}';`);
});
afterAll(() => {
  sql(`delete from public.webhook_sources where id = '${FONTE}';`);
});

describe("webhook_sources.value_path / value_unit", () => {
  it("controle: as colunas existem e nascem nulas (fonte antiga segue como antes)", () => {
    expect(columnExists("webhook_sources", "value_path")).toBe(true);
    expect(columnExists("webhook_sources", "value_unit")).toBe(true);
    sql(inserir(""));
    expect(sql(`select value_path is null and value_unit is null from public.webhook_sources where id = '${FONTE}';`)).toBe("t");
    sql(`delete from public.webhook_sources where id = '${FONTE}';`);
  });

  it("caminho e unidade juntos valem", () => {
    sql(inserir(", value_path, value_unit|, 'pedido.total', 'reais'"));
    expect(sql(`select value_path || ':' || value_unit from public.webhook_sources where id = '${FONTE}';`)).toBe("pedido.total:reais");
    sql(`delete from public.webhook_sources where id = '${FONTE}';`);
  });

  it("um sem o outro é recusado", () => {
    expect(recusa(inserir(", value_path|, 'value'"))).toContain("webhook_sources_valor_junto");
    expect(recusa(inserir(", value_unit|, 'reais'"))).toContain("webhook_sources_valor_junto");
  });

  it("unidade desconhecida é recusada", () => {
    expect(recusa(inserir(", value_path, value_unit|, 'value', 'dolares'"))).toContain("webhook_sources_unidade_do_valor");
  });

  it("caminho fora da forma é recusado (índice, expressão, protótipo com pontuação)", () => {
    for (const ruim of ["items[0].price", "$.value", "a..b", ".a", "a-b", "a b"]) {
      expect(recusa(inserir(`, value_path, value_unit|, '${ruim}', 'reais'`)), ruim).toContain("webhook_sources_caminho_do_valor");
    }
    expect(recusa(inserir(`, value_path, value_unit|, '${"a".repeat(201)}', 'reais'`))).toContain("webhook_sources_caminho_do_valor");
  });
});
