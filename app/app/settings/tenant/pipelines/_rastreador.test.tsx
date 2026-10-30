/**
 * A seção "Rastreador para o site do cardápio" — o que ela ENVIA, o que ela COPIA e o que ela DIZ.
 *
 * Três decisões só existem na tela: validar os sites antes de enviar (a mesma regra da API), gerar o código de
 * instalação com a chave e o endereço do CRM, e explicar em português simples que a chave NÃO é uma senha e que
 * cancelar pedido não passa por aqui.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/types";
import type { ChaveDoRastreador } from "@/hooks/pipelines/useChavesDoRastreador";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { RastreadorSection, origensDoTexto, trechoDeInstalacao, usoDaChave } from "./_rastreador";

const PIPE = "11111111-1111-4111-8111-111111111111";
const ROTA = `/api/v1/pipelines/${PIPE}/tracker-keys`;
const CHAVE = `pk_${"a1".repeat(18)}`;

function chave(over: Partial<ChaveDoRastreador> = {}): ChaveDoRastreador {
  return {
    id: "k-1", pipeline_id: PIPE, public_key: CHAVE, label: "Cardápio digital", allowed_origins: ["https://cardapio.exemplo"],
    is_active: true, revoked_at: null, created_at: "2026-10-29T10:00:00Z", ultimo_recebimento: null, recebidos_7_dias: 0, ...over,
  };
}

const servir = (chaves: ChaveDoRastreador[]) =>
  vi.mocked(apiClient.get).mockImplementation(async () => ({ data: { chaves } }));

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RastreadorSection pipelineId={PIPE} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset();
  vi.mocked(apiClient.post).mockReset();
  vi.mocked(apiClient.delete).mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("trechoDeInstalacao", () => {
  it("⭐ leva a chave e o endereço do CRM, sem barra sobrando, e carrega o arquivo do rastreador", () => {
    const codigo = trechoDeInstalacao("https://crm.exemplo/", CHAVE);
    expect(codigo).toContain(`rastreador("init",{key:"${CHAVE}",endpoint:"https://crm.exemplo"});`);
    expect(codigo).toContain('"https://crm.exemplo/rastreador/v1.js"');
    expect(codigo.startsWith("<script>")).toBe(true);
    expect(codigo.endsWith("</script>")).toBe(true);
    expect(codigo).not.toContain("//rastreador/v1.js");
  });

  it("não carrega segredo nenhum: só a chave pública", () => {
    expect(trechoDeInstalacao("https://crm.exemplo", CHAVE)).not.toMatch(/dsk_|Bearer|token/i);
  });
});

describe("origensDoTexto", () => {
  it("separa por linha, apara e tira repetidas", () => {
    expect(origensDoTexto(" https://a.exemplo/ \n\nhttps://a.exemplo\nhttps://b.exemplo")).toEqual({
      ok: true,
      origens: ["https://a.exemplo", "https://b.exemplo"],
    });
  });
  it("vazio não serve; a primeira linha inválida é apontada", () => {
    expect(origensDoTexto("  \n ")).toEqual({ ok: false, invalida: null });
    expect(origensDoTexto("https://ok.exemplo\nhttp://inseguro.exemplo")).toEqual({ ok: false, invalida: "http://inseguro.exemplo" });
  });
});

describe("usoDaChave", () => {
  it("nunca recebeu: diz isso; recebeu: última vez e semana", () => {
    expect(usoDaChave(chave(), (s) => s, "pt-BR")).toBe("Ainda não recebeu nenhum evento.");
    const texto = usoDaChave(chave({ ultimo_recebimento: "2026-10-29T18:28:00Z", recebidos_7_dias: 4 }), (s) => s, "pt-BR");
    expect(texto).toContain("Visto pela última vez em");
    expect(texto).toContain("4 nos últimos 7 dias");
  });
});

describe("a seção", () => {
  it("⭐ sem chave: explica o que é a chave, que não é senha, e que cancelar não passa por aqui", async () => {
    servir([]);
    montar();
    expect(await screen.findByTestId("rastreador-vazio")).toBeInTheDocument();
    const explicacao = screen.getByTestId("rastreador-explicacao");
    expect(explicacao).toHaveTextContent("não é uma senha");
    expect(explicacao).toHaveTextContent("não consegue ler nada do CRM");
    expect(explicacao).toHaveTextContent("cancelamento de um pedido não passa por aqui");
  });

  it("lista a chave com sites, situação e o sinal de que ainda não recebeu nada", async () => {
    servir([chave()]);
    montar();
    expect(await screen.findByTestId("valor-k-1")).toHaveTextContent(CHAVE);
    expect(screen.getByTestId("sites-k-1")).toHaveTextContent("https://cardapio.exemplo");
    expect(screen.getByTestId("situacao-k-1")).toHaveTextContent("Ativa");
    expect(screen.getByTestId("uso-k-1")).toHaveTextContent("Ainda não recebeu nenhum evento.");
  });

  it("mostra quando a chave já recebeu evento", async () => {
    servir([chave({ ultimo_recebimento: "2026-10-29T18:28:00Z", recebidos_7_dias: 3 })]);
    montar();
    expect(await screen.findByTestId("uso-k-1")).toHaveTextContent("3 nos últimos 7 dias");
  });

  it("⭐ criar: envia nome e sites normalizados; a organização e o funil não vão no corpo", async () => {
    servir([]);
    vi.mocked(apiClient.post).mockResolvedValue({ data: { chave: chave() } });
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByTestId("nova-chave"));
    await u.type(screen.getByLabelText("Nome da chave"), "Cardápio digital");
    await u.type(screen.getByLabelText(/Sites onde o código vai rodar/), "https://Cardapio.Exemplo/\nhttp://localhost:3000");
    await u.click(screen.getByTestId("chave-criar"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith(ROTA, {
      label: "Cardápio digital",
      allowed_origins: ["https://cardapio.exemplo", "http://localhost:3000"],
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Chave criada."));
  });

  it.each([
    ["sem nome", "", "https://a.exemplo", "Dê um nome à chave."],
    ["sem site", "Cardápio", "", "Informe ao menos um site"],
    ["http fora de localhost", "Cardápio", "http://a.exemplo", "Site não aceito"],
    ["com caminho", "Cardápio", "https://a.exemplo/cardapio", "Site não aceito"],
  ])("⭐ %s: mostra o motivo e NÃO chama a API", async (_n, nome, sites, mensagem) => {
    servir([]);
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByTestId("nova-chave"));
    if (nome) await u.type(screen.getByLabelText("Nome da chave"), nome);
    if (sites) await u.type(screen.getByLabelText(/Sites onde o código vai rodar/), sites);
    await u.click(screen.getByTestId("chave-criar"));
    expect(await screen.findByTestId("chave-erro")).toHaveTextContent(mensagem);
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("erro do servidor aparece em português, sem vazar texto de infraestrutura", async () => {
    servir([]);
    vi.mocked(apiClient.post).mockRejectedValue(new ApiError(500, "internal_error", undefined, "r", "duplicate key value violates"));
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByTestId("nova-chave"));
    await u.type(screen.getByLabelText("Nome da chave"), "X");
    await u.type(screen.getByLabelText(/Sites onde o código vai rodar/), "https://a.exemplo");
    await u.click(screen.getByTestId("chave-criar"));
    const erro = await screen.findByTestId("chave-erro");
    expect(erro).not.toHaveTextContent(/duplicate key|violates/i);
  });

  it("⭐ copiar põe o código pronto, com a chave, na área de transferência", async () => {
    servir([chave()]);
    const u = userEvent.setup();
    // Depois do setup: o user-event instala o PRÓPRIO dublê de clipboard e cobriria o nosso.
    const escrever = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    montar();
    await u.click(await screen.findByTestId("copiar-k-1"));
    await waitFor(() => expect(escrever).toHaveBeenCalledTimes(1));
    const copiado = String((escrever.mock.calls as unknown[][])[0]![0]);
    expect(copiado).toContain(CHAVE);
    expect(copiado).toContain(`${window.location.origin}/rastreador/v1.js`);
  });

  it("se copiar falha, o código abre na tela para copiar à mão", async () => {
    servir([chave()]);
    const u = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("negado"); }) }, configurable: true });
    montar();
    await u.click(await screen.findByTestId("copiar-k-1"));
    expect(await screen.findByTestId("codigo-k-1")).toHaveTextContent(CHAVE);
    expect(toast.error).toHaveBeenCalled();
  });

  it("⭐ revogar pede confirmação, avisa que o código para na hora e só então chama a API", async () => {
    servir([chave()]);
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { chave: chave({ is_active: false, revoked_at: "2026-10-29T11:00:00Z" }) } });
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByTestId("revogar-k-1"));
    expect(apiClient.delete).not.toHaveBeenCalled();
    expect(screen.getByTestId("aviso-revogar-k-1")).toHaveTextContent("deixa de funcionar na hora");
    await u.click(screen.getByTestId("confirmar-revogar-k-1"));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith(`${ROTA}/k-1`));
  });

  it("cancelar a confirmação não revoga nada", async () => {
    servir([chave()]);
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByTestId("revogar-k-1"));
    await u.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(apiClient.delete).not.toHaveBeenCalled();
    expect(screen.getByTestId("revogar-k-1")).toBeInTheDocument();
  });

  it("chave revogada aparece como revogada e não oferece copiar nem revogar", async () => {
    servir([chave({ is_active: false, revoked_at: "2026-10-29T11:00:00Z" })]);
    montar();
    expect(await screen.findByTestId("situacao-k-1")).toHaveTextContent("Revogada");
    expect(screen.queryByTestId("copiar-k-1")).toBeNull();
    expect(screen.queryByTestId("revogar-k-1")).toBeNull();
  });

  it("⭐ excluir as revogadas pede confirmação e só então chama a API; sem revogada, o botão nem aparece", async () => {
    servir([chave(), chave({ id: "k-2", is_active: false, revoked_at: "2026-10-29T11:00:00Z" })]);
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { excluidas: 1 } });
    const u = userEvent.setup();
    montar();
    await u.click(await screen.findByTestId("excluir-revogadas-botao"));
    expect(apiClient.delete).not.toHaveBeenCalled();
    expect(screen.getByTestId("aviso-excluir-revogadas")).toHaveTextContent("somem da lista de vez");
    await u.click(screen.getByTestId("confirmar-excluir-revogadas"));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith(ROTA));
  });

  it("só chaves ativas: não oferece excluir", async () => {
    servir([chave()]);
    montar();
    await screen.findByTestId("copiar-k-1");
    expect(screen.queryByTestId("excluir-revogadas")).toBeNull();
  });

  it("falha ao ler: mensagem simples, sem quebrar a tela", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("boom"));
    montar();
    expect(await screen.findByTestId("rastreador-erro-leitura")).toBeInTheDocument();
  });
});
