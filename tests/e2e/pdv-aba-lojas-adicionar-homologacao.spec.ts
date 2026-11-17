/**
 * PDV: ADICIONAR LOJAS DO ERP CONTRA A HOMOLOGAÇÃO DO ERP (US-008) — caminho feliz.
 *
 * FORA DO CI (`FORA_DO_CI` do e2e.yml): depende da homologação do ERP por túnel. Precisa de um
 * servidor MCP do ERP de homologação cadastrado na organização do e2e (endereço e chave) e
 * alcançável pelo `next start`. Sem `PDV_HOMOLOGACAO=1` ela se pula, em vez de reprovar.
 *
 * Receita, depois que a homologação existir:
 *   PDV_HOMOLOGACAO=1 pnpm exec playwright test tests/e2e/pdv-aba-lojas-adicionar-homologacao.spec.ts
 * e guardar o screenshot em `evidence/modulo-pdv/us-008-homologacao.png`.
 *
 * O caminho: o gerente abre Configurações › Lojas, abre "Adicionar lojas do ERP", escolhe a
 * primeira loja ainda não adicionada, confirma e a vê na lista. Nada é interceptado.
 */
import * as path from "node:path";

import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";

test.describe("PDV: adicionar lojas contra a homologação do ERP", () => {
  test.skip(!process.env.PDV_HOMOLOGACAO, "depende da homologação do ERP por túnel (PDV_HOMOLOGACAO=1)");

  test("o gerente escolhe uma loja do ERP de verdade e ela entra na lista", async ({ page }) => {
    test.setTimeout(120_000);
    await loginComoDono(page, lerCreds());
    await page.goto("/app/settings/tenant/lojas");
    await page.getByTestId("adicionar-lojas").click();

    const modal = page.getByTestId("adicionar-lojas-modal");
    await expect(page.getByTestId("adicionar-lista"), "o ERP de homologação não devolveu lojas novas").toBeVisible({ timeout: 30_000 });
    // `has:` é relativo ao <li>: o filtro tem de ser um locator solto, não um escopado ao modal.
    const linha = modal.locator("li").filter({ has: page.locator('input[type="checkbox"]:not(:disabled)') }).first();
    const livre = linha.locator('input[type="checkbox"]');
    const sigla = (await linha.locator("span.font-mono").innerText()).trim();
    await livre.check();
    await modal.getByRole("button", { name: "Adicionar", exact: true }).click();

    await expect(modal).toHaveCount(0);
    await expect(page.getByText("Lojas adicionadas", { exact: true })).toBeVisible();
    await expect(page.getByTestId("lojas-lista")).toContainText(sigla);
    await page.screenshot({ path: path.join(process.cwd(), "evidence", "modulo-pdv", "us-008-homologacao.png"), fullPage: true });
  });
});
