/**
 * PDV: ABA LOJAS CONTRA A HOMOLOGAÇÃO DO ERP (US-007) — caminho feliz.
 *
 * FORA DO CI (`FORA_DO_CI` do e2e.yml): depende da homologação do ERP por túnel. Precisa de um
 * servidor MCP do ERP de homologação cadastrado na organização do e2e (endereço e chave) e
 * alcançável pelo `next start`. Sem `PDV_HOMOLOGACAO=1` ela se pula, em vez de reprovar.
 *
 * Receita, depois que a homologação existir:
 *   PDV_HOMOLOGACAO=1 pnpm exec playwright test tests/e2e/pdv-aba-lojas-lista-homologacao.spec.ts
 * e guardar o screenshot em `evidence/modulo-pdv/us-007-homologacao.png`.
 *
 * O caminho: o gerente abre Configurações › Lojas; sem nenhuma loja cadastrada vê o vazio (ERP
 * configurado, sem a orientação de "ERP não configurado"). Nada é interceptado.
 */
import * as path from "node:path";


import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";

test.describe("PDV: aba Lojas contra a homologação do ERP", () => {
  test.skip(!process.env.PDV_HOMOLOGACAO, "depende da homologação do ERP por túnel (PDV_HOMOLOGACAO=1)");

  test("o gerente abre Lojas e a tela fala com o ERP de verdade", async ({ page }) => {
    test.setTimeout(120_000);
    await loginComoDono(page, lerCreds());
    await page.goto("/app/settings/tenant/lojas");

    await expect(page.getByTestId("lojas-carregando")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("lojas-erro")).toHaveCount(0);
    await expect(page.getByTestId("lojas-erp-nao-configurado"), "o ERP de homologação não está configurado").toHaveCount(0);
    await expect(page.getByTestId("lojas-lista").or(page.getByTestId("lojas-vazio"))).toBeVisible();
    await page.screenshot({ path: path.join(process.cwd(), "evidence", "modulo-pdv", "us-007-homologacao.png"), fullPage: true });
  });
});
