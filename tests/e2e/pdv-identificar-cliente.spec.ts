/**
 * PDV PELA TELA: IDENTIFICAR CLIENTE, BUSCA E LISTA DE CANDIDATOS (US-011).
 *
 * O atendente busca por telefone, nome ou CPF e vê os candidatos. Os estados são provados contra
 * `GET /api/v1/pdv/clientes` INTERCEPTADA: nada fala com o ERP, e a spec não depende dele estar de
 * pé. O caminho feliz contra a homologação do ERP é `pdv-identificar-cliente-homologacao.spec.ts`,
 * fora do CI. Alvos de 44 px e o corte com reticências medidos com `getBoundingClientRect`.
 *
 * O módulo `pdv` nasce desligado: a spec o instala pela tela de módulos, como o dono faria.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "modulo-pdv");
const PAGINA = "/app/pdv/clientes";

const LONGO =
  "Estrada Municipal do Rio Pequeno, km 7, Sítio Recanto das Palmeiras, portão azul ao lado do mercado, Zona Rural, Holambra/SP, CEP 13825-000";
const CLIENTES = [
  { id: "c1", nome: "Maria Oliveira", endereco_principal: "Rua das Acácias, 120, Jardim Primavera, Campinas/SP" },
  {
    id: "c2",
    nome: "Maria de Fátima Albuquerque Nascimento Souza dos Santos Pereira de Alcântara Menezes Figueiredo",
    endereco_principal: LONGO,
  },
  { id: "c3", nome: "Mariana Lopes", endereco_principal: null },
];

function json(status: number, corpo: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(corpo) };
}

type Pedido = { modo: string | null; q: string | null };
type Desfecho = { responder: (p: Pedido) => ReturnType<typeof json>; atrasoMs?: number };

async function interceptar(page: Page, d: Desfecho, pedidos: Pedido[]) {
  await page.unroute("**/api/v1/pdv/**").catch(() => undefined);
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const url = new URL(rota.request().url());
    if (!url.pathname.endsWith("/clientes")) {
      return rota.fulfill(json(404, { error: { code: "not_found", message: "Recurso não encontrado." } }));
    }
    const p = { modo: url.searchParams.get("modo"), q: url.searchParams.get("q") };
    pedidos.push(p);
    if (d.atrasoMs) await new Promise((r) => setTimeout(r, d.atrasoMs));
    return rota.fulfill(d.responder(p));
  });
}

function lista(clientes: typeof CLIENTES, extra: { total?: number; truncado?: boolean } = {}) {
  return json(200, { data: { clientes, total_encontrado: extra.total ?? clientes.length, truncado: extra.truncado ?? false } });
}

async function medir(page: Page, seletor: string) {
  return page.locator(seletor).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { h: r.height, w: r.width, corta: e.scrollWidth > e.clientWidth, estouro: e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow !== "ellipsis" };
    }),
  );
}

test.describe("PDV: identificar cliente, busca e lista", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("os estados da busca, como o atendente os vê", async ({ page }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) await instalar.click();
    await expect(page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true })).toBeVisible({ timeout: 30_000 });

    // A porta: com o módulo ligado, "Identificar cliente" aparece na visão geral do CRM.
    await page.goto("/app/crm");
    await expect(page.locator(`a[href="${PAGINA}"]`).first(), "a tela não ganhou porta").toBeVisible();

    const pedidos: Pedido[] = [];
    await interceptar(page, { responder: () => lista(CLIENTES) }, pedidos);

    // 1. Antes da primeira busca: orientação, seletor em Telefone, nada consultado.
    await page.goto(PAGINA);
    await expect(page.getByTestId("resultados-inicial")).toContainText("Digite um telefone, nome ou CPF para buscar o cliente");
    await expect(page.getByTestId("busca-modo")).toContainText("Telefone");
    await expect(page.getByTestId("busca-termo")).toHaveAttribute("placeholder", "Digite o telefone");
    for (const sel of ['[data-testid="busca-modo"]', '[data-testid="busca-termo"]', '[data-testid="busca-buscar"]']) {
      for (const m of await medir(page, sel)) expect(m.h, `${sel} abaixo de 44 px`).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: path.join(EVIDENCIA, "us-011-inicial.png"), fullPage: true });

    // 2. Campo vazio e formatos inválidos: avisa e não consulta.
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("busca-aviso")).toHaveText("Digite algo para buscar");
    await page.getByTestId("busca-termo").fill("1999887");
    await page.getByTestId("busca-termo").press("Enter");
    await expect(page.getByTestId("busca-aviso")).toHaveText("Informe o telefone com DDD");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-011-telefone-incompleto.png"), fullPage: true });
    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "CPF" }).click();
    await page.getByTestId("busca-termo").fill("11111111111");
    await expect(page.getByTestId("busca-termo")).toHaveValue("111.111.111-11");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("busca-aviso")).toHaveText("CPF inválido");
    expect(pedidos, "busca inválida não pode chamar a rota").toHaveLength(0);

    // 3. Máscara do telefone e Enter buscando; a lista com corte por reticências.
    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "Telefone" }).click();
    await page.getByTestId("busca-termo").fill("19998765432");
    await expect(page.getByTestId("busca-termo")).toHaveValue("(19) 99876-5432");
    await page.getByTestId("busca-termo").press("Enter");
    await expect(page.getByTestId("resultados-lista")).toBeVisible();
    expect(pedidos[0]).toEqual({ modo: "telefone", q: "19998765432" });
    await expect(page.getByTestId("resultados-contagem")).toContainText("3 clientes encontrados");
    await expect(page.getByTestId("cliente-c1")).toContainText("Maria Oliveira");
    await expect(page.getByTestId("cliente-c3")).toContainText("Sem endereço cadastrado");
    for (const m of await medir(page, '[data-testid^="cliente-c"]')) expect(m.h, "item da lista abaixo de 44 px").toBeGreaterThanOrEqual(44);
    const largura = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(largura, "texto longo estourou a largura da página").toBe(true);
    for (const m of await medir(page, '[data-testid="cliente-c2"] span')) expect(m.estouro, "texto longo sem reticências").toBe(false);
    const longas = await medir(page, '[data-testid="cliente-c2"] span');
    expect(longas.every((m) => m.corta), "o texto longo devia estar cortado").toBe(true);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-011-lista.png"), fullPage: true });

    // 4. O termo digitado não vai para a URL do navegador nem para o localStorage.
    expect(page.url()).not.toMatch(/19998765432|99876/);
    const guardado = await page.evaluate(() => JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage }));
    expect(guardado).not.toMatch(/19998765432|99876-5432/);

    // 5. Carregando: a rota demora, o esqueleto aparece e o botão fica desabilitado.
    await interceptar(page, { atrasoMs: 4_000, responder: () => lista(CLIENTES) }, pedidos);
    await page.getByTestId("busca-termo").fill("19991112222");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-carregando")).toBeVisible();
    await expect(page.getByTestId("busca-buscar")).toBeDisabled();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-011-carregando.png"), fullPage: true });
    await expect(page.getByTestId("resultados-lista")).toBeVisible({ timeout: 15_000 });

    // 6. Nenhum cliente: o termo continua no campo.
    await interceptar(page, { responder: () => lista([]) }, pedidos);
    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "Nome" }).click();
    await page.getByTestId("busca-termo").fill("xyz");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-vazio")).toContainText("Nenhum cliente encontrado para");
    await expect(page.getByTestId("busca-termo")).toHaveValue("xyz");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-011-nenhum.png"), fullPage: true });

    // 7. Lista truncada pelo ERP.
    await interceptar(page, { responder: () => lista(CLIENTES.slice(0, 2), { total: 120, truncado: true }) }, pedidos);
    await page.getByTestId("busca-termo").fill("maria");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-contagem")).toContainText("refine a busca");

    // 8. Erro: "Tentar de novo" repete a última busca e a lista aparece.
    let falhar = true;
    await interceptar(
      page,
      {
        responder: () =>
          falhar ? json(502, { error: { code: "erp_indisponivel", message: "O ERP não respondeu." } }) : lista(CLIENTES),
      },
      pedidos,
    );
    await page.getByTestId("busca-termo").fill("joana");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("resultados-erro")).toContainText("Não foi possível buscar o cliente agora.");
    const tentar = page.getByRole("button", { name: "Tentar de novo" });
    expect((await tentar.boundingBox())!.height, "Tentar de novo abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-011-erro.png"), fullPage: true });
    falhar = false;
    const antes = pedidos.length;
    await tentar.click();
    await expect(page.getByTestId("resultados-lista")).toBeVisible();
    expect(pedidos[pedidos.length - 1]).toEqual({ modo: "nome", q: "joana" });
    expect(pedidos.length).toBeGreaterThan(antes);
  });
});
