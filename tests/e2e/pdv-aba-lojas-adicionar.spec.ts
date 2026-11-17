/**
 * PDV PELA TELA: ABA LOJAS, ADICIONAR LOJAS DO ERP (US-008).
 *
 * O gerente abre o modal "Adicionar lojas do ERP", escolhe e confirma. Os estados são provados
 * contra as rotas `/api/v1/pdv/*` do próprio CRM INTERCEPTADAS (nenhuma fala com o ERP). O
 * caminho feliz contra a homologação é `pdv-aba-lojas-adicionar-homologacao.spec.ts`, fora do CI.
 *
 * O módulo `pdv` é instalado pela tela de módulos, como o dono da instalação faria. Alvos de
 * 44 px medidos com `getBoundingClientRect`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "modulo-pdv");
const PAGINA = "/app/settings/tenant/lojas";

type LojaTenant = { id: string; erp_store_code: string; sigla: string; nome: string; ativa: boolean; channel_session_id: null };
type LojaErp = { codigo: string; sigla: string; nome: string; endereco: string; ativa: boolean; ja_cadastrada: boolean };

const MTZ: LojaTenant = { id: "00000000-0000-4000-8000-000000000001", erp_store_code: "001", sigla: "MTZ", nome: "Bella Capri Matriz", ativa: true, channel_session_id: null };
const SHP: LojaTenant = { id: "00000000-0000-4000-8000-000000000002", erp_store_code: "014", sigla: "SHP", nome: "Bella Capri Shopping", ativa: true, channel_session_id: null };

const ERP = (shoppingJaAdicionada: boolean): LojaErp[] => [
  { codigo: "001", sigla: "MTZ", nome: "Bella Capri Matriz", endereco: "Rua A, 1", ativa: true, ja_cadastrada: true },
  { codigo: "014", sigla: "SHP", nome: "Bella Capri Shopping", endereco: "Av. B, 2", ativa: true, ja_cadastrada: shoppingJaAdicionada },
  { codigo: "022", sigla: "OUT", nome: "Bella Capri Outlet", endereco: "Rod. C, 3", ativa: true, ja_cadastrada: false },
];

function json(status: number, corpo: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(corpo) };
}

type Rotas = {
  lojas: () => ReturnType<typeof json>;
  erp: () => ReturnType<typeof json>;
  post: () => ReturnType<typeof json>;
  atrasoErpMs?: number;
  posts?: unknown[];
};

async function interceptar(page: Page, r: Rotas) {
  await page.unroute("**/api/v1/pdv/**").catch(() => undefined);
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith("/lojas/erp")) {
      if (r.atrasoErpMs) await new Promise((res) => setTimeout(res, r.atrasoErpMs));
      return rota.fulfill(r.erp());
    }
    if (url.pathname.endsWith("/lojas")) {
      if (req.method() === "POST") {
        r.posts?.push(req.postDataJSON());
        return rota.fulfill(r.post());
      }
      return rota.fulfill(r.lojas());
    }
    return rota.fulfill(json(404, { error: { code: "not_found", message: "Recurso não encontrado." } }));
  });
}

async function abrirModal(page: Page) {
  await page.goto(PAGINA);
  await page.getByTestId("adicionar-lojas").click();
  await expect(page.getByTestId("adicionar-lojas-modal")).toBeVisible();
}

test.describe("PDV: aba Lojas, adicionar lojas do ERP", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("carregando, escolha, sucesso, erro do ERP, nenhuma nova e falha ao salvar", async ({ page }) => {
    test.setTimeout(240_000);
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) await instalar.click();
    await expect(page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true })).toBeVisible({ timeout: 30_000 });

    // 1. Carregando: o ERP demora e o modal mostra o esqueleto.
    let adicionou = false;
    const posts: unknown[] = [];
    await interceptar(page, {
      atrasoErpMs: 3_000,
      lojas: () => json(200, { data: adicionou ? [MTZ, SHP] : [MTZ] }),
      erp: () => json(200, { data: ERP(adicionou) }),
      post: () => {
        adicionou = true;
        return json(201, { data: { criadas: [SHP], ja_existiam: [] } });
      },
      posts,
    });
    await abrirModal(page);
    await expect(page.getByTestId("adicionar-carregando")).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-008-carregando.png"), fullPage: true });

    // 2. Lista: as já adicionadas aparecem marcadas e desabilitadas; confirmar exige escolha.
    await expect(page.getByTestId("adicionar-lista")).toBeVisible({ timeout: 15_000 });
    const matriz = page.getByTestId("erp-loja-001").getByRole("checkbox");
    await expect(matriz).toBeDisabled();
    await expect(matriz).toBeChecked();
    await expect(page.getByTestId("erp-loja-001")).toContainText("Já adicionada");
    const confirmar = page.getByTestId("adicionar-lojas-modal").getByRole("button", { name: "Adicionar", exact: true });
    await expect(confirmar).toBeDisabled();
    for (const h of await page.locator('[data-testid^="erp-loja-"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(h, "linha do modal abaixo de 44 px").toBeGreaterThanOrEqual(44);
    }
    expect((await confirmar.boundingBox())!.height, "botão Adicionar abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.getByTestId("erp-loja-014").getByRole("checkbox").check();
    await expect(confirmar).toBeEnabled();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-008-escolha.png"), fullPage: true });

    // 3. Sucesso: fecha, a lista atualiza sem recarregar e o aviso aparece.
    await confirmar.click();
    await expect(page.getByTestId("adicionar-lojas-modal")).toHaveCount(0);
    await expect(page.getByText("Lojas adicionadas", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`loja-${SHP.id}`)).toContainText("SHP");
    expect(posts).toEqual([{ lojas: [{ codigo: "014", sigla: "SHP" }] }]);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-008-sucesso.png"), fullPage: true });

    // 4. Erro do ERP: "Tentar de novo" busca outra vez.
    let erpFora = true;
    await interceptar(page, {
      lojas: () => json(200, { data: [MTZ] }),
      erp: () =>
        erpFora
          ? json(502, { error: { code: "erp_indisponivel", message: "O ERP não respondeu." } })
          : json(200, { data: ERP(false) }),
      post: () => json(201, { data: {} }),
    });
    await abrirModal(page);
    await expect(page.getByTestId("adicionar-erro-erp")).toBeVisible();
    const tentar = page.getByRole("button", { name: "Tentar de novo" });
    expect((await tentar.boundingBox())!.height, "Tentar de novo abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-008-erro-do-erp.png"), fullPage: true });
    erpFora = false;
    await tentar.click();
    await expect(page.getByTestId("adicionar-lista")).toBeVisible();
    await expect(page.getByTestId("adicionar-erro-erp")).toHaveCount(0);

    // 5. Nenhuma loja nova: o ERP só tem lojas já adicionadas.
    await interceptar(page, {
      lojas: () => json(200, { data: [MTZ, SHP] }),
      erp: () => json(200, { data: ERP(true).filter((l) => l.codigo !== "022") }),
      post: () => json(201, { data: {} }),
    });
    await abrirModal(page);
    await expect(page.getByTestId("adicionar-sem-novas")).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-008-sem-novas.png"), fullPage: true });

    // 6. Falha ao salvar: mensagem, modal aberto e seleção mantida.
    await interceptar(page, {
      lojas: () => json(200, { data: [MTZ] }),
      erp: () => json(200, { data: ERP(false) }),
      post: () => json(500, { error: { code: "internal_error", message: "Falha." } }),
    });
    await abrirModal(page);
    await expect(page.getByTestId("adicionar-lista")).toBeVisible();
    await page.getByTestId("erp-loja-022").getByRole("checkbox").check();
    await page.getByTestId("adicionar-lojas-modal").getByRole("button", { name: "Adicionar", exact: true }).click();
    await expect(page.getByTestId("adicionar-erro-salvar")).toHaveText("Não foi possível salvar. Tente de novo.");
    await expect(page.getByTestId("adicionar-lojas-modal")).toBeVisible();
    await expect(page.getByTestId("erp-loja-022").getByRole("checkbox")).toBeChecked();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-008-falha-ao-salvar.png"), fullPage: true });
  });
});
