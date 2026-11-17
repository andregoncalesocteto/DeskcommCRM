/**
 * PDV: ATIVAR, DESATIVAR E VINCULAR CONEXÃO CONTRA A HOMOLOGAÇÃO DO ERP (US-009) — caminho feliz.
 *
 * FORA DO CI (`FORA_DO_CI` do e2e.yml): depende da homologação do ERP por túnel. Precisa de um
 * servidor MCP do ERP de homologação cadastrado na organização do e2e (endereço e chave), com
 * ao menos uma loja já adicionada, e de ao menos uma conexão de WhatsApp na organização. Sem
 * `PDV_HOMOLOGACAO=1` ela se pula, em vez de reprovar.
 *
 * Receita, depois que a homologação existir:
 *   PDV_HOMOLOGACAO=1 pnpm exec playwright test tests/e2e/pdv-aba-lojas-editar-homologacao.spec.ts
 * e guardar o screenshot em `evidence/modulo-pdv/us-009-homologacao.png`.
 *
 * O caminho: o gerente abre Configurações › Lojas, desativa a primeira loja, salva, recarrega a
 * página e vê a loja inativa; depois a reativa. Nada é interceptado.
 */
import * as path from "node:path";

import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";

test.describe("PDV: editar loja contra a homologação do ERP", () => {
  test.skip(!process.env.PDV_HOMOLOGACAO, "depende da homologação do ERP por túnel (PDV_HOMOLOGACAO=1)");

  test("o gerente desativa uma loja, a mudança sobrevive ao recarregar e ele a reativa", async ({ page }) => {
    test.setTimeout(120_000);
    await loginComoDono(page, lerCreds());
    await page.goto("/app/settings/tenant/lojas");

    const lista = page.getByTestId("lojas-lista");
    await expect(lista, "a organização precisa ter ao menos uma loja adicionada").toBeVisible({ timeout: 30_000 });
    const loja = lista.locator('li[data-ativa="true"]').first();
    const id = (await loja.getAttribute("data-testid"))!.replace("loja-", "");

    await page.getByTestId(`loja-${id}-ativa`).click();
    await page.getByTestId(`loja-${id}-salvar`).click();
    await expect(page.getByText("Loja atualizada", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId(`loja-${id}`)).toHaveAttribute("data-ativa", "false");
    await page.screenshot({ path: path.join(process.cwd(), "evidence", "modulo-pdv", "us-009-homologacao.png"), fullPage: true });

    await page.getByTestId(`loja-${id}-ativa`).click();
    await page.getByTestId(`loja-${id}-salvar`).click();
    await expect(page.getByTestId(`loja-${id}`)).toHaveAttribute("data-ativa", "true");
  });
});
