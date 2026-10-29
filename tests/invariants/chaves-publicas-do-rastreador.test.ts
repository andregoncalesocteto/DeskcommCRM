import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_PIPELINE,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
  tableExists,
  writeCountAs,
} from "./gov-helpers";

/**
 * CHAVES PÚBLICAS DO RASTREADOR (`crm_tracker_public_keys`) — o identificador que vai no HTML do site do cliente.
 *
 * A chave NÃO é segredo. O que este arquivo prova é o que a faz segura de expor: ela resolve a organização e o funil
 * pela PRÓPRIA linha (nunca pelo corpo da requisição), é gerada pelo banco, revogar desativa na hora e a tabela é
 * isolada por organização e só o gerente a lê e a escreve.
 *
 * Roda contra Postgres real via `pnpm test:db` (não roda no `test:unit`).
 */

const ORG_B = "dddddddd-9041-4000-8000-000000000001";
const USER_B = "dddddddd-9041-4000-8000-000000000002";
const PIPELINE_B = "dddddddd-9041-4000-8000-000000000003";
const KEY_A = "eeeeeeee-9041-4000-8000-000000000011";
const KEY_B = "eeeeeeee-9041-4000-8000-000000000012";

const inserirA = (rotulo: string, origens = "array['https://loja.exemplo']") =>
  `insert into public.crm_tracker_public_keys (organization_id, pipeline_id, label, allowed_origins)
     values ('${GOV_ORG}', '${GOV_PIPELINE}', '${rotulo}', ${origens})`;

function limpar(): void {
  sql(`delete from public.crm_tracker_public_keys where organization_id in ('${GOV_ORG}', '${ORG_B}');`);
}

beforeAll(() => {
  seedGov();
  limpar();
  sql(`
    insert into auth.users (id, email) values ('${USER_B}', 'chaves-publicas-org-b@invariant.test') on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'inv-chaves-b', 'Chaves Org B', 'Chaves B') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${USER_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${PIPELINE_B}', '${ORG_B}', 'Funil B', 'inv-chaves-b') on conflict do nothing;
    insert into public.crm_tracker_public_keys (id, organization_id, pipeline_id, label, allowed_origins)
      values ('${KEY_A}', '${GOV_ORG}', '${GOV_PIPELINE}', 'Site A', array['https://loja-a.exemplo']);
    insert into public.crm_tracker_public_keys (id, organization_id, pipeline_id, label, allowed_origins)
      values ('${KEY_B}', '${ORG_B}', '${PIPELINE_B}', 'Site B', array['https://loja-b.exemplo']);
  `);
});

afterAll(() => {
  limpar();
});

describe("crm_tracker_public_keys — a tabela existe e fecha o acesso anônimo", () => {
  it("controle: a tabela foi criada pela migration", () => {
    expect(tableExists("crm_tracker_public_keys")).toBe(true);
  });

  it("anon não tem privilégio nenhum; authenticated lê e escreve (a RLS decide); service_role tem tudo", () => {
    const priv = (papel: string, p: string) =>
      sql(`select has_table_privilege('${papel}', 'public.crm_tracker_public_keys', '${p}');`);
    for (const p of ["select", "insert", "update", "delete"]) expect(priv("anon", p)).toBe("f");
    for (const p of ["select", "insert", "update", "delete"]) expect(priv("authenticated", p)).toBe("t");
    expect(priv("service_role", "select")).toBe("t");
    expect(priv("authenticated", "truncate")).toBe("f");
  });
});

describe("crm_tracker_public_keys — isolamento e papel", () => {
  it("manager da A vê a chave da A e não a da B; o admin da B vê o contrário", () => {
    expect(countAs(GOV_MANAGER, `select count(*) from public.crm_tracker_public_keys where id = '${KEY_A}';`)).toBe(1);
    expect(countAs(GOV_MANAGER, `select count(*) from public.crm_tracker_public_keys where id = '${KEY_B}';`)).toBe(0);
    expect(countAs(USER_B, `select count(*) from public.crm_tracker_public_keys where id = '${KEY_B}';`)).toBe(1);
    expect(countAs(USER_B, `select count(*) from public.crm_tracker_public_keys where id = '${KEY_A}';`)).toBe(0);
  });

  it("viewer e agent da própria organização NÃO leem as chaves (leitura é de manager para cima)", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.crm_tracker_public_keys where id = '${KEY_A}';`)).toBe(0);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.crm_tracker_public_keys where id = '${KEY_A}';`)).toBe(0);
  });

  it("manager da A não insere, edita nem apaga chave da B, nem usa o funil da A para gravar na B", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.crm_tracker_public_keys (organization_id, pipeline_id, label, allowed_origins)
           values ('${ORG_B}', '${PIPELINE_B}', 'intruso', array['https://x.exemplo'])`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.crm_tracker_public_keys (organization_id, pipeline_id, label, allowed_origins)
           values ('${ORG_B}', '${GOV_PIPELINE}', 'cruzado', array['https://x.exemplo'])`,
      ),
    ).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `update public.crm_tracker_public_keys set label = 'sequestrada' where id = '${KEY_B}'`)).toBe(0);
    expect(writeCountAs(GOV_MANAGER, `delete from public.crm_tracker_public_keys where id = '${KEY_B}'`)).toBe(0);
    expect(sql(`select label from public.crm_tracker_public_keys where id = '${KEY_B}';`)).toBe("Site B");
  });

  it("manager escreve na própria organização; viewer e agent não escrevem", () => {
    expect(writeCountAs(GOV_MANAGER, inserirA("do manager"))).toBe(1);
    expect(writeCountAs(GOV_VIEWER, inserirA("do viewer"))).toBe(0);
    expect(writeCountAs(GOV_AGENT_A, inserirA("do agent"))).toBe(0);
  });
});

describe("crm_tracker_public_keys — a chave resolve organização e funil, e só ela", () => {
  it("o banco gera a chave: formato pk_ + 36 hex, e duas chaves nunca são iguais", () => {
    const chaves = sql(
      `select string_agg(public_key, ',') from public.crm_tracker_public_keys where organization_id = '${GOV_ORG}';`,
    ).split(",");
    expect(chaves.length).toBeGreaterThanOrEqual(2);
    for (const c of chaves) expect(c).toMatch(/^pk_[a-f0-9]{36}$/);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("⭐ a chave ativa resolve exatamente a organização e o funil da sua linha", () => {
    const chaveA = sql(`select public_key from public.crm_tracker_public_keys where id = '${KEY_A}';`);
    const par = sql(
      `select organization_id || '|' || pipeline_id from public.crm_tracker_public_keys
        where public_key = '${chaveA}' and is_active;`,
    );
    expect(par).toBe(`${GOV_ORG}|${GOV_PIPELINE}`);
    // A chave de uma organização nunca resolve a outra: a organização vem da linha, não de quem pergunta.
    const chaveB = sql(`select public_key from public.crm_tracker_public_keys where id = '${KEY_B}';`);
    expect(
      sql(`select organization_id from public.crm_tracker_public_keys where public_key = '${chaveB}' and is_active;`),
    ).toBe(ORG_B);
  });

  it("⭐ revogar desativa na hora: a chave revogada deixa de resolver", () => {
    sql(`update public.crm_tracker_public_keys set is_active = false, revoked_at = now() where id = '${KEY_A}';`);
    const chaveA = sql(`select public_key from public.crm_tracker_public_keys where id = '${KEY_A}';`);
    expect(sql(`select count(*) from public.crm_tracker_public_keys where public_key = '${chaveA}' and is_active;`)).toBe("0");
  });
});

describe("crm_tracker_public_keys — contrato das constraints", () => {
  const recusa = (comando: string) => {
    try {
      sql(comando);
      return "";
    } catch (e) {
      return String((e as Error).message);
    }
  };

  it("revogada com is_active verdadeiro é recusada: não existe chave revogada que ainda valha", () => {
    expect(
      recusa(`update public.crm_tracker_public_keys set revoked_at = now() where id = '${KEY_B}'`),
    ).toContain("crm_tracker_public_keys_revogada_inativa");
  });

  it("zero origens e mais de 20 origens são recusadas", () => {
    expect(recusa(inserirA("sem origem", "array[]::text[]"))).toContain("crm_tracker_public_keys_origens_quantidade");
    const muitas = Array.from({ length: 21 }, (_, i) => `'https://s${i}.exemplo'`).join(",");
    expect(recusa(inserirA("origens demais", `array[${muitas}]`))).toContain("crm_tracker_public_keys_origens_quantidade");
  });

  it("rótulo vazio e rótulo com mais de 80 caracteres são recusados", () => {
    expect(recusa(inserirA(""))).toContain("crm_tracker_public_keys_label_tamanho");
    expect(recusa(inserirA("x".repeat(81)))).toContain("crm_tracker_public_keys_label_tamanho");
  });

  it("chave fora do formato é recusada (a chave não é escolhida por quem escreve)", () => {
    expect(
      recusa(
        `update public.crm_tracker_public_keys set public_key = 'qualquer-coisa' where id = '${KEY_B}'`,
      ),
    ).toContain("crm_tracker_public_keys_formato");
  });

  it("apagar o funil leva as chaves junto (cascata), sem deixar chave órfã", () => {
    sql(`
      insert into public.crm_pipelines (id, organization_id, name, slug)
        values ('dddddddd-9041-4000-8000-000000000009', '${ORG_B}', 'Funil efêmero', 'inv-chaves-efemero');
      insert into public.crm_tracker_public_keys (organization_id, pipeline_id, label, allowed_origins)
        values ('${ORG_B}', 'dddddddd-9041-4000-8000-000000000009', 'efêmera', array['https://e.exemplo']);
      delete from public.crm_pipelines where id = 'dddddddd-9041-4000-8000-000000000009';
    `);
    expect(
      sql(`select count(*) from public.crm_tracker_public_keys where pipeline_id = 'dddddddd-9041-4000-8000-000000000009';`),
    ).toBe("0");
  });
});

describe("crm_tracker_public_keys — a trava do suporte", () => {
  it("as três políticas restritivas support_write_* foram plantadas, e a de isolamento existe", () => {
    expect(
      sql(`
        select string_agg(polname || ':' || (not polpermissive)::text, ',' order by polname)
          from pg_policy
         where polrelid = 'public.crm_tracker_public_keys'::regclass and polname like 'support_write_%';
      `),
    ).toBe("support_write_delete:true,support_write_insert:true,support_write_update:true");
    expect(
      sql(`select string_agg(polname, ',') from pg_policy
            where polrelid = 'public.crm_tracker_public_keys'::regclass and polname like 'tenant_isolation_%';`),
    ).toBe("tenant_isolation_crm_tracker_public_keys_all");
  });
});
