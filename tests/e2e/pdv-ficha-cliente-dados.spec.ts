/**
 * PDV PELA TELA: FICHA DO CLIENTE, DADOS PESSOAIS (US-016).
 *
 * O atendente escolhe um candidato (ou chega por um resultado único) e confere nome, telefone,
 * e-mail, CPF mascarado e data de nascimento na coluna da direita. Tudo contra `/api/v1/pdv/*`
 * INTERCEPTADA: nada fala com o ERP. Afirma: ficha somente leitura (sem botão de editar, adicionar,
 * remover ou selecionar), "Não informado" para campo ausente, CPF só com os quatro últimos dígitos,
 * CPF e nascimento fora da URL e do storage, nome longo sem estourar o layout, e os estados de
 * carregando, erro com "Tentar de novo", não encontrado e contato que já tem outra ficha do ERP (ADR-007 e ADR-008:
 * abrir a ficha não escreve; os botões de vínculo ficam em `pdv-ficha-cliente-vinculo`). Alvos de 44 px medidos
 * com `getBoundingClientRect`.
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

const NOME_LONGO = "Maria de Fátima Albuquerque Nascimento Souza dos Santos Figueiredo Cavalcanti Montenegro";

const CLIENTES = [
  { id: "c1", nome: "Maria Oliveira", endereco_principal: "Rua das Acácias, 120 - Campinas/SP" },
  { id: "c2", nome: NOME_LONGO, endereco_principal: null },
  { id: "c3", nome: "Mariana Lopes", endereco_principal: "Rua Dr. Sampaio Ferraz, 45" },
  { id: "c4", nome: "Maria Sumida", endereco_principal: null },
  { id: "c5", nome: "Maria Duplicada", endereco_principal: null },
];

const FICHAS: Record<string, { status: number; corpo: unknown }> = {
  c1: {
    status: 200,
    corpo: {
      data: {
        id: "c1", vinculo: { estado: "livre", contato: null }, nome: "Maria Oliveira", telefone: "(19) 99876-5432",
        email: "maria.oliveira@email.com", cpf: "52998224725", data_nascimento: "1988-03-14", enderecos: [],
      },
    },
  },
  c2: {
    status: 200,
    corpo: {
      data: { id: "c2", vinculo: { estado: "vinculado", contact_id: "k2", contato_nome: "Maria de Fátima", outras_fichas: 0 }, nome: NOME_LONGO, telefone: "(19) 98123-4567", email: null, cpf: null, data_nascimento: null, enderecos: [] },
    },
  },
  c4: { status: 404, corpo: { error: { code: "not_found", message: "Cliente não encontrado no ERP." } } },
  c5: {
    status: 200,
    corpo: {
      data: {
        id: "c5", vinculo: { estado: "livre", contato: { nome: "Maria Original", fichas: 1 } }, nome: "Maria Duplicada",
        telefone: "(17) 98229-0042", email: null, cpf: "11144477735", data_nascimento: null, enderecos: [],
      },
    },
  },
};

async function interceptar(page: Page, chamadas: string[], opcoes: { falhaC3Vezes?: number; atrasoMs?: number } = {}) {
  let falhas = 0;
  await page.route("**/api/v1/pdv/**", async (rota) => {
    const url = new URL(rota.request().url());
    const m = /\/pdv\/clientes\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      chamadas.push(id);
      if (opcoes.atrasoMs) await new Promise((r) => setTimeout(r, opcoes.atrasoMs));
      if (id === "c3" && falhas < (opcoes.falhaC3Vezes ?? 0)) {
        falhas += 1;
        return rota.fulfill(json(502, { error: { code: "erp_indisponivel", message: "O ERP falhou." } }));
      }
      if (id === "c3") {
        return rota.fulfill(
          json(200, { data: { id: "c3", vinculo: { estado: "livre", contato: null }, nome: "Mariana Lopes", telefone: "(19) 99701-2233", email: null, cpf: "11144477735", data_nascimento: "2001-12-01", enderecos: [] } }),
        );
      }
      const f = FICHAS[id];
      return rota.fulfill(f ? json(f.status, f.corpo) : json(404, { error: { code: "not_found", message: "x" } }));
    }
    if (url.pathname.endsWith("/clientes")) {
      const modo = url.searchParams.get("modo");
      const lista = modo === "nome" ? CLIENTES : [CLIENTES[0]!];
      return rota.fulfill(json(200, { data: { clientes: lista, total_encontrado: lista.length, truncado: false } }));
    }
    return rota.fulfill(json(404, { error: { code: "not_found", message: "Recurso não encontrado." } }));
  });
}

async function altura(page: Page, seletor: string) {
  return page.locator(seletor).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
}

async function buscarNome(page: Page, termo: string) {
  await page.getByTestId("busca-modo").click();
  await page.getByRole("option", { name: "Nome" }).click();
  await page.getByTestId("busca-termo").fill(termo);
  await page.getByTestId("busca-buscar").click();
  await expect(page.getByTestId("resultados-lista")).toBeVisible();
}

test.describe("PDV: ficha do cliente, dados pessoais", () => {
  test.beforeAll(async () => {
    await afirmarDonoDoServidor(lerCreds().users.dono!.email);
    fs.mkdirSync(EVIDENCIA, { recursive: true });
  });

  test("a ficha mostra os dados pessoais e trata carregando, erro, não encontrado e contato com outra ficha", async ({ page }) => {
    test.setTimeout(180_000);
    await loginComoDono(page, lerCreds());

    await page.goto("/admin/modulos");
    const instalar = page.getByTestId("instalar-pdv");
    if (await instalar.isVisible()) await instalar.click();
    await expect(page.getByTestId("modulo-pdv").getByText("Instalado", { exact: true })).toBeVisible({ timeout: 30_000 });

    const chamadas: string[] = [];
    await interceptar(page, chamadas, { falhaC3Vezes: 1, atrasoMs: 1_200 });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(PAGINA);

    // 1. Sem cliente escolhido: a coluna da direita diz isso.
    await expect(page.getByTestId("ficha-nenhuma")).toHaveText("Nenhum cliente selecionado");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-016-nenhum-selecionado.png"), fullPage: true });

    // 2. Busca por nome: vários candidatos, nenhuma ficha aberta sozinha.
    await buscarNome(page, "maria");
    await expect(page.getByTestId("ficha-nenhuma")).toBeVisible();
    expect(chamadas, "vários candidatos não abrem ficha sozinhos").toHaveLength(0);

    // 3. Carregando: esqueleto na coluna da direita.
    await page.getByTestId("cliente-c1").click();
    await expect(page.getByTestId("ficha-carregando")).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCIA, "us-016-carregando.png"), fullPage: true });

    // 4. Ficha completa: rótulos e valores, CPF mascarado, nascimento em dd/mm/aaaa.
    await expect(page.getByTestId("ficha")).toBeVisible();
    await expect(page.getByTestId("ficha-nome-valor")).toHaveText("Maria Oliveira");
    await expect(page.getByTestId("ficha-telefone-valor")).toHaveText("(19) 99876-5432");
    await expect(page.getByTestId("ficha-email-valor")).toHaveText("maria.oliveira@email.com");
    await expect(page.getByTestId("ficha-cpf-valor")).toHaveText("***.***.*47-25");
    await expect(page.getByTestId("ficha-nascimento-valor")).toHaveText("14/03/1988");
    expect(await page.locator("body").innerText(), "CPF inteiro na tela").not.toContain("529.982");
    expect(chamadas).toEqual(["c1"]);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-016-ficha-completa.png"), fullPage: true });

    // 5. Somente leitura: nenhum botão dentro da ficha, e nada de editar/adicionar/remover/selecionar.
    expect(await page.locator('[data-testid="ficha"] button').count()).toBe(0);
    await expect(page.getByRole("button", { name: /editar|adicionar|remover|selecionar cliente/i })).toHaveCount(0);

    // 6. LGPD: CPF e nascimento fora da URL e do storage.
    expect(page.url()).not.toMatch(/52998224725|529\.982|1988|14\/03/);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(storage).not.toMatch(/52998224725|529\.982|1988-03-14|14\/03\/1988/);

    // 7. Nome longo e campos ausentes: "Não informado", sem estourar o layout.
    await page.getByTestId("cliente-c2").click();
    await expect(page.getByTestId("ficha-nome-valor")).toHaveText(NOME_LONGO);
    for (const campo of ["email", "cpf", "nascimento"]) {
      await expect(page.getByTestId(`ficha-${campo}-valor`)).toHaveText("Não informado");
    }
    const estouro = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(estouro, "a página ganhou rolagem horizontal").toBeLessThanOrEqual(0);
    const caixa = await page.evaluate(() => {
      const ficha = document.querySelector('[data-testid="ficha"]')!.getBoundingClientRect();
      const nome = document.querySelector('[data-testid="ficha-nome-valor"]')!.getBoundingClientRect();
      return { fichaDir: ficha.right, nomeDir: nome.right };
    });
    expect(caixa.nomeDir, "o nome vazou da ficha").toBeLessThanOrEqual(caixa.fichaDir);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-016-nome-longo-e-ausentes.png"), fullPage: true });

    // 8. Alvos de 44 px nos candidatos.
    for (const h of await altura(page, '[data-testid="resultados-lista"] button')) expect(h, "candidato abaixo de 44 px").toBeGreaterThanOrEqual(44);

    // 9. Erro com "Tentar de novo": a 1a chamada falha, a segunda traz a ficha.
    await page.getByTestId("cliente-c3").click();
    await expect(page.getByTestId("ficha-erro")).toContainText("Não foi possível carregar a ficha do cliente.");
    for (const h of await altura(page, '[data-testid="ficha-erro"] button')) expect(h, "Tentar de novo abaixo de 44 px").toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: path.join(EVIDENCIA, "us-016-erro.png"), fullPage: true });
    await page.getByRole("button", { name: "Tentar de novo" }).click();
    await expect(page.getByTestId("ficha-nome-valor")).toHaveText("Mariana Lopes");
    await expect(page.getByTestId("ficha-cpf-valor")).toHaveText("***.***.*77-35");
    expect(chamadas.filter((c) => c === "c3")).toHaveLength(2);

    // 10. Cliente não encontrado (404 do ERP).
    await page.getByTestId("cliente-c4").click();
    await expect(page.getByTestId("ficha-nao-encontrado")).toHaveText("Cliente não encontrado no ERP. Busque de novo.");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-016-nao-encontrado.png"), fullPage: true });

    // 11. O telefone já tem contato, ligado a outra ficha do ERP: os dois botões, sem escrever nada ao abrir.
    await page.getByTestId("cliente-c5").click();
    await expect(page.getByTestId("vinculo-estado")).toContainText("Já existe um contato com este telefone: Maria Original");
    await expect(page.getByTestId("vinculo-estado")).toContainText("outras fichas do ERP: 1");
    await expect(page.getByTestId("vinculo-vincular")).toBeVisible();
    await expect(page.getByTestId("vinculo-atualizar-e-vincular")).toBeVisible();
    await expect(page.getByTestId("ficha-nome-valor")).toHaveText("Maria Duplicada");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-016-contato-com-outra-ficha.png"), fullPage: true });

    // 12. Resultado único (telefone) abre a ficha direto.
    await page.getByTestId("busca-modo").click();
    await page.getByRole("option", { name: "Telefone" }).click();
    await page.getByTestId("busca-termo").fill("19998765432");
    await page.getByTestId("busca-buscar").click();
    await expect(page.getByTestId("ficha-nome-valor")).toHaveText("Maria Oliveira");
    await page.screenshot({ path: path.join(EVIDENCIA, "us-016-resultado-unico.png"), fullPage: true });
  });
});
