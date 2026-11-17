/**
 * PDV: IDENTIFICAR CLIENTE CONTRA A HOMOLOGAÇÃO DO ERP (US-011) — caminho feliz.
 *
 * FORA DO CI (`FORA_DO_CI` do e2e.yml): depende da homologação do ERP por túnel. Precisa de um
 * servidor MCP do ERP de homologação cadastrado na organização do e2e (endereço e chave) e do
 * módulo `pdv` instalado. Sem `PDV_HOMOLOGACAO=1` ela se pula, em vez de reprovar.
 *
 * Receita, depois que a homologação existir:
 *   PDV_HOMOLOGACAO=1 PDV_HOMOLOGACAO_NOME=<parte do nome de um cliente da homologação> \
 *     pnpm exec playwright test tests/e2e/pdv-identificar-cliente-homologacao.spec.ts
 * e guardar o screenshot em `evidence/modulo-pdv/us-011-homologacao.png`.
 *
 * O caminho: o atendente abre Identificar cliente, busca por nome e vê ao menos um candidato com
 * nome e endereço. Nada é interceptado.
 */
import * as path from "node:path";

import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";

test.describe("PDV: identificar cliente contra a homologação do ERP", () => {
  test.skip(!process.env.PDV_HOMOLOGACAO, "depende da homologação do ERP por túnel (PDV_HOMOLOGACAO=1)");

  test("o atendente busca por nome e vê os candidatos do ERP", async ({ page }) => {
    test.setTimeout(120_000);
    await loginComoDono(page, lerCreds());
    await page.goto("/app/pdv/clientes");

    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "Nome" }).click();
    await page.getByTestId("busca-termo").fill(process.env.PDV_HOMOLOGACAO_NOME ?? "maria");
    await page.getByTestId("busca-buscar").click();

    const lista = page.getByTestId("resultados-lista");
    await expect(lista, "a homologação precisa ter um cliente com esse nome").toBeVisible({ timeout: 60_000 });
    expect(await lista.locator("li").count()).toBeGreaterThan(0);
    await page.screenshot({ path: path.join(process.cwd(), "evidence", "modulo-pdv", "us-011-homologacao.png"), fullPage: true });
  });
});
