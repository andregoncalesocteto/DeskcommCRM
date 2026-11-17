/**
 * PDV: FICHA DO CLIENTE, ENDEREÇOS, CONTRA A HOMOLOGAÇÃO DO ERP (US-017) — caminho feliz.
 *
 * FORA DO CI (`FORA_DO_CI` do e2e.yml): depende da homologação do ERP por túnel. Precisa de um
 * servidor MCP do ERP de homologação cadastrado na organização do e2e e do módulo `pdv` instalado.
 * Sem `PDV_HOMOLOGACAO=1` ela se pula. NUNCA foi executada: os seletores vêm da spec interceptada.
 *
 * Receita, depois que a homologação existir:
 *   PDV_HOMOLOGACAO=1 PDV_HOMOLOGACAO_NOME=<parte do nome de um cliente com endereço> \
 *     pnpm exec playwright test tests/e2e/pdv-ficha-cliente-enderecos-homologacao.spec.ts
 * e guardar o screenshot em `evidence/modulo-pdv/us-017-homologacao.png`.
 *
 * O caminho: o atendente busca por nome, escolhe o primeiro candidato e vê "Endereços (N)", cada
 * card com a linha "Loja de entrega: <sigla>" ou "Loja de entrega ainda não definida", sem botão.
 */
import * as path from "node:path";

import { expect, test } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";

test.describe("PDV: endereços da ficha contra a homologação do ERP", () => {
  test.skip(
    !process.env.PDV_HOMOLOGACAO,
    "depende da homologação do ERP por túnel (PDV_HOMOLOGACAO=1)",
  );

  test("o atendente vê os endereços do cliente com a loja de entrega do ERP", async ({ page }) => {
    test.setTimeout(120_000);
    await loginComoDono(page, lerCreds());
    await page.goto("/app/pdv/clientes");

    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "Nome" }).click();
    await page.getByTestId("busca-termo").fill(process.env.PDV_HOMOLOGACAO_NOME ?? "maria");
    await page.getByTestId("busca-buscar").click();

    const lista = page.getByTestId("resultados-lista");
    await expect(lista, "a homologação precisa ter um cliente com esse nome").toBeVisible({
      timeout: 60_000,
    });
    await lista.locator("button").first().click();

    const bloco = page.getByTestId("enderecos");
    await expect(bloco, "o bloco de endereços não abriu").toBeVisible({ timeout: 60_000 });
    await expect(bloco.locator("h2")).toHaveText(/^Endereços \(\d+\)$/);
    const n = await page.getByTestId("endereco").count();
    if (n === 0) {
      await expect(page.getByTestId("enderecos-vazio")).toBeVisible();
    } else {
      for (let i = 0; i < n; i++) {
        const card = page.getByTestId("endereco").nth(i);
        await expect(
          card.getByTestId("endereco-loja").or(card.getByTestId("endereco-sem-loja")),
        ).toBeVisible();
      }
    }
    expect(await bloco.locator("button").count()).toBe(0);
    await page.screenshot({
      path: path.join(process.cwd(), "evidence", "modulo-pdv", "us-017-homologacao.png"),
      fullPage: true,
    });
  });
});
