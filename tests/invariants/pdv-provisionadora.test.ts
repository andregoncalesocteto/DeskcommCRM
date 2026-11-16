/**
 * A PROVISIONADORA DO MÓDULO PDV — a tabela de lojas nasce na instalação do módulo
 * (ADR-0002, D2/D3/D4/D5; US-001 do módulo PDV).
 *
 * Duas coisas aqui:
 *
 *   1. o molde da casa (`moldeDeProvisionadora`): forma da D4 (sem parâmetro, `execute` só de
 *      `service_role` nas duas origens, corpo que não escreve fora do módulo) e efeito —
 *      `pdv_stores` NÃO existe antes de provisionar, existe depois, nasce com RLS e sem `anon`,
 *      e o núcleo fica intocado;
 *   2. o isolamento entre tenants, medido como a sessão do usuário (PostgREST): duas
 *      organizações, e nenhuma lê nem escreve as lojas da outra. Mais as duas unicidades
 *      declaradas e a FK de `channel_session_id`.
 *
 * O banco do arquivo vem do baseline SEM o módulo (um banco por arquivo): é a pré-condição do
 * "não existe antes". Quem pusesse `pdv_stores` de volta no baseline reprovaria o molde.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_ORG, lastLine, seedGov, sql, tableExists, writeCountAs, countAs } from "./gov-helpers";
import { moldeDeProvisionadora } from "./molde-de-provisionadora";

const ORG_B = "cccccccc-9999-4000-8000-00000000e0b0";
const LOJA_A = "cccccccc-9999-4000-8000-00000000e001";
const LOJA_B = "cccccccc-9999-4000-8000-00000000e002";

// DECLARADO ANTES do molde, que provisiona dentro dos casos dele: o vitest executa os describes
// na ordem do arquivo, então esta é a leitura do banco recém-aplicado do baseline, sem o módulo.
describe("pdv_stores: o módulo desligado não deixa tabela", () => {
  it("antes de instalar o módulo, a tabela não existe", () => {
    expect(tableExists("pdv_stores")).toBe(false);
  });
});

// Forma da D4 e efeito (a tabela nasce protegida, o núcleo fica intocado).
moldeDeProvisionadora({ modulo: "pdv", tabelas: ["pdv_stores"] });

describe("pdv_stores: depois de provisionar", () => {
  it("a tabela existe", () => {
    sql("select public.fn_pdv_provisionar();");
    expect(tableExists("pdv_stores")).toBe(true);
  });
});

describe("pdv_stores: isolamento entre duas organizações", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      select public.fn_pdv_provisionar();
      insert into public.organizations (id, slug, legal_name, display_name) values
        ('${ORG_B}', 'pdv-stores-b', 'PDV Stores B', 'PDV B')
        on conflict (id) do nothing;
      insert into public.pdv_stores (id, organization_id, erp_store_code, sigla, nome) values
        ('${LOJA_A}', '${GOV_ORG}', '10', 'CAS', 'Campinas'),
        ('${LOJA_B}', '${ORG_B}', '10', 'CAS', 'Campinas da outra org')
        on conflict (id) do nothing;
    `);
  });

  it("quem é da organização A lê só as lojas dela", () => {
    expect(countAs(GOV_AGENT_A, `select count(*) from public.pdv_stores where id = '${LOJA_A}';`)).toBe(1);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.pdv_stores where id = '${LOJA_B}';`)).toBe(0);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.pdv_stores;`)).toBe(1);
  });

  it("não escreve na organização B (insert, update e delete)", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.pdv_stores (organization_id, erp_store_code, sigla, nome) values ('${ORG_B}', '99', 'XXX', 'invasora')`,
      ),
    ).toBe(0);
    expect(writeCountAs(GOV_AGENT_A, `update public.pdv_stores set nome = 'sequestrada' where id = '${LOJA_B}'`)).toBe(0);
    expect(writeCountAs(GOV_AGENT_A, `delete from public.pdv_stores where id = '${LOJA_B}'`)).toBe(0);
    expect(lastLine(sql(`select nome from public.pdv_stores where id = '${LOJA_B}';`))).toBe("Campinas da outra org");
  });

  it("escreve na própria organização — controle positivo", () => {
    expect(writeCountAs(GOV_AGENT_A, `update public.pdv_stores set nome = 'Campinas 2' where id = '${LOJA_A}'`)).toBe(1);
  });

  it("sigla e código do ERP são únicos por organização, e não entre elas", () => {
    // Mesma sigla e mesmo código em duas organizações: já está semeado (CAS/10 em A e em B).
    expect(() =>
      sql(`insert into public.pdv_stores (organization_id, erp_store_code, sigla, nome) values ('${GOV_ORG}', '11', 'CAS', 'sigla repetida');`),
    ).toThrow(/pdv_stores_org_sigla_unico/);
    expect(() =>
      sql(`insert into public.pdv_stores (organization_id, erp_store_code, sigla, nome) values ('${GOV_ORG}', '10', 'OUT', 'código repetido');`),
    ).toThrow(/pdv_stores_org_erp_code_unico/);
  });

  it("apagar a conexão de canal não apaga a loja (channel_session_id vira nulo)", () => {
    const tipo = lastLine(
      sql(`select confdeltype::text from pg_constraint
            where conrelid = 'public.pdv_stores'::regclass and contype = 'f'
              and confrelid = 'public.channel_sessions'::regclass;`),
    );
    expect(tipo).toBe("n"); // on delete set null
  });
});
