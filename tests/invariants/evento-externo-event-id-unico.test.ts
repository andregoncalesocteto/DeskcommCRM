import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { GOV_LEAD, GOV_ORG, GOV_PIPELINE, GOV_STAGE, indexExists, seedGov, sql } from "./gov-helpers";

/**
 * EVENTOS EXTERNOS — o mesmo `event_id` não grava duas vezes no mesmo pedido, e é o BANCO que garante.
 *
 * Antes do índice único, a deduplicação era "ler e depois inserir" (`lib/leads/eventos-externos.ts`): duas
 * chamadas simultâneas com o mesmo `event_id` liam "não existe" e gravavam as duas. Aqui a corrida é reproduzida
 * de verdade (duas conexões, duas inserções ao mesmo tempo) e a migration 9040 é reaplicada sobre duplicatas
 * pré-existentes para provar a deduplicação e a idempotência.
 *
 * Roda contra Postgres real via `pnpm test:db` (não roda no `test:unit`).
 */

const LEAD_2 = "ffffffff-9040-4000-8000-000000000001";
const INDICE = "uniq_lead_activities_external_event_id";
const MIGRATION = readFileSync(
  join(__dirname, "..", "..", "supabase", "migrations", "20261029191000_9040_evento_externo_event_id_unico.sql"),
  "utf8",
);

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 4,
});

const inserir = (lead: string, eventId: string | null, tipo = "external_event", quando = "now()") =>
  `insert into public.crm_lead_activities (organization_id, lead_id, type, source_module, actor_kind, reason, payload, created_at)
     values ('${GOV_ORG}', '${lead}', '${tipo}', 'integracao', 'system', 'teste do índice',
             '${JSON.stringify({ event: "page_view", ...(eventId ? { event_id: eventId } : {}) })}'::jsonb, ${quando})`;

function limpar(): void {
  sql(`delete from public.crm_lead_activities where lead_id in ('${GOV_LEAD}', '${LEAD_2}') and reason = 'teste do índice';`);
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title)
      values ('${LEAD_2}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Segundo pedido do índice')
      on conflict do nothing;
  `);
  limpar();
});

afterAll(async () => {
  limpar();
  sql(`delete from public.crm_leads where id = '${LEAD_2}';`);
  await pool.end();
});

describe("índice único do event_id dos eventos externos", () => {
  it("controle: o índice existe, é único e parcial", () => {
    expect(indexExists(INDICE)).toBe(true);
    expect(sql(`select indisunique from pg_index where indexrelid = 'public.${INDICE}'::regclass;`)).toBe("t");
    expect(sql(`select indpred is not null from pg_index where indexrelid = 'public.${INDICE}'::regclass;`)).toBe("t");
  });

  it("o mesmo event_id no MESMO pedido: 23505", async () => {
    await pool.query(inserir(GOV_LEAD, "ped-1"));
    await expect(pool.query(inserir(GOV_LEAD, "ped-1"))).rejects.toMatchObject({ code: "23505", constraint: INDICE });
  });

  it("o mesmo event_id em OUTRO pedido da mesma organização é aceito (o escopo é o pedido)", async () => {
    await pool.query(inserir(LEAD_2, "ped-1"));
    const { rows } = await pool.query(
      `select count(*)::int as n from public.crm_lead_activities where reason = 'teste do índice' and payload->>'event_id' = 'ped-1'`,
    );
    expect(rows[0].n).toBe(2);
  });

  it("evento sem event_id pode repetir: não há como saber que é o mesmo fato", async () => {
    await pool.query(inserir(GOV_LEAD, null));
    await pool.query(inserir(GOV_LEAD, null));
    const { rows } = await pool.query(
      `select count(*)::int as n from public.crm_lead_activities
        where reason = 'teste do índice' and lead_id = '${GOV_LEAD}' and type = 'external_event' and not (payload ? 'event_id')`,
    );
    expect(rows[0].n).toBe(2);
  });

  it("outro tipo de atividade com payload.event_id repetido não é tocado pelo índice", async () => {
    await pool.query(inserir(GOV_LEAD, "ped-1", "lead_edited"));
    await pool.query(inserir(GOV_LEAD, "ped-1", "lead_edited"));
  });

  it("⭐ duas inserções SIMULTÂNEAS do mesmo event_id: uma grava, a outra recebe 23505", async () => {
    const [a, b] = await Promise.allSettled([
      pool.query(inserir(GOV_LEAD, "corrida-1")),
      pool.query(inserir(GOV_LEAD, "corrida-1")),
    ]);
    const resultados = [a, b];
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const recusada = resultados.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(recusada.reason).toMatchObject({ code: "23505", constraint: INDICE });
    const { rows } = await pool.query(
      `select count(*)::int as n from public.crm_lead_activities where lead_id = '${GOV_LEAD}' and payload->>'event_id' = 'corrida-1'`,
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("migration 9040 sobre dados que já tinham duplicata", () => {
  it("⭐ deduplica mantendo a linha mais antiga, cria o índice, e reaplicar não muda nada", async () => {
    limpar();
    // Estado de uma instalação ANTES do índice: sem ele, as três linhas coexistem.
    sql(`drop index if exists public.${INDICE};`);
    sql(`
      ${inserir(GOV_LEAD, "dup-1", "external_event", "now() - interval '3 hours'")};
      ${inserir(GOV_LEAD, "dup-1", "external_event", "now() - interval '2 hours'")};
      ${inserir(GOV_LEAD, "dup-1", "external_event", "now() - interval '1 hour'")};
      ${inserir(LEAD_2, "dup-1", "external_event", "now() - interval '1 hour'")};
    `);
    const maisAntigo = sql(`
      select id from public.crm_lead_activities
       where lead_id = '${GOV_LEAD}' and payload->>'event_id' = 'dup-1' order by created_at, id limit 1;
    `);
    expect(sql(`select count(*) from public.crm_lead_activities where lead_id = '${GOV_LEAD}' and payload->>'event_id' = 'dup-1';`)).toBe("3");

    sql(MIGRATION);

    expect(sql(`select id from public.crm_lead_activities where lead_id = '${GOV_LEAD}' and payload->>'event_id' = 'dup-1';`)).toBe(maisAntigo);
    // O outro pedido, com o mesmo event_id, não é duplicata.
    expect(sql(`select count(*) from public.crm_lead_activities where lead_id = '${LEAD_2}' and payload->>'event_id' = 'dup-1';`)).toBe("1");
    expect(indexExists(INDICE)).toBe(true);

    sql(MIGRATION); // idempotente
    expect(sql(`select count(*) from public.crm_lead_activities where reason = 'teste do índice' and payload->>'event_id' = 'dup-1';`)).toBe("2");
    expect(indexExists(INDICE)).toBe(true);
  });
});
