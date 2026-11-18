/**
 * PDV PELA TELA: VÍNCULO DO CLIENTE DO ERP COM O CONTATO DO CRM (ADR-007).
 *
 * Abrir a ficha só LÊ. Quem liga o cliente ao contato (pelo telefone) é o atendente, com
 * "Vincular ao CRM", e quem puxa os dados do ERP é "Atualizar dados". Tudo contra `/api/v1/pdv/*`
 * INTERCEPTADA: nada fala com o ERP. Afirma, pela tela: (1) abrir a ficha não dispara POST nem
 * PATCH; (2) cliente livre mostra "Vincular ao CRM"; (3) o clique faz UM POST e a ficha passa a
 * "Vinculado ao contato" com "Atualizar dados"; (4) "Atualizar dados" faz UM PATCH; (5) cliente sem
 * telefone e telefone de outro cliente não têm botão e dizem por quê; (6) erro do vínculo aparece
 * com orientação; (7) alvos de 44 px e nenhum dado pessoal em URL ou storage.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "modulo-pdv");
const PAGINA = "/app/pdv/clientes";

function json(status: number, corpo: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(corpo) };
}

const CLIENTES = [
  { id: "c1", nome: "Maria Oliveira", endereco_principal: null },
  { id: "c2", nome: "Maria Sem Telefone", endereco_principal: null },
  { id: "c3", nome: "Maria Falha", endereco_principal: null },
];

type Vinculo = { estado: string; contact_id?: string; contato_nome?: string };

function ficha(id: string, nome: string, telefone: string | null, vinculo: Vinculo) {
  return { data: { id, vinculo, nome, telefone, email: null, cpf: null, data_nascimento: null, enderecos: [] } };
}

async function interceptar(page: Page, escritas: string[]) {
  const vinculadoC1 = { value: false };
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const url = new URL(rota.request().url());
    const metodo = rota.request().method();
    const m = /\/pdv\/clientes\/([^/]+)(\/vinculo)?$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (m[2]) {
        escritas.push(`${metodo} ${id}`);
        if (id === "c3") {
          return rota.fulfill(
            json(409, { error: { code: "telefone_de_outro_cliente", message: "O contato já está vinculado." } }),
          );
        }
        if (metodo === "POST") {
          vinculadoC1.value = true;
          return rota.fulfill(json(201, { data: { contact_id: "k1", contato_criado: true, vinculo_novo: true, sem_cpf_email: false } }));
        }
        return rota.fulfill(json(200, { data: { contact_id: "k1", sem_cpf_email: false } }));
      }
      if (id === "c1") {
        return rota.fulfill(
          json(
            200,
            ficha(
              "c1",
              "Maria Oliveira",
              "(19) 99876-5432",
              vinculadoC1.value
                ? { estado: "vinculado", contact_id: "k1", contato_nome: "Maria Oliveira" }
                : { estado: "livre" },
            ),
          ),
        );
      }
      if (id === "c2") return rota.fulfill(json(200, ficha("c2", "Maria Sem Telefone", null, { estado: "telefone_ausente" })));
      if (id === "c3") return rota.fulfill(json(200, ficha("c3", "Maria Falha", "(19) 98123-4567", { estado: "livre" })));
      return rota.fulfill(json(404, { error: { code: "not_found", message: "x" } }));
    }
    if (url.pathname.endsWith("/clientes")) {
      return rota.fulfill(json(200, { data: { clientes: CLIENTES, total_encontrado: 3, truncado: false } }));
    }
    return rota.fulfill(json(404, { error: { code: "not_found", message: "Recurso não encontrado." } }));
  });
}

async function altura(page: Page, seletor: string) {
  return page.locator(seletor).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
}

test.describe("PDV: vínculo do cliente com o contato do CRM", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("a ficha só lê; o botão vincula, o outro atualiza, e os casos sem saída explicam por quê", async ({ page }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) await instalar.click();
    await expect(page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true })).toBeVisible({ timeout: 30_000 });

    const escritas: string[] = [];
    await interceptar(page, escritas);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(PAGINA);

    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "Nome" }).click();
    await page.getByTestId("busca-termo").fill("maria");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-lista")).toBeVisible();

    // 1 e 2. Cliente livre: abrir a ficha não escreve nada; o botão aparece.
    await page.getByTestId("cliente-c1").click();
    await expect(page.getByTestId("vinculo-estado")).toHaveText("Este cliente ainda não está no CRM.");
    await expect(page.getByTestId("vinculo-vincular")).toBeVisible();
    await expect(page.getByTestId("vinculo-atualizar")).toHaveCount(0);
    expect(escritas, "abrir a ficha escreveu").toEqual([]);
    for (const h of await altura(page, '[data-testid="vinculo"] button')) expect(h, "botão abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-livre.png"), fullPage: true });

    // 3. Um clique: UM POST, e a ficha passa a vinculada com "Atualizar dados".
    await page.getByTestId("vinculo-vincular").click();
    await expect(page.getByTestId("vinculo-estado")).toHaveText("Vinculado ao contato: Maria Oliveira");
    await expect(page.getByTestId("vinculo-vincular")).toHaveCount(0);
    expect(escritas).toEqual(["POST c1"]);
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-vinculado.png"), fullPage: true });

    // 4. Atualizar dados: UM PATCH, a ficha continua vinculada.
    await page.getByTestId("vinculo-atualizar").click();
    await expect.poll(() => escritas.length).toBe(2);
    expect(escritas).toEqual(["POST c1", "PATCH c1"]);
    await expect(page.getByTestId("vinculo-estado")).toHaveText("Vinculado ao contato: Maria Oliveira");

    // 5. Cliente sem telefone: sem botão, com o motivo.
    await page.getByTestId("cliente-c2").click();
    await expect(page.getByTestId("vinculo-estado")).toContainText("não tem telefone no ERP");
    await expect(page.getByTestId("vinculo-vincular")).toHaveCount(0);
    await expect(page.getByTestId("vinculo-atualizar")).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-sem-telefone.png"), fullPage: true });

    // 6. A API recusa (telefone passou a ser de outro cliente): mensagem com orientação, botão segue.
    await page.getByTestId("cliente-c3").click();
    await page.getByTestId("vinculo-vincular").click();
    await expect(page.getByTestId("vinculo-erro")).toContainText("já está vinculado a outro cliente do ERP");
    await expect(page.getByTestId("vinculo-vincular")).toBeVisible();
    expect(escritas).toEqual(["POST c1", "PATCH c1", "POST c3"]);
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-erro.png"), fullPage: true });

    // 7. LGPD: nada pessoal na URL nem no storage.
    expect(page.url()).not.toMatch(/9876|98123|Maria/i);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(storage).not.toMatch(/99876-5432|98123-4567/);
  });
});
