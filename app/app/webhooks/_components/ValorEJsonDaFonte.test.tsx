/**
 * A seção "Valor e itens do pedido" da fonte do webhook de entrada: o que ela mostra, o que ela ENVIA e os dois avisos
 * sobre a etapa padrão da fonte.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { WebhookSourceRow } from "@/hooks/webhooks/useWebhookSources";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { apiClient } from "@/lib/api/client";
import { ValorEJsonDaFonte, corpoDoSalvar } from "./ValorEJsonDaFonte";

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function fonte(over: Partial<WebhookSourceRow> = {}): WebhookSourceRow {
  return {
    id: "src-1", organization_id: "org-1", name: "Cardápio", path_token: "tok", is_active: true,
    authorize_ai_on_capture: false, update_existing_lead_on_capture: false, reuse_open_lead_on_capture: false,
    value_path: null, value_unit: null, payload_state_key: null, kind: "lead_capture", last_received_at: null,
    default_pipeline_id: "p-1", default_stage_id: "s-1", redirect_to: null, field_map: {}, form_fields: [], has_secret: true,
    created_at: "2026-10-29T10:00:00Z", updated_at: "2026-10-29T10:00:00Z", last_change_actor_kind: null, last_change_at: null,
    ...over,
  };
}

function servirEtapa(over: { name: string; is_won: boolean }) {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { stages: [{ id: "s-1", ...over }] } });
}

function montar(f: WebhookSourceRow, podeEditar = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ValorEJsonDaFonte source={f} podeEditar={podeEditar} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(apiClient.get).mockReset();
  vi.mocked(apiClient.patch).mockReset();
  servirEtapa({ name: "Em conversa", is_won: false });
});

describe("corpoDoSalvar", () => {
  it("campo vazio limpa os dois (caminho e unidade vão juntos ou nenhum)", () => {
    expect(corpoDoSalvar({ caminho: "  ", unidade: "centavos", chaveDoJson: "" })).toEqual({
      ok: true, corpo: { value_path: null, value_unit: null, payload_state_key: null },
    });
  });
  it("com caminho, a unidade escolhida acompanha; a chave do JSON é aparada", () => {
    expect(corpoDoSalvar({ caminho: " pedido.total ", unidade: "centavos", chaveDoJson: " pedido_json " })).toEqual({
      ok: true, corpo: { value_path: "pedido.total", value_unit: "centavos", payload_state_key: "pedido_json" },
    });
  });
  it("⭐ recusa caminho fora da forma e chave fora do formato, com o motivo", () => {
    expect(corpoDoSalvar({ caminho: "items[0].price", unidade: "reais", chaveDoJson: "" })).toMatchObject({ ok: false });
    expect(corpoDoSalvar({ caminho: "", unidade: "reais", chaveDoJson: "Pedido-JSON" })).toMatchObject({ ok: false });
  });
});

describe("a seção", () => {
  it("mostra os campos com explicação em linguagem simples e nenhum nome de coluna do banco", async () => {
    montar(fonte());
    const secao = await screen.findByTestId("valor-e-json-da-fonte");
    expect(secao).toHaveTextContent("Valor e itens do pedido");
    expect(secao).toHaveTextContent("diga em qual campo ele vem");
    expect(secao.textContent).not.toMatch(/value_path|value_unit|payload_state_key|custom_fields|value_cents/);
  });

  it("⭐ preenche o que a fonte já tem configurado", async () => {
    montar(fonte({ value_path: "pedido.total", value_unit: "centavos", payload_state_key: "pedido_json" }));
    expect(await screen.findByLabelText("Campo do valor do pedido")).toHaveValue("pedido.total");
    expect(screen.getByLabelText("Guardar os itens e os demais dados aninhados em")).toHaveValue("pedido_json");
  });

  it("⭐ salva só quando mudou, mandando caminho, unidade e chave do JSON", async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: fonte({ value_path: "value", value_unit: "reais", payload_state_key: "pedido_json" }) });
    const u = userEvent.setup();
    montar(fonte());
    const botao = await screen.findByTestId("valor-e-json-salvar");
    expect(botao).toBeDisabled();
    await u.type(screen.getByLabelText("Campo do valor do pedido"), "value");
    await u.type(screen.getByLabelText("Guardar os itens e os demais dados aninhados em"), "pedido_json");
    expect(botao).toBeEnabled();
    await u.click(botao);
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(apiClient.patch).toHaveBeenCalledWith("/api/v1/webhook-sources/src-1", {
      value_path: "value", value_unit: "reais", payload_state_key: "pedido_json",
    });
    await waitFor(() => expect(screen.getByTestId("valor-e-json-salvar")).toBeDisabled());
  });

  it("⭐ limpar os campos manda null nos três", async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: fonte() });
    const u = userEvent.setup();
    montar(fonte({ value_path: "value", value_unit: "reais", payload_state_key: "pedido_json" }));
    await u.clear(await screen.findByLabelText("Campo do valor do pedido"));
    await u.clear(screen.getByLabelText("Guardar os itens e os demais dados aninhados em"));
    await u.click(screen.getByTestId("valor-e-json-salvar"));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    expect(apiClient.patch).toHaveBeenCalledWith("/api/v1/webhook-sources/src-1", {
      value_path: null, value_unit: null, payload_state_key: null,
    });
  });

  it("⭐ caminho inválido mostra o motivo, bloqueia o salvar e não chama a API", async () => {
    const u = userEvent.setup();
    montar(fonte());
    // `[` é sintaxe especial do `userEvent.type`; colar entrega o texto como está.
    await u.click(await screen.findByLabelText("Campo do valor do pedido"));
    await u.paste("items[0].price");
    expect(await screen.findByTestId("valor-e-json-erro")).toHaveTextContent("nomes de campo separados por ponto");
    expect(screen.getByTestId("valor-e-json-salvar")).toBeDisabled();
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it("quem não pode gerir webhooks vê os campos desabilitados e sem botão de salvar", async () => {
    montar(fonte({ value_path: "value", value_unit: "reais" }), false);
    expect(await screen.findByLabelText("Campo do valor do pedido")).toBeDisabled();
    expect(screen.queryByTestId("valor-e-json-salvar")).toBeNull();
  });
});

describe("os avisos sobre a etapa padrão", () => {
  it("⭐ etapa de ganho e nenhum campo do valor: avisa que a venda chega sem valor", async () => {
    servirEtapa({ name: "Compras", is_won: true });
    montar(fonte());
    const aviso = await screen.findByTestId("aviso-ganho-sem-valor");
    expect(aviso).toHaveTextContent("«Compras»");
    expect(aviso).toHaveTextContent("fecha a venda");
  });

  it("etapa de ganho COM campo do valor salvo: sem aviso de ganho sem valor", async () => {
    servirEtapa({ name: "Compras", is_won: true });
    montar(fonte({ value_path: "value", value_unit: "reais" }));
    await screen.findByTestId("aviso-etapa-padrao");
    expect(screen.queryByTestId("aviso-ganho-sem-valor")).toBeNull();
  });

  it("etapa que não é de ganho: sem aviso de ganho", async () => {
    montar(fonte());
    await screen.findByTestId("aviso-etapa-padrao");
    expect(screen.queryByTestId("aviso-ganho-sem-valor")).toBeNull();
  });

  it("⭐ sempre explica que a etapa padrão vale para TODO envio da fonte, com o nome da etapa", async () => {
    servirEtapa({ name: "Em conversa", is_won: false });
    montar(fonte());
    const aviso = await screen.findByTestId("aviso-etapa-padrao");
    expect(aviso).toHaveTextContent("Todo envio desta fonte leva o card para a etapa");
    expect(aviso).toHaveTextContent("«Em conversa»");
    expect(aviso).toHaveTextContent("eventos do funil");
  });

  it("sem a etapa carregada: nenhum aviso inventado", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { stages: [] } });
    montar(fonte());
    await screen.findByTestId("valor-e-json-da-fonte");
    expect(screen.queryByTestId("aviso-etapa-padrao")).toBeNull();
    expect(screen.queryByTestId("aviso-ganho-sem-valor")).toBeNull();
  });
});
