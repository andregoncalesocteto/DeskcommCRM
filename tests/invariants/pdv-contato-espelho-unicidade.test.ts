/**
 * O CONTATO ESPELHO DO PDV contra Postgres real (US-014).
 *
 * `lib/pdv/contato-espelho.ts` não escolhe quem ganha uma corrida: quem decide são as unicidades
 * do banco, e o serviço trata o `23505`. Este arquivo prova, no banco que o self-hoster tem
 * (baseline aplicado, módulo provisionado), as três coisas em que o serviço se apoia:
 *
 *   1. telefone, CPF (hash) e e-mail são únicos por organização entre contatos vivos, e a
 *      mesma pessoa em OUTRA organização não colide (o espelho é por tenant, ADR-002);
 *   2. o vínculo é único por cliente do ERP e por contato;
 *   3. duas sessões simultâneas gravando o MESMO cliente do ERP: uma ganha, a outra recebe
 *      `23505` (e só então a releitura do serviço enxerga a linha da vencedora).
 *
 * O caminho do serviço em si (variantes do nono dígito, ambíguo, órfão) é medido em
 * `lib/pdv/contato-espelho.test.ts`, com banco em memória que reproduz estas mesmas unicidades.
 */
import { execFile } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, seedGov, sql } from "./gov-helpers";

const ORG_B = "cccccccc-9999-4000-8000-00000000f0b0";
const c = (n: number) => `cccccccc-9999-4000-8000-00000000f1${String(n).padStart(2, "0")}`;
const HASH = "a".repeat(64);

/** Roda um script em uma sessão psql própria e devolve stdout/stderr, sem lançar. */
function sessao(script: string): Promise<{ ok: boolean; saida: string }> {
  const container = process.env.TEST_DB_CONTAINER as string;
  return new Promise((resolve) => {
    const proc = execFile(
      "docker",
      ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-"],
      (erro, stdout, stderr) => resolve({ ok: !erro, saida: `${stdout}${stderr}` }),
    );
    proc.stdin?.end(script);
  });
}

/** Um script que DEVE falhar: devolve a saída de erro. */
function falha(script: string): string {
  try {
    sql(script);
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? e);
  }
  throw new Error("o script não falhou, mas devia");
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_pdv_provisionar();
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'pdv-espelho-b', 'PDV Espelho B', 'PDV Espelho B')
      on conflict (id) do nothing;
  `);
});

describe("contatos: o que o serviço do espelho assume sobre a unicidade", () => {
  it("telefone repetido na mesma organização é 23505; em outra organização, não", () => {
    sql(`insert into public.contacts (id, organization_id, name, phone_number) values
      ('${c(1)}', '${GOV_ORG}', 'espelho 1', '+5519990000001');`);
    expect(
      falha(`insert into public.contacts (id, organization_id, name, phone_number)
        values ('${c(2)}', '${GOV_ORG}', 'espelho 2', '+5519990000001');`),
    ).toMatch(/uniq_contacts_org_phone/);
    sql(`insert into public.contacts (id, organization_id, name, phone_number)
      values ('${c(3)}', '${ORG_B}', 'espelho 3', '+5519990000001');`);
    expect(
      sql(`select count(*) from public.contacts where phone_number = '+5519990000001';`),
    ).toBe("2");
  });

  it("CPF (hash) repetido na mesma organização é 23505", () => {
    sql(`insert into public.contacts (id, organization_id, name, cpf_hash, cpf_encrypted)
      values ('${c(4)}', '${GOV_ORG}', 'espelho 4', '${HASH}', '\\x01');`);
    expect(
      falha(`insert into public.contacts (id, organization_id, name, cpf_hash, cpf_encrypted)
        values ('${c(5)}', '${GOV_ORG}', 'espelho 5', '${HASH}', '\\x01');`),
    ).toMatch(/uniq_contacts_org_cpf/);
  });

  it("e-mail repetido, sem diferenciar caixa, é 23505", () => {
    sql(`insert into public.contacts (id, organization_id, name, email)
      values ('${c(6)}', '${GOV_ORG}', 'espelho 6', 'Espelho@invariant.test');`);
    expect(
      falha(`insert into public.contacts (id, organization_id, name, email)
        values ('${c(7)}', '${GOV_ORG}', 'espelho 7', 'espelho@INVARIANT.test');`),
    ).toMatch(/uniq_contacts_org_email/);
  });
});

describe("pdv_customer_links: o vínculo é único", () => {
  it("o mesmo cliente do ERP não liga a dois contatos, nem um contato a dois clientes", () => {
    sql(`insert into public.pdv_customer_links (organization_id, contact_id, erp_customer_id)
      values ('${GOV_ORG}', '${c(1)}', 'erp-unico');`);
    expect(
      falha(`insert into public.pdv_customer_links (organization_id, contact_id, erp_customer_id)
        values ('${GOV_ORG}', '${c(4)}', 'erp-unico');`),
    ).toMatch(/pdv_customer_links_org_erp_customer_unico/);
    expect(
      falha(`insert into public.pdv_customer_links (organization_id, contact_id, erp_customer_id)
        values ('${GOV_ORG}', '${c(1)}', 'erp-outro');`),
    ).toMatch(/pdv_customer_links_org_contact_unico/);
  });

  it("o mesmo id do ERP em outra organização é outro vínculo", () => {
    sql(`insert into public.pdv_customer_links (organization_id, contact_id, erp_customer_id)
      values ('${ORG_B}', '${c(3)}', 'erp-unico');`);
    expect(
      sql(`select count(*) from public.pdv_customer_links where erp_customer_id = 'erp-unico';`),
    ).toBe("2");
  });
});

describe("duas sessões simultâneas para o mesmo cliente do ERP", () => {
  it("uma grava o vínculo; a outra recebe 23505 e a linha da vencedora fica visível", async () => {
    sql(`insert into public.contacts (id, organization_id, name) values
      ('${c(8)}', '${GOV_ORG}', 'corrida a'), ('${c(9)}', '${GOV_ORG}', 'corrida b')
      on conflict (id) do nothing;`);
    const inserir = (contato: string, espera: string) => `
      begin;
      insert into public.pdv_customer_links (organization_id, contact_id, erp_customer_id)
        values ('${GOV_ORG}', '${contato}', 'erp-corrida');
      select pg_sleep(${espera});
      commit;`;
    // A segura a transação aberta por 2 s; B começa no meio e fica esperando a unicidade.
    const a = sessao(inserir(c(8), "2"));
    await new Promise((r) => setTimeout(r, 700));
    const b = sessao(inserir(c(9), "0"));
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(false);
    expect(rb.saida).toMatch(/pdv_customer_links_org_erp_customer_unico/);
    expect(
      sql(`select contact_id from public.pdv_customer_links
        where organization_id = '${GOV_ORG}' and erp_customer_id = 'erp-corrida';`),
    ).toBe(c(8));
    expect(
      sql(`select count(*) from public.pdv_customer_links
        where organization_id = '${GOV_ORG}' and erp_customer_id = 'erp-corrida';`),
    ).toBe("1");
  });
});
