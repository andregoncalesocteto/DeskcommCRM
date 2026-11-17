/**
 * PDV PELA TELA: FICHA DO CLIENTE, ENDEREÇOS (US-017).
 *
 * Bloco "Endereços (N)" somente leitura abaixo dos dados pessoais, com `/api/v1/pdv/*` INTERCEPTADA
 * (nada fala com o ERP). Afirma: um card por endereço com selo "Principal", endereço, complemento,
 * bairro/cidade/UF, CEP e "Loja de entrega: <sigla>" ou "Loja de entrega ainda não definida";
 * cliente sem endereço; endereço muito longo sem estourar o layout; e nenhum botão de alterar,
 * remover, tornar principal ou adicionar. Medidas com `getBoundingClientRect`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "modulo-pdv");

function json(status: number, corpo: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(corpo) };
}

const LONGO =
  "Estrada Municipal do Rio Pequeno, km 7, Sítio Recanto das Palmeiras, portão azul ao lado do mercado e da igreja matriz, depois da ponte de madeira";

const FICHAS: Record<string, unknown> = {
  c1: {
    id: "c1",
    contact_id: "k1",
    nome: "Maria Oliveira",
    telefone: "(19) 99876-5432",
    email: null,
    cpf: null,
    data_nascimento: null,
    enderecos: [
      {
        id: "e1",
        cep: "13060000",
        uf: "SP",
        cidade: "Campinas",
        bairro: "Jardim Primavera",
        endereco: "Rua das Acácias, 120",
        complemento: "Apto 32, bloco B",
        principal: true,
        loja_entrega: { codigo: "3", sigla: "CAM" },
      },
      {
        id: "e2",
        cep: "13010-000",
        uf: "SP",
        cidade: "Campinas",
        bairro: "Centro",
        endereco: "Avenida Brasil, 1500",
        complemento: null,
        principal: false,
        loja_entrega: { codigo: "1", sigla: "CEN" },
      },
      {
        id: "e3",
        cep: "13825000",
        uf: "SP",
        cidade: "Holambra",
        bairro: "Zona Rural",
        endereco: LONGO,
        complemento: LONGO,
        principal: false,
        loja_entrega: null,
      },
    ],
  },
  c2: {
    id: "c2",
    contact_id: "k2",
    nome: "Maria Sem Endereco",
    telefone: null,
    email: null,
    cpf: null,
    data_nascimento: null,
    enderecos: [],
  },
};

async function interceptar(page: Page) {
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const url = new URL(rota.request().url());
    const m = /\/pdv\/clientes\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const f = FICHAS[decodeURIComponent(m[1]!)];
      return rota.fulfill(
        f ? json(200, { data: f }) : json(404, { error: { code: "not_found", message: "x" } }),
      );
    }
    if (url.pathname.endsWith("/clientes")) {
      const clientes = [
        { id: "c1", nome: "Maria Oliveira", endereco_principal: "Rua das Acácias, 120" },
        { id: "c2", nome: "Maria Sem Endereco", endereco_principal: null },
      ];
      return rota.fulfill(json(200, { data: { clientes, total_encontrado: 2, truncado: false } }));
    }
    return rota.fulfill(
      json(404, { error: { code: "not_found", message: "Recurso não encontrado." } }),
    );
  });
}

test.describe("PDV: ficha do cliente, endereços", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("a ficha lista os endereços com a loja de entrega, só para leitura", async ({ page }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) await instalar.click();
    await expect(
      page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    await interceptar(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/app/pdv/clientes");
    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "Nome" }).click();
    await page.getByTestId("busca-termo").fill("maria");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-lista")).toBeVisible();

    // 1. Três endereços: título com a contagem, abaixo dos dados pessoais.
    await page.getByTestId("cliente-c1").click();
    await expect(page.getByTestId("enderecos").locator("h2")).toHaveText("Endereços (3)");
    const ordem = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="ficha"]')!.getBoundingClientRect();
      const b = document.querySelector('[data-testid="enderecos"]')!.getBoundingClientRect();
      return { fichaBaixo: a.bottom, enderecosTopo: b.top };
    });
    expect(ordem.enderecosTopo, "Endereços fica abaixo de Dados pessoais").toBeGreaterThanOrEqual(
      ordem.fichaBaixo,
    );
    const cards = page.getByTestId("endereco");
    await expect(cards).toHaveCount(3);

    // 2. Primeiro card: selo, endereço, complemento, bairro/cidade/UF, CEP formatado, loja.
    const c0 = cards.nth(0);
    await expect(c0.getByTestId("endereco-principal")).toHaveText("Principal");
    await expect(c0.getByTestId("endereco-linha")).toHaveText("Rua das Acácias, 120");
    await expect(c0.getByTestId("endereco-complemento")).toHaveText("Apto 32, bloco B");
    await expect(c0.getByTestId("endereco-cidade")).toHaveText("Jardim Primavera, Campinas/SP");
    await expect(c0.getByTestId("endereco-cep")).toHaveText("CEP 13060-000");
    await expect(c0.getByTestId("endereco-loja")).toHaveText("Loja de entrega: CAM");

    // 3. Segundo: sem selo e sem complemento; terceiro: sem loja, texto longo.
    const c1 = cards.nth(1);
    await expect(c1.getByTestId("endereco-principal")).toHaveCount(0);
    await expect(c1.getByTestId("endereco-complemento")).toHaveCount(0);
    await expect(c1.getByTestId("endereco-loja")).toHaveText("Loja de entrega: CEN");
    const c2 = cards.nth(2);
    await expect(c2.getByTestId("endereco-sem-loja")).toHaveText(
      "Loja de entrega ainda não definida",
    );
    await expect(page.getByTestId("endereco-principal")).toHaveCount(1);

    // 4. Texto longo não estoura: sem rolagem horizontal e dentro do card.
    const estouro = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(estouro, "a página ganhou rolagem horizontal").toBeLessThanOrEqual(0);
    const caixa = await page.evaluate(() => {
      const card = document
        .querySelectorAll('[data-testid="endereco"]')[2]!
        .getBoundingClientRect();
      const linha = document
        .querySelectorAll('[data-testid="endereco-linha"]')[2]!
        .getBoundingClientRect();
      const compl = document
        .querySelectorAll('[data-testid="endereco"]')[2]!
        .querySelector('[data-testid="endereco-complemento"]')!;
      return {
        cardDir: card.right,
        linhaDir: linha.right,
        complDir: compl.getBoundingClientRect().right,
      };
    });
    expect(caixa.linhaDir, "o endereço vazou do card").toBeLessThanOrEqual(caixa.cardDir);
    expect(caixa.complDir, "o complemento vazou do card").toBeLessThanOrEqual(caixa.cardDir);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-017-enderecos.png"), fullPage: true });

    // 5. Somente leitura: nenhum botão no bloco, nenhuma ação de endereço em lugar nenhum.
    expect(await page.locator('[data-testid="enderecos"] button').count()).toBe(0);
    await expect(
      page.getByRole("button", {
        name: /alterar|remover|tornar principal|adicionar|editar|usar neste pedido/i,
      }),
    ).toHaveCount(0);

    // 6. Cliente sem endereço.
    await page.getByTestId("cliente-c2").click();
    await expect(page.getByTestId("enderecos").locator("h2")).toHaveText("Endereços (0)");
    await expect(page.getByTestId("enderecos-vazio")).toHaveText(
      "Este cliente ainda não tem endereço",
    );
    await expect(page.getByTestId("endereco")).toHaveCount(0);
    expect(await page.locator('[data-testid="enderecos"] button').count()).toBe(0);
    await page.screenshot({
      path: path.join(EVIDENCIA, "us-017-sem-endereco.png"),
      fullPage: true,
    });
  });
});
