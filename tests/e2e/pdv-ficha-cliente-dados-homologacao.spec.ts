/**
 * PDV: FICHA DO CLIENTE, DADOS PESSOAIS, CONTRA A HOMOLOGAÇÃO DO ERP (US-016) — caminho feliz.
 *
 * FORA DO CI (`FORA_DO_CI` do e2e.yml): depende da homologação do ERP por túnel. Precisa de um
 * servidor MCP do ERP de homologação cadastrado na organização do e2e e do módulo `pdv` instalado.
 * Sem `PDV_HOMOLOGACAO=1` ela se pula, em vez de reprovar. Executada em 2026-11-17 contra o ERP
 * real (passou). O screenshot grava uma pessoa real: NÃO o versione.
 *
 * Receita, depois que a homologação existir:
 *   PDV_HOMOLOGACAO=1 PDV_HOMOLOGACAO_NOME=<parte do nome de um cliente da homologação> \
 *     pnpm exec playwright test tests/e2e/pdv-ficha-cliente-dados-homologacao.spec.ts
 * e guardar o screenshot em `evidence/modulo-pdv/us-016-homologacao.png`.
 *
 * O caminho: o atendente busca por nome, escolhe o primeiro candidato e vê a ficha com o nome
 * dele e o CPF mascarado (ou "Não informado"). Nada é interceptado.
 */
import * as path from "node:path";

import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";

test.describe("PDV: ficha do cliente contra a homologação do ERP", () => {
  test.skip(!process.env.PDV_HOMOLOGACAO, "depende da homologação do ERP por túnel (PDV_HOMOLOGACAO=1)");

  test("o atendente escolhe um candidato e vê os dados pessoais do ERP", async ({ page }) => {
    test.setTimeout(120_000);
    await loginComoDono(page, lerCreds());
    await page.goto("/app/pdv/clientes");

    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "Nome" }).click();
    await page.getByTestId("busca-termo").fill(process.env.PDV_HOMOLOGACAO_NOME ?? "maria");
    await page.getByTestId("busca-buscar").click();

    const lista = page.getByTestId("resultados-lista");
    await expect(lista, "a homologação precisa ter um cliente com esse nome").toBeVisible({ timeout: 60_000 });
    const primeiro = lista.locator("button").first();
    const nome = (await primeiro.locator("span").first().innerText()).trim();
    await primeiro.click();

    await expect(page.getByTestId("ficha"), "a ficha do ERP não abriu").toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("ficha-nome-valor")).toHaveText(nome);
    expect(await page.getByTestId("ficha-cpf-valor").innerText()).toMatch(/^(\*{3}\.\*{3}\.\*\d{2}-\d{2}|Não informado)$/);
    await page.screenshot({ path: path.join(process.cwd(), "evidence", "modulo-pdv", "us-016-homologacao.png"), fullPage: true });
  });
});
