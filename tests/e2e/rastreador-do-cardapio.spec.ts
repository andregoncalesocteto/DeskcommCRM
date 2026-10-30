/**
 * O RASTREADOR NO SITE DO CARDÁPIO, DE PONTA A PONTA (etapa 2 do épico "Eventos do funil", US-029).
 *
 * Um gerente cria a chave pelo CRM e copia o código de instalação da própria tela. Esse código é colado numa página
 * servida por um servidor HTTP de verdade, em OUTRA origem (outra porta), e um navegador real a abre com `?idtrack=`.
 * Os eventos viajam pelo script, pela rede e pela porta pública até o banco: nada é dublado.
 *
 * O PAR (prova-em-par): o que o script mandou (observado na rede, pelo navegador) e o que o CRM guardou (lido no banco)
 * são conferidos juntos. Nenhum agente de IA no meio.
 *
 * Casos negativos, todos contra o servidor real: origem não listada, chave revogada, idtrack que é telefone, compra sem
 * carrinho antes e a recarga da página de sucesso (a compra não duplica).
 *
 * O funil é PRÓPRIO da spec, semeado e apagado por ela.
 *
 * Pré-requisitos (banco local do baseline, app buildada):
 *   pnpm e2e:env && pnpm e2e:build
 *   pnpm exec playwright test tests/e2e/rastreador-do-cardapio.spec.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { createServer, type Server } from "node:http";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { expect, test, type Page, type Request } from "./helpers/test";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const EVIDENCIA = process.env.E2E_EVIDENCIA_RASTREADOR ?? path.join(process.cwd(), "evidence/eventos-do-funil");

interface Creds {
  password: string;
  org_id: string;
  users: Record<string, { id: string; email: string; role: string }>;
}

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SUFIXO = `${Date.now()}`.slice(-7);
const NOME_DO_FUNIL = `Rastreador E2E ${SUFIXO}`;

let creds: Creds;
let pipelineId = "";
let etapas: Record<string, string> = {};
let chaveId = "";
let trecho = "";
const contatos: Record<"fluxo" | "semCarrinho" | "outraOrigem" | "revogada", string> = {
  fluxo: "", semCarrinho: "", outraOrigem: "", revogada: "",
};
const pedidos: Record<keyof typeof contatos, string> = { fluxo: "", semCarrinho: "", outraOrigem: "", revogada: "" };
const servidores: Server[] = [];

/** A página do cardápio que o servidor entrega. Preenchida depois de a chave existir: o código vem da tela. */
let paginaDoCardapio = "<!doctype html><title>aguardando</title>";

/** Sobe um servidor HTTP real que serve a página do cardápio; devolve a porta. */
async function servirPagina(): Promise<number> {
  const servidor = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(paginaDoCardapio);
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  servidores.push(servidor);
  return (servidor.address() as { port: number }).port;
}

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
}

async function captura(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `e2e-rastreador-${nome}.png`), fullPage: true });
}

async function limparFixtures(): Promise<void> {
  const { data } = await admin
    .from("crm_pipelines").select("id").eq("organization_id", creds.org_id).like("name", "Rastreador E2E %");
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length > 0) {
    await admin.from("crm_tracker_public_keys").delete().in("pipeline_id", ids);
    await admin.from("crm_pipeline_events").delete().in("pipeline_id", ids);
    await admin.from("crm_lead_activities").delete().in("pipeline_id", ids);
    await admin.from("crm_leads").delete().in("pipeline_id", ids);
    await admin.from("crm_stages").delete().in("pipeline_id", ids);
    await admin.from("crm_pipelines").delete().in("id", ids);
  }
  await admin.from("contacts").delete().eq("organization_id", creds.org_id).like("display_name", "Rastreador E2E %");
}

/** O que o CRM guardou para o pedido: etapa, valor, estado e as linhas de evento externo. */
async function estadoDoPedido(leadId: string) {
  const { data: lead } = await admin
    .from("crm_leads").select("stage_id, status, value_cents, custom_fields").eq("id", leadId).single();
  const { data: historico } = await admin
    .from("crm_lead_activities")
    .select("payload")
    .eq("lead_id", leadId)
    .eq("type", "external_event");
  const linhas = (historico ?? []) as Array<{ payload: { event: string; origem?: string; chave_id?: string; data?: Record<string, unknown> } }>;
  const nomeDaEtapa = Object.entries(etapas).find(([, id]) => id === lead!.stage_id)?.[0];
  return { etapa: nomeDaEtapa, status: lead!.status as string, valor: lead!.value_cents as number | null, campos: lead!.custom_fields as Record<string, unknown>, linhas };
}

/** Observa as requisições do script à porta pública (a metade da rede do par). */
function espiarColeta(page: Page): Request[] {
  const vistas: Request[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/coleta/")) vistas.push(r);
  });
  return vistas;
}

test.describe("Rastreador no site do cardápio — da chave pela tela ao pedido em Compras", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test.beforeAll(async () => {
    if (!fs.existsSync(CREDS_PATH)) {
      execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
    }
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    await limparFixtures();

    const { data: funil, error: erroFunil } = await admin
      .from("crm_pipelines")
      .insert({ organization_id: creds.org_id, name: NOME_DO_FUNIL, slug: `rastreador-e2e-${SUFIXO}` })
      .select("id").single();
    if (erroFunil) throw new Error(`Funil da prova: ${erroFunil.message}`);
    pipelineId = funil!.id as string;

    const nomes = [
      ["Entrada", false], ["Visitas", false], ["Visualizações", false], ["Carrinho", false], ["Revisão", false], ["Compras", true],
    ] as const;
    const { data: criadas, error: erroEtapas } = await admin
      .from("crm_stages")
      .insert(nomes.map(([name, ganho], i) => ({
        organization_id: creds.org_id, pipeline_id: pipelineId, name, slug: name.toLowerCase().replace(/[^a-z]/g, ""),
        position: (i + 1) * 1000, is_won: ganho, is_lost: false,
      })))
      .select("id, name");
    if (erroEtapas) throw new Error(`Etapas da prova: ${erroEtapas.message}`);
    etapas = Object.fromEntries((criadas ?? []).map((e) => [e.name as string, e.id as string]));

    // O cadastro do cardápio, à mão, como o gerente faria (a tela de cadastro tem a sua própria spec).
    // Inserção em lote: coluna ausente numa linha vira null, e esta é NOT NULL.
    const base = { organization_id: creds.org_id, pipeline_id: pipelineId, respects_manual_move: true, is_active: true };
    const { error: erroEventos } = await admin.from("crm_pipeline_events").insert([
      { ...base, key: "page_view", label: "Visita", stage_id: etapas["Visitas"] },
      { ...base, key: "view_item", label: "Item visto", stage_id: etapas["Visualizações"] },
      { ...base, key: "cart_sync", label: "Carrinho", stage_id: etapas["Carrinho"], state_key: "cart" },
      { ...base, key: "begin_checkout", label: "Pagamento", stage_id: etapas["Revisão"], state_key: "checkout", value_path: "value", value_unit: "reais" },
      {
        ...base, key: "purchase", label: "Compra", stage_id: etapas["Compras"], state_key: "pedido", value_path: "value",
        value_unit: "reais", dedupe_path: "order_id", respects_manual_move: false,
      },
    ]);
    if (erroEventos) throw new Error(`Eventos da prova: ${erroEventos.message}`);

    for (const quem of Object.keys(contatos) as Array<keyof typeof contatos>) {
      const { data: contato, error } = await admin
        .from("contacts")
        .insert({ organization_id: creds.org_id, display_name: `Rastreador E2E ${SUFIXO} ${quem}` })
        .select("id").single();
      if (error) throw new Error(`Contato ${quem}: ${error.message}`);
      contatos[quem] = contato!.id as string;
      const { data: pedido, error: erroPedido } = await admin
        .from("crm_leads")
        .insert({
          organization_id: creds.org_id, pipeline_id: pipelineId, stage_id: etapas["Entrada"], contact_id: contatos[quem],
          title: `Pedido ${quem} ${SUFIXO}`, status: "open",
        })
        .select("id").single();
      if (erroPedido) throw new Error(`Pedido ${quem}: ${erroPedido.message}`);
      pedidos[quem] = pedido!.id as string;
    }
  });

  test.afterAll(async () => {
    for (const s of servidores) await new Promise<void>((resolve) => s.close(() => resolve()));
    if (creds) await limparFixtures();
  });

  test("o gerente cria a chave pela tela e copia o código de instalação", async ({ page }) => {
    await login(page, creds.users.manager!.email, creds.password);
    await page.goto("/app/settings/tenant/pipelines");
    const secao = page.getByTestId(`rastreador-${pipelineId}`);
    await secao.scrollIntoViewIfNeeded();
    await expect(secao.getByTestId("rastreador-vazio")).toBeVisible();
    await expect(secao.getByTestId("rastreador-explicacao")).toContainText("não é uma senha");

    // O servidor do cardápio sobe ANTES, para a chave poder listar a origem dele; o conteúdo vem depois.
    const portaPermitida = await servirPagina();
    const origemPermitida = `http://localhost:${portaPermitida}`;

    await secao.getByTestId("nova-chave").click();
    await secao.getByLabel("Nome da chave").fill("Cardápio E2E");
    await secao.getByLabel(/Sites onde o código vai rodar/).fill(origemPermitida);
    await secao.getByTestId("chave-criar").click();
    const linha = secao.locator('li[data-testid^="chave-"]').first();
    await expect(linha).toBeVisible();
    await expect(linha.locator('[data-testid^="uso-"]')).toContainText("Ainda não recebeu nenhum evento.");
    chaveId = (await linha.getAttribute("data-testid"))!.replace("chave-", "");

    await secao.locator('[data-testid^="ver-codigo-"]').first().click();
    const codigo = secao.locator(`[data-testid="codigo-${chaveId}"] pre`).first();
    trecho = await codigo.innerText();
    expect(trecho).toContain("pk_");
    expect(trecho).toContain("/rastreador/v1.js");
    await captura(page, "01-chave-e-codigo");

    // Agora sim: a página do cardápio, com o código COPIADO DA TELA, na porta que a chave autoriza.
    paginaDoCardapio =
      `<!doctype html><html><head><meta charset="utf-8"><title>Cardápio E2E</title></head><body><h1>Cardápio</h1>${trecho}</body></html>`;
  });

  /** A página do cardápio na origem permitida (porta da chave) ou em outra. */
  async function abrirCardapio(page: Page, host: "localhost" | "127.0.0.1", idtrack: string) {
    const permitida = new URL(
      ((await admin.from("crm_tracker_public_keys").select("allowed_origins").eq("id", chaveId).single()).data!
        .allowed_origins as string[])[0]!,
    );
    await page.goto(`http://${host}:${permitida.port}/?idtrack=${encodeURIComponent(idtrack)}`);
  }

  test("⭐ o cardápio, em outra origem, leva o pedido de Entrada a Compras com valor e JSON", async ({ page }) => {
    const rede = espiarColeta(page);
    await abrirCardapio(page, "localhost", contatos.fluxo);
    await page.evaluate((sufixo) => {
      const d = (window as unknown as { rastreador: (...a: unknown[]) => void }).rastreador;
      d("track", "page_view", { screen_name: "home", phone: "+5517982290042" });
      d("track", "view_item", { item_id: "pizza-1", item_name: "Pizza grande", price: 59.9 });
      d("track", "cart_sync", { items: [{ item_id: "pizza-1", item_name: "Pizza grande", price: 59.9, quantity: 1 }], email: "a@b.com" });
      d("track", "begin_checkout", { value: 73.9, item_count: 1, delivery_type: "delivery" });
      d("track", "purchase", { order_id: `P-${sufixo}`, value: 73.9, payment_method: "pix", nome: "Maria" });
      d("flush");
    }, SUFIXO);

    await expect.poll(async () => (await estadoDoPedido(pedidos.fluxo)).etapa, { timeout: 30_000 }).toBe("Compras");
    const depois = await estadoDoPedido(pedidos.fluxo);
    expect(depois.status).toBe("won");
    expect(depois.valor).toBe(7390);
    expect(depois.campos.pedido).toMatchObject({ order_id: `P-${SUFIXO}`, payment_method: "pix" });
    expect(depois.campos.cart).toMatchObject({ items: [{ item_id: "pizza-1" }] });
    expect(depois.campos.checkout).toMatchObject({ delivery_type: "delivery" });

    // O histórico: cinco eventos, todos com a marca do navegador e da chave, e nada de telefone, e-mail ou nome.
    expect(depois.linhas.map((l) => l.payload.event).sort()).toEqual(
      ["begin_checkout", "cart_sync", "page_view", "purchase", "view_item"],
    );
    expect(depois.linhas.every((l) => l.payload.origem === "navegador" && l.payload.chave_id === chaveId)).toBe(true);
    expect(JSON.stringify(depois.linhas)).not.toMatch(/5517982290042|a@b\.com|Maria/);

    // A metade da rede do par: a requisição saiu do navegador para a chave, com o idtrack e sem credenciais.
    expect(rede.length).toBeGreaterThanOrEqual(1);
    const corpo = JSON.parse(rede[0]!.postData() ?? "{}");
    expect(corpo.idtrack).toBe(contatos.fluxo);
    expect(JSON.stringify(corpo)).not.toMatch(/5517982290042|a@b\.com|Maria/);
    await captura(page, "02-pagina-do-cardapio");
  });

  test("a recarga da página de sucesso não duplica a compra", async ({ page }) => {
    await abrirCardapio(page, "localhost", contatos.fluxo);
    const antes = await estadoDoPedido(pedidos.fluxo);
    await page.evaluate((order) => {
      const d = (window as unknown as { rastreador: (...a: unknown[]) => void }).rastreador;
      d("track", "purchase", { order_id: order, value: 73.9, payment_method: "pix" });
      d("flush");
    }, `P-${SUFIXO}`);
    await page.waitForTimeout(4000);
    const depois = await estadoDoPedido(pedidos.fluxo);
    expect(depois.linhas.filter((l) => l.payload.event === "purchase")).toHaveLength(1);
    expect(depois.linhas).toHaveLength(antes.linhas.length);
    expect(depois.etapa).toBe("Compras");
    expect(depois.valor).toBe(7390);
  });

  test("a compra sem carrinho antes é registrada, mas NÃO fecha o pedido", async ({ page }) => {
    await abrirCardapio(page, "localhost", contatos.semCarrinho);
    await page.evaluate((order) => {
      const d = (window as unknown as { rastreador: (...a: unknown[]) => void }).rastreador;
      d("track", "purchase", { order_id: order, value: 999, payment_method: "pix" });
      d("flush");
    }, `FORJADA-${SUFIXO}`);
    await expect
      .poll(async () => (await estadoDoPedido(pedidos.semCarrinho)).linhas.length, { timeout: 30_000 })
      .toBe(1);
    const depois = await estadoDoPedido(pedidos.semCarrinho);
    expect(depois.etapa).toBe("Entrada");
    expect(depois.status).toBe("open");
    expect(depois.linhas[0]!.payload.origem).toBe("navegador");
  });

  test("um idtrack que é telefone não envia nada: nem requisição sai da página", async ({ page }) => {
    const rede = espiarColeta(page);
    await abrirCardapio(page, "localhost", "+5517982290042");
    await page.evaluate(() => {
      const d = (window as unknown as { rastreador: (...a: unknown[]) => void }).rastreador;
      d("track", "page_view", { screen_name: "home" });
      d("flush");
    });
    await page.waitForTimeout(4500);
    expect(rede).toHaveLength(0);
  });

  test("origem não listada: o navegador bloqueia e nada é gravado", async ({ page }) => {
    const rede = espiarColeta(page);
    // O navegador pode reportar o bloqueio de CORS como resposta sem o cabeçalho ou como requisição falha: as duas valem.
    const semCors: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/v1/coleta/") && !r.headers()["access-control-allow-origin"]) semCors.push(`resposta ${r.status()}`);
    });
    page.on("requestfailed", (r) => {
      if (r.url().includes("/api/v1/coleta/")) semCors.push(`falha ${r.failure()?.errorText ?? ""}`);
    });
    await abrirCardapio(page, "127.0.0.1", contatos.outraOrigem);
    await page.evaluate(() => {
      const d = (window as unknown as { rastreador: (...a: unknown[]) => void }).rastreador;
      d("track", "page_view", { screen_name: "home" });
      d("flush");
    });
    await page.waitForTimeout(4500);
    expect(rede.length).toBeGreaterThanOrEqual(1);
    expect(semCors.length).toBeGreaterThanOrEqual(1);
    expect((await estadoDoPedido(pedidos.outraOrigem)).linhas).toHaveLength(0);
    expect((await estadoDoPedido(pedidos.outraOrigem)).etapa).toBe("Entrada");
  });

  test("a tela mostra o uso da chave; ao revogar, o mesmo código para de funcionar na hora", async ({ page, context }) => {
    await login(page, creds.users.manager!.email, creds.password);
    await page.goto("/app/settings/tenant/pipelines");
    const secao = page.getByTestId(`rastreador-${pipelineId}`);
    await secao.scrollIntoViewIfNeeded();
    await expect(secao.getByTestId(`uso-${chaveId}`)).toContainText("Visto pela última vez em");
    await captura(page, "03-uso-da-chave");

    await secao.getByTestId(`revogar-${chaveId}`).click();
    await secao.getByTestId(`confirmar-revogar-${chaveId}`).click();
    await expect(secao.getByTestId(`situacao-${chaveId}`)).toHaveText("Revogada");
    const { data: chave } = await admin.from("crm_tracker_public_keys").select("is_active, revoked_at").eq("id", chaveId).single();
    expect(chave).toMatchObject({ is_active: false });
    expect(chave!.revoked_at).not.toBeNull();
    await captura(page, "04-chave-revogada");

    const cardapio = await context.newPage();
    await abrirCardapio(cardapio, "localhost", contatos.revogada);
    await cardapio.evaluate(() => {
      const d = (window as unknown as { rastreador: (...a: unknown[]) => void }).rastreador;
      d("track", "page_view", { screen_name: "home" });
      d("flush");
    });
    await cardapio.waitForTimeout(4500);
    expect((await estadoDoPedido(pedidos.revogada)).linhas).toHaveLength(0);
    expect((await estadoDoPedido(pedidos.revogada)).etapa).toBe("Entrada");
  });
});
