/**
 * PDV PELA TELA: ABA LOJAS, ATIVAR, DESATIVAR E VINCULAR CONEXÃO (US-009).
 *
 * O gerente muda o interruptor de ativa e o seletor de conexão de uma loja e confirma com
 * "Salvar". Os estados são provados contra as rotas `/api/v1/pdv/*` do próprio CRM
 * INTERCEPTADAS; a lista de conexões (`/api/v1/channel-sessions`) também é simulada, para não
 * depender de um WhatsApp pareado. O caminho feliz contra a homologação do ERP é
 * `pdv-aba-lojas-editar-homologacao.spec.ts`, fora do CI. Alvos de 44 px medidos com
 * `getBoundingClientRect`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test, type Page } from "./helpers/test";
import { lerCreds, loginComoDono } from "./helpers/login-admin";
import { afirmarDonoDoServidor } from "./utils/precondicao";

const EVIDENCIA = path.join(process.cwd(), "evidence", "modulo-pdv");
const PAGINA = "/app/settings/tenant/lojas";

type LojaTenant = { id: string; erp_store_code: string; sigla: string; nome: string; ativa: boolean; channel_session_id: string | null };

const CONEXAO_A = "00000000-0000-4000-8000-0000000000a1";
const CONEXAO_B = "00000000-0000-4000-8000-0000000000a2";
const CONEXOES = [
  { id: CONEXAO_A, display_name: "WhatsApp Matriz", phone_number: "5511999990001", waha_session_name: "matriz" },
  { id: CONEXAO_B, display_name: "WhatsApp Shopping", phone_number: "5511999990002", waha_session_name: "shopping" },
];

const MTZ_ID = "00000000-0000-4000-8000-000000000001";
const SHP_ID = "00000000-0000-4000-8000-000000000002";

function json(status: number, corpo: unknown) {
  return { status, contentType: "application/json", body: JSON.stringify(corpo) };
}

type Estado = { lojas: LojaTenant[]; patch: (corpo: Record<string, unknown>, id: string) => ReturnType<typeof json>; patches: unknown[] };

async function interceptar(page: Page, e: Estado) {
  await page.unroute("**/api/v1/pdv/**").catch(() => undefined);
  await page.unroute("**/api/v1/channel-sessions").catch(() => undefined);
  await page.route("**/api/v1/channel-sessions", (rota) => rota.fulfill(json(200, { data: CONEXOES })));
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const req = rota.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/\/lojas\/([^/]+)$/);
    if (m && req.method() === "PATCH") {
      const corpo = req.postDataJSON() as Record<string, unknown>;
      e.patches.push({ id: m[1], ...corpo });
      return rota.fulfill(e.patch(corpo, m[1]!));
    }
    if (url.pathname.endsWith("/lojas")) return rota.fulfill(json(200, { data: e.lojas }));
    return rota.fulfill(json(404, { error: { code: "not_found", message: "Recurso não encontrado." } }));
  });
}

test.describe("PDV: aba Lojas, ativar, desativar e vincular conexão", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("lista, desativar, vincular, sem conexão e falha ao salvar", async ({ page }) => {
    test.setTimeout(240_000);
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) await instalar.click();
    await expect(page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true })).toBeVisible({ timeout: 30_000 });

    const lojas: LojaTenant[] = [
      { id: MTZ_ID, erp_store_code: "001", sigla: "MTZ", nome: "Bella Capri Matriz", ativa: true, channel_session_id: CONEXAO_A },
      { id: SHP_ID, erp_store_code: "014", sigla: "SHP", nome: "Bella Capri Shopping", ativa: true, channel_session_id: null },
    ];
    const patches: unknown[] = [];
    let falhar = false;
    await interceptar(page, {
      lojas,
      patches,
      patch: (corpo, id) => {
        if (falhar) return json(500, { error: { code: "internal_error", message: "Falha." } });
        const alvo = lojas.find((l) => l.id === id)!;
        Object.assign(alvo, corpo);
        return json(200, { data: alvo });
      },
    });

    // 1. Lista com os controles; sem mudança não há "Salvar".
    await page.goto(PAGINA);
    await expect(page.getByTestId("lojas-lista")).toBeVisible();
    await expect(page.getByTestId(`loja-${MTZ_ID}-conexao`)).toContainText("WhatsApp Matriz");
    await expect(page.getByTestId(`loja-${SHP_ID}-conexao`)).toContainText("Sem conexão");
    await expect(page.getByTestId(`loja-${MTZ_ID}-salvar`)).toHaveCount(0);
    for (const id of [MTZ_ID, SHP_ID]) {
      expect((await page.getByTestId(`loja-${id}-conexao`).boundingBox())!.height, "seletor abaixo de 44 px").toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: path.join(EVIDENCIA, "us-009-lista.png"), fullPage: true });

    // 2. Vincular conexão: o seletor oferece as conexões e "Sem conexão"; salvar atualiza sem recarregar.
    await page.getByTestId(`loja-${SHP_ID}-conexao`).click();
    await expect(page.getByRole("option", { name: "Sem conexão" })).toBeVisible();
    await expect(page.getByRole("option", { name: "WhatsApp Matriz" })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-009-opcoes-de-conexao.png"), fullPage: true });
    await page.getByRole("option", { name: "WhatsApp Shopping" }).click();
    const salvarShp = page.getByTestId(`loja-${SHP_ID}-salvar`);
    await expect(salvarShp).toBeVisible();
    expect((await salvarShp.boundingBox())!.height, "Salvar abaixo de 44 px").toBeGreaterThanOrEqual(44);
    expect(patches, "nada é salvo antes de confirmar").toEqual([]);
    await salvarShp.click();
    await expect(page.getByText("Loja atualizada", { exact: true })).toBeVisible();
    await expect(salvarShp).toHaveCount(0);
    await expect(page.getByTestId(`loja-${SHP_ID}-conexao`)).toContainText("WhatsApp Shopping");
    expect(patches).toEqual([{ id: SHP_ID, ativa: true, channel_session_id: CONEXAO_B }]);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-009-conexao-vinculada.png"), fullPage: true });

    // 3. Desativar: a loja fica esmaecida e identificada como inativa, sem recarregar.
    await page.getByTestId(`loja-${SHP_ID}-ativa`).click();
    await page.getByTestId(`loja-${SHP_ID}-salvar`).click();
    await expect(page.getByTestId(`loja-${SHP_ID}`)).toHaveAttribute("data-ativa", "false");
    await expect(page.getByTestId(`loja-${SHP_ID}`).getByText("Inativa", { exact: true })).toBeVisible();
    await expect.poll(async () => Number(await page.getByTestId(`loja-${SHP_ID}-dados`).evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);
    await expect(page.getByTestId(`loja-${MTZ_ID}-dados`)).toHaveCSS("opacity", "1");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-009-inativa.png"), fullPage: true });

    // 4. Sem conexão: desvincula (null no corpo).
    await page.getByTestId(`loja-${MTZ_ID}-conexao`).click();
    await page.getByRole("option", { name: "Sem conexão" }).click();
    await page.getByTestId(`loja-${MTZ_ID}-salvar`).click();
    await expect(page.getByTestId(`loja-${MTZ_ID}-conexao`)).toContainText("Sem conexão");
    expect(patches.at(-1)).toEqual({ id: MTZ_ID, ativa: true, channel_session_id: null });

    // 5. Falha ao salvar: a alteração fica na tela, com a mensagem, e "Salvar" continua disponível.
    falhar = true;
    await page.getByTestId(`loja-${SHP_ID}-ativa`).click();
    await page.getByTestId(`loja-${SHP_ID}-salvar`).click();
    await expect(page.getByTestId(`loja-${SHP_ID}-erro`)).toHaveText("Não foi possível salvar. Tente de novo.");
    await expect(page.getByTestId(`loja-${SHP_ID}-ativa`)).toBeChecked();
    await expect(page.getByTestId(`loja-${SHP_ID}-salvar`)).toBeVisible();
    await expect(page.getByTestId(`loja-${SHP_ID}`)).toHaveAttribute("data-ativa", "false");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-009-falha-ao-salvar.png"), fullPage: true });
  });
});
