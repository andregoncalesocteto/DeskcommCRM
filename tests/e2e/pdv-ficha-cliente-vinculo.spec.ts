/**
 * PDV PELA TELA: VÍNCULO DO CLIENTE DO ERP COM O CONTATO DO CRM (ADR-007 e ADR-008).
 *
 * Abrir a ficha só LÊ. Quem liga o cliente ao contato (pelo telefone) é o atendente: "Vincular" só
 * liga, "Atualizar e vincular" liga e o ERP sobrescreve o contato (com confirmação), e um contato
 * pode ter várias fichas do ERP. "Atualizar dados" puxa o ERP para o contato já vinculado. Tudo
 * contra `/api/v1/pdv/*` INTERCEPTADA: nada fala com o ERP. Afirma, pela tela: (1) abrir a ficha
 * não dispara POST nem PATCH; (2) sem contato, só "Vincular"; (3) o clique faz UM POST sem
 * sobrescrever e a ficha passa a vinculada; (4) com contato que já tem outra ficha, os dois botões e o
 * aviso das outras fichas; (5) "Atualizar e vincular" pede confirmação, Cancelar não escreve e
 * Confirmar faz o POST com `sobrescrever`; (6) "Atualizar dados" faz UM PATCH; (7) sem telefone não há
 * botão; (8) erro da API aparece com orientação; (9) alvos de 44 px e nada pessoal em URL ou storage.
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
  { id: "c3", nome: "Maria Completa", endereco_principal: null },
  { id: "c4", nome: "Maria Falha", endereco_principal: null },
];

type Vinculo = Record<string, unknown>;

function ficha(id: string, nome: string, telefone: string | null, vinculo: Vinculo) {
  return { data: { id, vinculo, nome, telefone, email: null, cpf: null, data_nascimento: null, enderecos: [] } };
}

async function interceptar(page: Page, escritas: string[]) {
  const vinculados = new Set<string>();
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const url = new URL(rota.request().url());
    const metodo = rota.request().method();
    const m = /\/pdv\/clientes\/([^/]+)(\/vinculo)?$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (m[2]) {
        escritas.push(`${metodo} ${id} ${rota.request().postData() ?? ""}`.trim());
        if (id === "c4") {
          return rota.fulfill(json(409, { error: { code: "contato_ambiguo", message: "Há mais de um contato." } }));
        }
        if (metodo === "POST") {
          vinculados.add(id);
          return rota.fulfill(json(201, { data: { contact_id: "k1", contato_criado: id === "c1", vinculo_novo: true, dados_atualizados: false, sem_cpf_email: false } }));
        }
        return rota.fulfill(json(200, { data: { contact_id: "k1", sem_cpf_email: false } }));
      }
      const vinculado = (nome: string, outras: number) => ({ estado: "vinculado", contact_id: "k1", contato_nome: nome, outras_fichas: outras });
      if (id === "c1") {
        return rota.fulfill(json(200, ficha("c1", "Maria Oliveira", "(19) 99876-5432", vinculados.has("c1") ? vinculado("Maria Oliveira", 0) : { estado: "livre", contato: null })));
      }
      if (id === "c2") return rota.fulfill(json(200, ficha("c2", "Maria Sem Telefone", null, { estado: "telefone_ausente" })));
      if (id === "c3" || id === "c4") {
        const livre = { estado: "livre", contato: { nome: "Catia Julio", fichas: 1 } };
        const nome = id === "c3" ? "Maria Completa" : "Maria Falha";
        return rota.fulfill(json(200, ficha(id, nome, "(17) 98229-0059", vinculados.has(id) ? vinculado("Catia Julio", 1) : livre)));
      }
      return rota.fulfill(json(404, { error: { code: "not_found", message: "x" } }));
    }
    if (url.pathname.endsWith("/clientes")) {
      return rota.fulfill(json(200, { data: { clientes: CLIENTES, total_encontrado: CLIENTES.length, truncado: false } }));
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

  test("a ficha só lê; Vincular liga, Atualizar e vincular sobrescreve com confirmação, e os casos sem saída explicam por quê", async ({ page }) => {
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

    // 1 e 2. Sem contato no telefone: abrir a ficha não escreve; só o botão Vincular.
    await page.getByTestId("cliente-c1").click();
    await expect(page.getByTestId("vinculo-estado")).toHaveText("Este cliente ainda não está no CRM.");
    await expect(page.getByTestId("vinculo-vincular")).toBeVisible();
    await expect(page.getByTestId("vinculo-atualizar-e-vincular")).toHaveCount(0);
    expect(escritas, "abrir a ficha escreveu").toEqual([]);
    for (const h of await altura(page, '[data-testid="vinculo"] button')) expect(h, "botão abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-livre.png"), fullPage: true });

    // 3. Um clique: UM POST sem sobrescrever, e a ficha passa a vinculada com "Atualizar dados".
    await page.getByTestId("vinculo-vincular").click();
    await expect(page.getByTestId("vinculo-estado")).toHaveText("Vinculado ao contato: Maria Oliveira");
    await expect(page.getByTestId("vinculo-vincular")).toHaveCount(0);
    expect(escritas).toEqual(["POST c1 {}"]);
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-vinculado.png"), fullPage: true });

    // 6. Atualizar dados: UM PATCH, a ficha continua vinculada.
    await page.getByTestId("vinculo-atualizar").click();
    await expect.poll(() => escritas.length).toBe(2);
    expect(escritas[1]).toMatch(/^PATCH c1/);

    // 7. Cliente sem telefone: sem botão, com o motivo.
    await page.getByTestId("cliente-c2").click();
    await expect(page.getByTestId("vinculo-estado")).toContainText("não tem telefone no ERP");
    await expect(page.getByTestId("vinculo-vincular")).toHaveCount(0);
    await expect(page.getByTestId("vinculo-atualizar")).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-sem-telefone.png"), fullPage: true });

    // 4. Contato que já tem outra ficha do ERP: os dois botões e o aviso.
    await page.getByTestId("cliente-c3").click();
    await expect(page.getByTestId("vinculo-estado")).toContainText("Já existe um contato com este telefone: Catia Julio");
    await expect(page.getByTestId("vinculo-estado")).toContainText("outras fichas do ERP: 1");
    await expect(page.getByTestId("vinculo-vincular")).toBeVisible();
    await expect(page.getByTestId("vinculo-atualizar-e-vincular")).toBeVisible();
    for (const h of await altura(page, '[data-testid="vinculo"] button')) expect(h, "botão abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-contato-com-outra-ficha.png"), fullPage: true });

    // 5. Atualizar e vincular pede confirmação; Cancelar não escreve; Confirmar faz o POST com sobrescrever.
    const antes = escritas.length;
    await page.getByTestId("vinculo-atualizar-e-vincular").click();
    await expect(page.getByTestId("vinculo-estado")).toContainText('O contato "Catia Julio" será sobrescrito com os dados desta ficha.');
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-confirmar-sobrescrever.png"), fullPage: true });
    await page.getByTestId("vinculo-cancelar").click();
    await expect(page.getByTestId("vinculo-atualizar-e-vincular")).toBeVisible();
    expect(escritas.length, "Cancelar escreveu").toBe(antes);
    await page.getByTestId("vinculo-atualizar-e-vincular").click();
    await page.getByTestId("vinculo-confirmar").click();
    await expect(page.getByTestId("vinculo-estado")).toContainText("Vinculado ao contato: Catia Julio");
    expect(escritas.at(-1)).toBe('POST c3 {"sobrescrever":true}');

    // 8. A API recusa (mais de um contato no número): mensagem com orientação, os botões continuam.
    await page.getByTestId("cliente-c4").click();
    await page.getByTestId("vinculo-vincular").click();
    await expect(page.getByTestId("vinculo-erro")).toContainText("Há mais de um contato com este telefone");
    await expect(page.getByTestId("vinculo-vincular")).toBeVisible();
    expect(escritas.at(-1)).toBe("POST c4 {}");
    await page.screenshot({ path: path.join(EVIDENCIA, "vinculo-erro.png"), fullPage: true });

    // 9. LGPD: nada pessoal na URL nem no storage.
    expect(page.url()).not.toMatch(/9876|98229|Maria/i);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(storage).not.toMatch(/99876-5432|98229-0059/);
  });
});
