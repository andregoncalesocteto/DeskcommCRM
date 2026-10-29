import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_PIPELINE,
  GOV_STAGE,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
  tableExists,
  writeCountAs,
} from "./gov-helpers";

/**
 * EVENTOS DO FUNIL — o cadastro (`crm_pipeline_events`) é por organização e por funil.
 *
 * Sem RLS provada contra Postgres real, "organization_id filtra" é afirmação, não fato. Este arquivo mede
 * o isolamento entre duas organizações, o piso de papel (viewer e agent leem, só manager escreve), o contrato
 * das constraints e a trava de suporte plantada por `fn_aplicar_travas_de_suporte()`.
 *
 * Roda contra Postgres real via `pnpm test:db` (não roda no `test:unit`).
 */

const ORG_B = "dddddddd-9039-4000-8000-000000000001";
const USER_B = "dddddddd-9039-4000-8000-000000000002";
const PIPELINE_B = "dddddddd-9039-4000-8000-000000000003";
const STAGE_B = "dddddddd-9039-4000-8000-000000000004";
const PIPELINE_A2 = "dddddddd-9039-4000-8000-000000000005";
const STAGE_A_TEMP = "dddddddd-9039-4000-8000-000000000006";
const EV_A = "eeeeeeee-9039-4000-8000-000000000011";
const EV_B = "eeeeeeee-9039-4000-8000-000000000012";
const EV_FK = "eeeeeeee-9039-4000-8000-000000000013";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const insertA = (key: string) =>
  `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label)
     values ('${GOV_ORG}', '${GOV_PIPELINE}', '${key}', 'Rótulo')`;

function limpar(): void {
  sql(`
    delete from public.crm_pipeline_events where id in ('${EV_A}', '${EV_B}', '${EV_FK}');
    delete from public.crm_pipeline_events where organization_id in ('${GOV_ORG}', '${ORG_B}');
  `);
}

beforeAll(() => {
  seedGov();
  limpar();
  sql(`
    insert into auth.users (id, email) values ('${USER_B}', 'eventos-funil-org-b@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'inv-eventos-b', 'Eventos Org B', 'Eventos B') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${PIPELINE_B}', '${ORG_B}', 'Funil B', 'inv-eventos-b') on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${STAGE_B}', '${ORG_B}', '${PIPELINE_B}', 'Compras', 'compras', 1000) on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${PIPELINE_A2}', '${GOV_ORG}', 'Segundo funil A', 'inv-eventos-a2') on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${STAGE_A_TEMP}', '${GOV_ORG}', '${GOV_PIPELINE}', 'Temporária', 'temporaria-eventos', 9000) on conflict do nothing;
    insert into public.crm_pipeline_events (id, organization_id, pipeline_id, key, label, stage_id)
      values ('${EV_A}', '${GOV_ORG}', '${GOV_PIPELINE}', 'purchase', 'Compra A', '${GOV_STAGE}');
    insert into public.crm_pipeline_events (id, organization_id, pipeline_id, key, label, stage_id)
      values ('${EV_B}', '${ORG_B}', '${PIPELINE_B}', 'purchase', 'Compra B', '${STAGE_B}');
  `);
});

afterAll(async () => {
  limpar();
  sql(`delete from public.crm_stages where id = '${STAGE_A_TEMP}';`);
  await pool.end();
});

describe("crm_pipeline_events — a tabela existe e fecha o acesso anônimo", () => {
  it("controle: a tabela foi criada pela migration", () => {
    expect(tableExists("crm_pipeline_events")).toBe(true);
  });

  it("anon não tem privilégio nenhum; authenticated lê e escreve (a RLS decide); service_role tem tudo", () => {
    const priv = (papel: string, p: string) =>
      sql(`select has_table_privilege('${papel}', 'public.crm_pipeline_events', '${p}');`);
    for (const p of ["select", "insert", "update", "delete"]) expect(priv("anon", p)).toBe("f");
    for (const p of ["select", "insert", "update", "delete"]) expect(priv("authenticated", p)).toBe("t");
    expect(priv("service_role", "select")).toBe("t");
    expect(priv("service_role", "delete")).toBe("t");
    // O `revoke all` tirou o que o default ACL do baseline daria de sobra.
    expect(priv("authenticated", "truncate")).toBe("f");
  });
});

describe("crm_pipeline_events — isolamento entre organizações (RLS)", () => {
  it("membro da A vê o evento da A e não o da B; o da B vê o contrário", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.crm_pipeline_events where id = '${EV_A}';`)).toBe(1);
    expect(countAs(GOV_VIEWER, `select count(*) from public.crm_pipeline_events where id = '${EV_B}';`)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.crm_pipeline_events where id = '${EV_B}';`)).toBe(1);
    expect(countAs(USER_B, `select count(*) from public.crm_pipeline_events where id = '${EV_A}';`)).toBe(0);
  });

  it("manager da A não insere, não edita e não apaga evento da B", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label)
           values ('${ORG_B}', '${PIPELINE_B}', 'intruso', 'Intruso')`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(GOV_MANAGER, `update public.crm_pipeline_events set label = 'sequestrado' where id = '${EV_B}'`),
    ).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.crm_pipeline_events where id = '${EV_B}'`)).toBe(0);
    expect(sql(`select label from public.crm_pipeline_events where id = '${EV_B}';`)).toBe("Compra B");
  });

  it("manager da A não grava cadastro da B nem usando o funil da A como alvo", () => {
    // A organização do cadastro é a da sessão. O que fecha esta porta é a RLS olhar `organization_id`; validar que o
    // funil pertence à organização é trabalho da API de cadastro.
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label)
           values ('${ORG_B}', '${GOV_PIPELINE}', 'cruzado', 'Cruzado')`,
      ),
    ).toBe(0);
  });
});

describe("crm_pipeline_events — piso de papel na escrita", () => {
  it("manager escreve na própria organização (controle positivo dos casos abaixo)", () => {
    expect(writeCountAs(GOV_MANAGER, insertA("manager_pode"))).toBe(1);
    sql(`delete from public.crm_pipeline_events where key = 'manager_pode';`);
  });

  it("viewer e agent não inserem", () => {
    expect(writeCountAs(GOV_VIEWER, insertA("viewer_nao"))).toBe(0);
    expect(writeCountAs(GOV_AGENT_A, insertA("agent_nao"))).toBe(0);
  });

  it("viewer e agent não editam nem apagam o cadastro da própria organização (DELETE só passa pelo USING)", () => {
    for (const quem of [GOV_VIEWER, GOV_AGENT_A]) {
      expect(
        writeCountAs(quem, `update public.crm_pipeline_events set label = 'editado' where id = '${EV_A}'`),
      ).toBe(0);
      expect(writeCountAs(quem, `delete from public.crm_pipeline_events where id = '${EV_A}'`)).toBe(0);
    }
    expect(sql(`select label from public.crm_pipeline_events where id = '${EV_A}';`)).toBe("Compra A");
  });
});

describe("crm_pipeline_events — o contrato das constraints", () => {
  it("a mesma chave duas vezes no MESMO funil: 23505", async () => {
    await expect(
      pool.query(`
        insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label)
          values ('${GOV_ORG}', '${GOV_PIPELINE}', 'purchase', 'Outra compra');
      `),
    ).rejects.toMatchObject({ code: "23505", constraint: "crm_pipeline_events_chave_unica" });
  });

  it("a mesma chave em funis DIFERENTES (da mesma ou de outra organização) é aceita", async () => {
    await pool.query(`
      insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label)
        values ('${GOV_ORG}', '${PIPELINE_A2}', 'purchase', 'Compra do segundo funil');
    `);
    const { rows } = await pool.query(
      `select count(*)::int as n from public.crm_pipeline_events where key = 'purchase' and organization_id in ('${GOV_ORG}', '${ORG_B}')`,
    );
    expect(rows[0].n).toBe(3);
  });

  it.each([
    ["chave com maiúscula", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label) values ('${GOV_ORG}', '${PIPELINE_A2}', 'Compra', 'x')`, "crm_pipeline_events_key_formato"],
    ["chave começando por número", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label) values ('${GOV_ORG}', '${PIPELINE_A2}', '1compra', 'x')`, "crm_pipeline_events_key_formato"],
    ["chave com 65 caracteres", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label) values ('${GOV_ORG}', '${PIPELINE_A2}', 'a${"b".repeat(64)}', 'x')`, "crm_pipeline_events_key_formato"],
    ["nome vazio", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label) values ('${GOV_ORG}', '${PIPELINE_A2}', 'vazio', '')`, "crm_pipeline_events_label_tamanho"],
    ["caminho do valor sem unidade", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label, value_path) values ('${GOV_ORG}', '${PIPELINE_A2}', 'sem_unidade', 'x', 'value')`, "crm_pipeline_events_valor_junto"],
    ["unidade sem caminho do valor", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label, value_unit) values ('${GOV_ORG}', '${PIPELINE_A2}', 'sem_caminho', 'x', 'reais')`, "crm_pipeline_events_valor_junto"],
    ["unidade fora do vocabulário", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label, value_path, value_unit) values ('${GOV_ORG}', '${PIPELINE_A2}', 'dolares', 'x', 'value', 'dolares')`, "crm_pipeline_events_unidade"],
    ["caminho com ponto duplo", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label, value_path, value_unit) values ('${GOV_ORG}', '${PIPELINE_A2}', 'ponto_duplo', 'x', 'a..b', 'reais')`, "crm_pipeline_events_caminho_do_valor"],
    ["caminho com índice de lista", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label, dedupe_path) values ('${GOV_ORG}', '${PIPELINE_A2}', 'indice', 'x', 'items[0].id')`, "crm_pipeline_events_caminho_da_repeticao"],
    ["guardar em com hífen", `insert into public.crm_pipeline_events (organization_id, pipeline_id, key, label, state_key) values ('${GOV_ORG}', '${PIPELINE_A2}', 'estado_ruim', 'x', 'meu-estado')`, "crm_pipeline_events_state_key_formato"],
  ])("recusa %s (23514)", async (_nome, comando, constraint) => {
    await expect(pool.query(comando)).rejects.toMatchObject({ code: "23514", constraint });
  });

  it("um cadastro completo (valor, repetição e guardar em) é aceito", async () => {
    await pool.query(`
      insert into public.crm_pipeline_events
        (organization_id, pipeline_id, key, label, state_key, value_path, value_unit, dedupe_path, respects_manual_move)
        values ('${GOV_ORG}', '${PIPELINE_A2}', 'compra_completa', 'Compra completa', 'pedido', 'pedido.total', 'reais', 'order_id', false);
    `);
    const { rows } = await pool.query(
      `select respects_manual_move, is_active from public.crm_pipeline_events where key = 'compra_completa'`,
    );
    expect(rows[0]).toEqual({ respects_manual_move: false, is_active: true });
  });

  it("o padrão é respeitar o movimento manual e nascer ativo", async () => {
    const { rows } = await pool.query(
      `select respects_manual_move, is_active from public.crm_pipeline_events where id = '${EV_A}'`,
    );
    expect(rows[0]).toEqual({ respects_manual_move: true, is_active: true });
  });
});

describe("crm_pipeline_events — chaves estrangeiras", () => {
  it("apagar a etapa de destino anula o destino e preserva o evento (on delete set null)", async () => {
    sql(`
      insert into public.crm_pipeline_events (id, organization_id, pipeline_id, key, label, stage_id)
        values ('${EV_FK}', '${GOV_ORG}', '${GOV_PIPELINE}', 'etapa_apagada', 'Etapa apagada', '${STAGE_A_TEMP}');
    `);
    expect(sql(`select stage_id is not null from public.crm_pipeline_events where id = '${EV_FK}';`)).toBe("t");
    sql(`delete from public.crm_stages where id = '${STAGE_A_TEMP}';`);
    expect(sql(`select stage_id is null from public.crm_pipeline_events where id = '${EV_FK}';`)).toBe("t");
  });

  it("apagar o funil leva o cadastro junto (cascade)", () => {
    expect(
      sql(`select count(*) from public.crm_pipeline_events where pipeline_id = '${PIPELINE_A2}';`),
    ).not.toBe("0");
    sql(`delete from public.crm_pipelines where id = '${PIPELINE_A2}';`);
    expect(sql(`select count(*) from public.crm_pipeline_events where pipeline_id = '${PIPELINE_A2}';`)).toBe("0");
  });
});

describe("crm_pipeline_events — a trava do suporte", () => {
  it("as três políticas restritivas support_write_* foram plantadas por fn_aplicar_travas_de_suporte()", () => {
    const nomes = sql(`
      select string_agg(polname || ':' || (not polpermissive)::text, ',' order by polname)
        from pg_policy
       where polrelid = 'public.crm_pipeline_events'::regclass and polname like 'support_write_%';
    `);
    expect(nomes).toBe(
      "support_write_delete:true,support_write_insert:true,support_write_update:true",
    );
  });

  it("as duas políticas de isolamento existem, com os nomes do padrão do repositório", () => {
    const nomes = sql(`
      select string_agg(polname, ',' order by polname) from pg_policy
       where polrelid = 'public.crm_pipeline_events'::regclass and polname like 'tenant_isolation_%';
    `);
    expect(nomes).toBe(
      "tenant_isolation_crm_pipeline_events_select,tenant_isolation_crm_pipeline_events_write",
    );
  });
});
