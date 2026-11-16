/**
 * INSTALAR O MÓDULO `pdv` DE PONTA A PONTA (US-002 do módulo PDV).
 *
 * `modulo-instalado.test.ts` prova o mecanismo com uma provisionadora de mentira; aqui o módulo
 * é o real: `fn_modulo_instalar('pdv')` chama `fn_pdv_provisionar()`, a tabela nasce, o módulo
 * fica `ativo` em `modulos_instalados` e instalar de novo (outra chave) não falha nem duplica.
 * O banco do arquivo vem do baseline SEM o módulo: nada instalado é a pré-condição.
 */
import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

if (!process.env.TEST_DB_PORT) throw new Error("TEST_DB_PORT ausente — execute pnpm test:db");
const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
  max: 2,
});
const plataforma = "e3400000-0000-4000-8000-0000000000d1";

async function instalar(operacao: string): Promise<Record<string, unknown>> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role service_role");
    const r = await c.query("select public.fn_modulo_instalar($1, $2, 'pdv') as recibo", [plataforma, operacao]);
    await c.query("commit");
    return r.rows[0].recibo;
  } catch (erro) {
    await c.query("rollback");
    throw erro;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  await pool.query("insert into auth.users(id, email) values ($1, $2) on conflict (id) do nothing", [
    plataforma,
    `${plataforma}@invariant.test`,
  ]);
  await pool.query(
    `insert into public.platform_admins(user_id, granted_by, scope, mfa_required, reason)
     values ($1, $1, 'full', false, 'Teste de instalação do pdv')
     on conflict (user_id) do update set revoked_at = null, scope = 'full'`,
    [plataforma],
  );
});

afterAll(async () => {
  await pool.end();
});

describe("módulo pdv: instalar pela função de instalação", () => {
  it("desligado por padrão: sem linha em modulos_instalados e sem a tabela", async () => {
    expect((await pool.query("select 1 from public.modulos_instalados where modulo = 'pdv'")).rowCount).toBe(0);
    expect((await pool.query("select to_regclass('public.pdv_stores') as t")).rows[0].t).toBeNull();
  });

  it("instalar provisiona a tabela e grava o módulo como ativo", async () => {
    const recibo = await instalar(randomUUID());
    expect(recibo).toMatchObject({ kind: "module_install", status: "completed", name: "pdv", applied_now: true });
    expect((await pool.query("select to_regclass('public.pdv_stores') as t")).rows[0].t).not.toBeNull();
    const m = await pool.query("select estado from public.modulos_instalados where modulo = 'pdv'");
    expect(m.rows).toEqual([{ estado: "ativo" }]);
  });

  it("instalar de novo, com outra chave, não falha nem duplica", async () => {
    await expect(instalar(randomUUID())).resolves.toMatchObject({ name: "pdv", status: "completed" });
    const m = await pool.query("select count(*)::int as n from public.modulos_instalados where modulo = 'pdv'");
    expect(m.rows[0].n).toBe(1);
  });
});
