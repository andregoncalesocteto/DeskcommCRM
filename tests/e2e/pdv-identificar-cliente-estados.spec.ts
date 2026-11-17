/**
 * PDV PELA TELA: IDENTIFICAR CLIENTE, ESTADOS E ERROS (US-012).
 *
 * O atendente precisa de uma frase clara quando a busca não encontra, falha ou está mal preenchida.
 * Tudo contra `GET /api/v1/pdv/clientes` INTERCEPTADA: nada fala com o ERP. Cobre o que a spec de
 * busca e lista (US-011) não prova: CPF com dígito verificador errado (não só o repetido), o ERP
 * fora do ar duas vezes seguidas com "Tentar de novo" repetindo a MESMA busca, "ERP não configurado"
 * sem endereço nem chave na tela, e o termo mantido no campo em cada desfecho. Alvos de 44 px
 * medidos com `getBoundingClientRect`.
 *
 * ADR-002: o ERP é o dono do cliente. Com o ERP fora do ar a tela mostra o erro e espera: não há
 * "cadastrar assim mesmo" (a spec afirma que o botão não existe).
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

type Pedido = { modo: string | null; q: string | null };

async function interceptar(page: Page, responder: (p: Pedido, n: number) => ReturnType<typeof json>, pedidos: Pedido[]) {
  await page.unroute("**/api/v1/pdv/**").catch(() => undefined);
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const url = new URL(rota.request().url());
    if (!url.pathname.endsWith("/clientes")) {
      return rota.fulfill(json(404, { error: { code: "not_found", message: "Recurso não encontrado." } }));
    }
    const p = { modo: url.searchParams.get("modo"), q: url.searchParams.get("q") };
    pedidos.push(p);
    return rota.fulfill(responder(p, pedidos.length));
  });
}

async function altura(page: Page, seletor: string) {
  return page.locator(seletor).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
}

async function escolherModo(page: Page, nome: "Telefone" | "Nome" | "CPF") {
  await page.getByTestId("busca-modo").click();
  await page.getByRole("option", { name: nome }).click();
}

test.describe("PDV: identificar cliente, estados e erros", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("mensagens claras para busca vazia, inválida, sem resultado, com erro e sem ERP", async ({ page }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) await instalar.click();
    await expect(page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true })).toBeVisible({ timeout: 30_000 });

    const pedidos: Pedido[] = [];
    await interceptar(page, () => json(200, { data: { clientes: [], total_encontrado: 0, truncado: false } }), pedidos);
    await page.goto(PAGINA);

    // 1. Antes da primeira busca.
    await expect(page.getByTestId("resultados-inicial")).toHaveText("Digite um telefone, nome ou CPF para buscar o cliente");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-012-antes-da-busca.png"), fullPage: true });

    // 2. Campo vazio, em cada modo: avisa e não consulta.
    for (const modo of ["Telefone", "Nome", "CPF"] as const) {
      await escolherModo(page, modo);
      await page.getByTestId("busca-buscar").click();
      await expect(page.getByTestId("busca-aviso"), `vazio em ${modo}`).toHaveText("Digite algo para buscar");
    }
    await page.screenshot({ path: path.join(EVIDENCIA, "us-012-campo-vazio.png"), fullPage: true });

    // 3. Telefone sem DDD / incompleto.
    await escolherModo(page, "Telefone");
    await page.getByTestId("busca-termo").fill("998765432");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("busca-aviso")).toHaveText("Informe o telefone com DDD");
    await expect(page.getByTestId("busca-termo"), "o termo deve ficar no campo").not.toHaveValue("");

    // 4. CPF: dígito verificador errado (12345678900 tem 11 dígitos distintos e falha no DV) e repetido.
    await escolherModo(page, "CPF");
    await page.getByTestId("busca-termo").fill("12345678900");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("busca-aviso")).toHaveText("CPF inválido");
    await page.getByTestId("busca-termo").fill("1234567");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("busca-aviso")).toHaveText("CPF inválido");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-012-cpf-invalido.png"), fullPage: true });
    // Digitar de novo limpa o aviso; CPF válido (52998224725) passa e consulta.
    await page.getByTestId("busca-termo").fill("52998224725");
    await expect(page.getByTestId("busca-aviso")).toHaveCount(0);
    expect(pedidos, "busca inválida não pode chamar a rota").toHaveLength(0);

    // 5. Nenhum resultado: a frase com o termo, e o termo continua no campo.
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-vazio")).toHaveText("Nenhum cliente encontrado para “529.982.247-25”.");
    await expect(page.getByTestId("busca-termo")).toHaveValue("529.982.247-25");
    expect(pedidos[0]).toEqual({ modo: "cpf", q: "52998224725" });
    await page.screenshot({ path: path.join(EVIDENCIA, "us-012-nenhum-resultado.png"), fullPage: true });

    // 6. ERP fora do ar: erro, sem cadastro provisório; "Tentar de novo" repete a MESMA busca,
    //    falha de novo e só então a lista aparece.
    await escolherModo(page, "Nome");
    pedidos.length = 0;
    await interceptar(
      page,
      (_p, n) =>
        n <= 2
          ? json(504, { error: { code: "erp_indisponivel", message: "O ERP não respondeu." } })
          : json(200, { data: { clientes: [{ id: "c1", nome: "Joana Prado", endereco_principal: null }], total_encontrado: 1, truncado: false } }),
      pedidos,
    );
    await page.getByTestId("busca-termo").fill("joana");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-erro")).toContainText("Não foi possível buscar o cliente agora.");
    await expect(page.getByTestId("busca-termo")).toHaveValue("joana");
    await expect(page.getByRole("button", { name: /cadastrar|criar|continuar/i }), "ADR-002: sem cadastro provisório").toHaveCount(0);
    for (const h of await altura(page, '[data-testid="resultados-erro"] button')) expect(h, "Tentar de novo abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-012-erro-erp-fora.png"), fullPage: true });
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByTestId("resultados-erro")).toBeVisible();
    await expect.poll(() => pedidos.length).toBe(2);
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByTestId("cliente-c1")).toContainText("Joana Prado");
    expect(pedidos).toEqual([
      { modo: "nome", q: "joana" },
      { modo: "nome", q: "joana" },
      { modo: "nome", q: "joana" },
    ]);

    // 7. ERP não configurado: orientação, sem "Tentar de novo" e sem endereço nem chave na tela.
    await interceptar(
      page,
      () => json(409, { error: { code: "erp_nao_configurado", message: "ERP sem servidor cadastrado (https://erp.interno.exemplo/api, chave abc123)." } }),
      pedidos,
    );
    await page.getByTestId("busca-termo").fill("maria");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-erro")).toContainText("O ERP ainda não está configurado. Avise o dono da instalação.");
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toHaveCount(0);
    const corpo = await page.locator("body").innerText();
    expect(corpo, "endereço ou chave do ERP vazou na tela").not.toMatch(/erp\.interno|abc123|https?:\/\//);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-012-erp-nao-configurado.png"), fullPage: true });

    // 8. Carregando numa nova tentativa: esqueleto e Buscar desabilitado.
    await interceptar(
      page,
      () => json(200, { data: { clientes: [], total_encontrado: 0, truncado: false } }),
      pedidos,
    );
    await page.route("**/api/v1/pdv/clientes**", async (rota) => {
      await new Promise((r) => setTimeout(r, 3_000));
      await rota.fulfill(json(200, { data: { clientes: [], total_encontrado: 0, truncado: false } }));
    });
    await page.getByTestId("busca-termo").fill("ana");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-carregando")).toBeVisible();
    await expect(page.getByTestId("busca-buscar")).toBeDisabled();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-012-carregando.png"), fullPage: true });
    await expect(page.getByTestId("resultados-vazio")).toBeVisible({ timeout: 15_000 });
  });
});
