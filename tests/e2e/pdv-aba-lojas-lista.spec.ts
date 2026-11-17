/**
 * PDV PELA TELA: A ABA LOJAS, LISTA E ESTADOS (US-007).
 *
 * Configurações › Lojas lista as lojas do tenant (sigla, nome, código do ERP, situação). Os
 * estados são provados contra as rotas `/api/v1/pdv/*` do próprio CRM INTERCEPTADAS: nenhuma
 * fala com o ERP, e a spec não depende dele estar de pé. O caminho feliz contra a homologação do
 * ERP é `pdv-aba-lojas-lista-homologacao.spec.ts`, fora do CI.
 *
 * O módulo `pdv` é de tabela e nasce desligado: a spec o instala pela tela de módulos, como o
 * dono da instalação faria (instalar não se desfaz, como em `pdv-instalar-modulo`). "Módulo
 * desligado = 404" é do layout da página e da rota (`app/api/v1/pdv/lojas/route.test.ts`): num
 * banco compartilhado não dá para desinstalar para provar.
 *
 * Os alvos de 44 px são medidos com `getBoundingClientRect`, não a olho.
 */
import * as fs from "node:fs";
import * as path from "node:path";


import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "modulo-pdv");
const PAGINA = "/app/settings/tenant/lojas";

const LOJAS: Array<{ id: string; erp_store_code: string; sigla: string; nome: string; ativa: boolean; channel_session_id: null }> = [
  { id: "00000000-0000-4000-8000-000000000001", erp_store_code: "001", sigla: "MTZ", nome: "Bella Capri Matriz", ativa: true, channel_session_id: null },
  { id: "00000000-0000-4000-8000-000000000002", erp_store_code: "014", sigla: "SHP", nome: "Bella Capri Shopping", ativa: false, channel_session_id: null },
];

function json(status: number, corpo: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(corpo) };
}

type Desfecho = {
  lojas: () => ReturnType<typeof json>;
  erp: () => ReturnType<typeof json>;
  atrasoMs?: number;
};

/** Um só interceptador para as duas rotas: `lojas` (do tenant) e `lojas/erp` (do ERP). */
async function interceptar(page: Page, desfecho: Desfecho) {
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const url = new URL(rota.request().url());
    if (desfecho.atrasoMs) await new Promise((r) => setTimeout(r, desfecho.atrasoMs));
    if (url.pathname.endsWith("/lojas/erp")) return rota.fulfill(desfecho.erp());
    if (url.pathname.endsWith("/lojas")) return rota.fulfill(desfecho.lojas());
    return rota.fulfill(json(404, { error: { code: "not_found", message: "Recurso não encontrado." } }));
  });
}

async function alturas(page: Page, seletor: string): Promise<number[]> {
  return page.locator(seletor).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
}

test.describe("PDV: aba Lojas, lista e estados", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("a lista, o vazio, o erro, o ERP sem configuração e o esqueleto, como o gerente os vê", async ({ page }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, lerCreds());

    // O módulo nasce desligado: o dono da instalação o instala (o que a US-002 já prova).
    await page.goto("/admin/modulos");
    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) await instalar.click();
    await expect(page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true })).toBeVisible({ timeout: 30_000 });

    // A porta: com o módulo ligado, "Lojas" aparece em Configurações.
    await page.goto("/app/settings");
    await expect(page.locator(`a[href="${PAGINA}"]`).first(), "a aba Lojas não ganhou porta em Configurações").toBeVisible();

    // 1. Carregando: a rota demora, e a tela mostra o esqueleto (não uma tela vazia).
    await interceptar(page, {
      atrasoMs: 4_000,
      lojas: () => json(200, { data: LOJAS }),
      erp: () => json(200, { data: [] }),
    });
    await page.goto(PAGINA);
    await expect(page.getByTestId("lojas-carregando")).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-007-carregando.png"), fullPage: true });

    // 2. Lista: sigla, nome, código do ERP e situação.
    await expect(page.getByTestId("lojas-lista")).toBeVisible({ timeout: 15_000 });
    const matriz = page.getByTestId(`loja-${LOJAS[0]!.id}`);
    await expect(matriz).toContainText("MTZ");
    await expect(matriz).toContainText("Bella Capri Matriz");
    await expect(matriz).toContainText("001");
    await expect(matriz.getByText("Ativa", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`loja-${LOJAS[1]!.id}`).getByText("Inativa", { exact: true })).toBeVisible();
    for (const h of await alturas(page, '[data-testid^="loja-0"]')) expect(h, "linha de loja abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-007-lista.png"), fullPage: true });

    // 3. Vazio: o tenant sem lojas, com o ERP configurado.
    await page.unroute("**/api/v1/pdv/**");
    await interceptar(page, { lojas: () => json(200, { data: [] }), erp: () => json(200, { data: [] }) });
    await page.goto(PAGINA);
    await expect(page.getByText("Este tenant ainda não tem lojas")).toBeVisible();
    await expect(page.getByTestId("lojas-erp-nao-configurado")).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-007-vazio.png"), fullPage: true });

    // 4. ERP não configurado: a orientação é para o dono da instalação.
    await page.unroute("**/api/v1/pdv/**");
    await interceptar(page, {
      lojas: () => json(200, { data: [] }),
      erp: () => json(409, { error: { code: "erp_nao_configurado", message: "O ERP não está configurado." } }),
    });
    await page.goto(PAGINA);
    const semErp = page.getByTestId("lojas-erp-nao-configurado");
    await expect(semErp).toBeVisible();
    await expect(semErp).toContainText("dono da instalação");
    await expect(page.getByText("Este tenant ainda não tem lojas")).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-007-erp-nao-configurado.png"), fullPage: true });

    // 5. Erro: a lista falha; "Tentar de novo" busca outra vez e a lista aparece.
    let falhar = true;
    await page.unroute("**/api/v1/pdv/**");
    await interceptar(page, {
      lojas: () =>
        falhar
          ? json(500, { error: { code: "internal_error", message: "Não foi possível ler as lojas." } })
          : json(200, { data: LOJAS }),
      erp: () => json(200, { data: [] }),
    });
    await page.goto(PAGINA);
    await expect(page.getByTestId("lojas-erro")).toBeVisible();
    const tentar = page.getByRole("button", { name: "Tentar de novo" });
    await expect(tentar).toBeVisible();
    expect((await tentar.boundingBox())!.height, "botão Tentar de novo abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-007-erro.png"), fullPage: true });
    falhar = false;
    await tentar.click();
    await expect(page.getByTestId("lojas-lista")).toBeVisible();
    await expect(page.getByTestId("lojas-erro")).toHaveCount(0);
  });
});
