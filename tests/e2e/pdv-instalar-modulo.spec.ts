/**
 * PDV PELA TELA: O DONO DA INSTALAÇÃO ACHA O MÓDULO E O INSTALA (US-002).
 *
 * O módulo `pdv` é de tabela (ADR-0002): as `pdv_*` só nascem quando o administrador da
 * instalação instala em `/admin/modulos`. O banco deste e2e é o `baseline.sql` do zero, sem o
 * módulo, que é o estado de quem acabou de instalar o CRM.
 *
 * O caminho, como um leigo faria:
 *   1. o dono abre "Módulos" no painel da instalação e vê o PDV listado;
 *   2. clica em Instalar e o cartão passa a mostrar "instalado";
 *   3. recarrega a tela e o estado se mantém (instalar de novo não falha nem duplica).
 *
 * As rotas `/api/v1/pdv/*` do próprio CRM são interceptadas: ainda não pertencem a esta
 * história (e a tela de módulos não as chama), então a spec não depende de nenhuma delas e
 * prova que a instalação não precisa do ERP. Nenhuma fala com o ERP real.
 *
 * ⚠️ Instalar é da INSTALAÇÃO e não se desfaz, como em `honorarios-instalar-e-pagar`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "./helpers/test";

import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "modulo-pdv");

test.describe("PDV: instalar o módulo pela tela de módulos", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("o PDV aparece em Módulos, instala com sucesso e instalar de novo não falha", async ({ page }) => {
    test.setTimeout(120_000);
    await page.route("**/api/v1/pdv/**", (rota) =>
      rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
    );
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const cartao = page.getByTestId("modulo-pdv");
    await expect(cartao, "a tela de módulos não lista o PDV").toBeVisible();
    await expect(cartao).toContainText(/PDV/);

    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) {
      await page.screenshot({ path: path.join(EVIDENCIA, "us-002-antes-de-instalar.png"), fullPage: true });
      await instalar.click();
    }
    // O selo, em texto exato: /instalado/i casaria também a descrição do cartão ("…onde o módulo é instalado").
    await expect(cartao.getByText("Instalado", { exact: true }), "o módulo não ficou instalado").toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("modulos-erro")).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-002-instalado.png"), fullPage: true });

    // Recarregar mantém o estado, e o botão de instalar some: nada a duplicar.
    await page.reload();
    await expect(page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true })).toBeVisible();
    await expect(page.getByTestId("instalar-pdv")).toHaveCount(0);
  });
});
