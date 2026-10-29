/**
 * EVENTOS DO FUNIL, PELA TELA (etapa 1 do épico, US-018).
 *
 * Um gerente cadastra, em Configurações › Funis, o evento de compra que leva o
 * card à etapa que fecha a venda; um sistema de fora (aqui, o MCP real com o
 * token do seed) manda a compra; a tela passa a mostrar que o evento foi visto
 * e tranca a chave. Sem mock de HTTP, de DOM ou de banco.
 *
 * O PAR (prova-em-par): o texto cru da compra vai pela ferramenta direto
 * (`crm_track_event`) e o que ela devolveu é conferido no banco; a tela mostra
 * o mesmo fato por outro caminho (o sinal de uso). Nenhum agente de IA no meio.
 *
 * O funil é PRÓPRIO da spec, semeado e apagado por ela: a tela de Funis lista
 * todos os funis da organização, e a spec só mira o seu cartão.
 *
 * Pré-requisitos (banco local do baseline, app buildada):
 *   pnpm e2e:env && pnpm e2e:build
 *   pnpm exec playwright test tests/e2e/eventos-do-funil.spec.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { carregarEnvLocal } from "../../scripts/lib/env-de-teste";
import { expect, test, type Page } from "./helpers/test";

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const EVIDENCIA = process.env.E2E_EVIDENCIA_EVENTOS ?? path.join(process.cwd(), "evidence/eventos-do-funil");

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
const NOME_DO_FUNIL = `Eventos E2E ${SUFIXO}`;

let creds: Creds;
let bearer: string;
let pipelineId = "";
let etapaEntradaId = "";
let etapaComprasId = "";
let leadId = "";

async function login(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
}

async function captura(page: Page, nome: string): Promise<void> {
  fs.mkdirSync(EVIDENCIA, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCIA, `e2e-${nome}.png`), fullPage: true });
}

async function limparFixtures(): Promise<void> {
  const { data } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", creds.org_id)
    .like("name", "Eventos E2E %");
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) return;
  await admin.from("crm_pipeline_events").delete().in("pipeline_id", ids);
  await admin.from("crm_lead_activities").delete().in("pipeline_id", ids);
  await admin.from("crm_leads").delete().in("pipeline_id", ids);
  await admin.from("crm_stages").delete().in("pipeline_id", ids);
  await admin.from("crm_pipelines").delete().in("id", ids);
}

/** Chama uma ferramenta do MCP com o token do seed e devolve o JSON da resposta. */
async function ferramenta(page: Page, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await page.request.post("/api/mcp", {
    headers: { authorization: `Bearer ${bearer}`, accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(response.status()).toBe(200);
  const texto = await response.text();
  const linha = texto.split("\n").find((l) => l.startsWith("data:"));
  const envelope = JSON.parse(linha ? linha.slice(5).trim() : texto);
  expect(envelope.error).toBeUndefined();
  expect(envelope.result.isError).not.toBe(true);
  return JSON.parse(envelope.result.content[0].text) as Record<string, unknown>;
}

test.describe("Eventos do funil — cadastro pela tela e primeiro recebimento", () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeAll(async () => {
    if (!fs.existsSync(CREDS_PATH)) {
      execFileSync("npx", ["tsx", "scripts/seed-e2e-credentials.ts"], { stdio: "inherit" });
    }
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
    execFileSync("npx", ["tsx", "scripts/seed-e2e-agente-mcp.ts"], { stdio: "inherit" });
    bearer = (JSON.parse(fs.readFileSync(".e2e-agente-mcp.json", "utf8")) as { bearer: string }).bearer;
    await limparFixtures();

    const { data: funil, error: erroFunil } = await admin
      .from("crm_pipelines")
      .insert({ organization_id: creds.org_id, name: NOME_DO_FUNIL, slug: `eventos-e2e-${SUFIXO}` })
      .select("id")
      .single();
    if (erroFunil) throw new Error(`Funil da prova: ${erroFunil.message}`);
    pipelineId = funil!.id as string;

    const etapas = await admin
      .from("crm_stages")
      .insert([
        { organization_id: creds.org_id, pipeline_id: pipelineId, name: "Entrada", slug: "entrada", position: 1000,
          is_won: false, is_lost: false },
        {
          organization_id: creds.org_id, pipeline_id: pipelineId, name: "Compras", slug: "compras",
          position: 2000, is_won: true, is_lost: false,
        },
      ])
      .select("id, slug");
    if (etapas.error) throw new Error(`Etapas da prova: ${etapas.error.message}`);
    etapaEntradaId = etapas.data!.find((e) => e.slug === "entrada")!.id as string;
    etapaComprasId = etapas.data!.find((e) => e.slug === "compras")!.id as string;

    const { data: lead, error: erroLead } = await admin
      .from("crm_leads")
      .insert({
        organization_id: creds.org_id, pipeline_id: pipelineId, stage_id: etapaEntradaId,
        title: `Pedido ${SUFIXO}`,
      })
      .select("id")
      .single();
    if (erroLead) throw new Error(`Pedido da prova: ${erroLead.message}`);
    leadId = lead!.id as string;
  });

  test.afterAll(async () => {
    if (creds) await limparFixtures();
  });

  test("o gerente cadastra a compra; a compra chega; a tela mostra o uso e tranca a chave", async ({ page }) => {
    await login(page, creds.users.manager!.email, creds.password);
    await page.goto("/app/settings/tenant/pipelines");

    const secao = page.getByTestId(`eventos-${pipelineId}`);
    await secao.scrollIntoViewIfNeeded();
    await expect(secao.getByTestId("eventos-vazio")).toBeVisible();
    await captura(page, "01-vazio");

    // ── Cadastro pela tela, como uma pessoa faria ───────────────────────────
    await secao.getByTestId("novo-evento").click();
    const form = secao.getByTestId("form-novo");
    await form.getByLabel("Nome do evento").fill("Compra concluída");
    await form.getByLabel("Chave que o outro sistema envia").fill("purchase");
    await form.getByTestId("novo-etapa").click();
    await page.getByRole("option", { name: "Compras" }).click();
    await form.getByTestId("novo-avancado").click();
    await form.getByLabel("Guardar o último conteúdo recebido em").fill("pedido");
    await form.getByLabel("Campo do valor da venda").fill("value");
    await form.getByLabel("Reconhecer o mesmo fato por").fill("order_id");
    await form.getByLabel("Respeitar o que a equipe moveu à mão").click();
    await captura(page, "02-formulario");
    await form.getByTestId("novo-salvar").click();

    const linha = secao.getByTestId("evento-purchase");
    await expect(linha).toBeVisible();
    await expect(linha.getByTestId("destino-purchase")).toContainText("Compras");
    await expect(linha.getByTestId("uso-purchase")).toContainText("Ainda não recebeu nada.");
    await captura(page, "03-cadastrado");

    // O banco guardou o que a tela mostrou.
    const { data: cadastro } = await admin
      .from("crm_pipeline_events")
      .select("key, stage_id, state_key, value_path, value_unit, dedupe_path, respects_manual_move, is_active")
      .eq("pipeline_id", pipelineId)
      .eq("key", "purchase")
      .single();
    expect(cadastro).toMatchObject({
      key: "purchase", stage_id: etapaComprasId, state_key: "pedido", value_path: "value",
      dedupe_path: "order_id", respects_manual_move: false, is_active: true,
    });

    // ── A compra chega pela ferramenta real (a metade direta do par) ────────
    const resposta = await ferramenta(page, "crm_track_event", {
      lead_id: leadId,
      events: [{ event: "purchase", event_id: `e2e-${SUFIXO}`, data: { value: "73.90", order_id: `P-${SUFIXO}` } }],
    });
    const resultados = resposta.resultados as { resultado: string; valor?: unknown; movimento?: unknown }[];
    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.resultado).toBe("registrado");

    await expect
      .poll(async () => {
        const { data } = await admin.from("crm_leads").select("stage_id, value_cents").eq("id", leadId).single();
        return data;
      })
      .toMatchObject({ stage_id: etapaComprasId, value_cents: 7390 });

    // ── A tela, por outro caminho, mostra o mesmo fato ──────────────────────
    await page.reload();
    const linhaDepois = page.getByTestId(`eventos-${pipelineId}`).getByTestId("evento-purchase");
    await linhaDepois.scrollIntoViewIfNeeded();
    await expect(linhaDepois.getByTestId("uso-purchase")).toContainText("Visto pela última vez em");
    await expect(linhaDepois.getByTestId("uso-purchase")).toContainText("1");
    await linhaDepois.getByTestId("editar-purchase").click();
    await expect(page.getByTestId("form-editar-purchase").getByLabel("Chave que o outro sistema envia")).toBeDisabled();
    await captura(page, "04-uso-e-chave-trancada");
  });

  test("o gerente desativa o evento; o aviso de uso some e a ativação volta", async ({ page }) => {
    await login(page, creds.users.manager!.email, creds.password);
    await page.goto("/app/settings/tenant/pipelines");
    const secao = page.getByTestId(`eventos-${pipelineId}`);
    await secao.scrollIntoViewIfNeeded();
    await secao.getByTestId("alternar-purchase").click();
    await expect(secao.getByTestId("desativado-purchase")).toBeVisible();
    const { data: off } = await admin
      .from("crm_pipeline_events").select("is_active").eq("pipeline_id", pipelineId).eq("key", "purchase").single();
    expect(off!.is_active).toBe(false);
    await captura(page, "05-desativado");

    await secao.getByTestId("alternar-purchase").click();
    await expect(secao.getByTestId("desativado-purchase")).toHaveCount(0);
  });
});
