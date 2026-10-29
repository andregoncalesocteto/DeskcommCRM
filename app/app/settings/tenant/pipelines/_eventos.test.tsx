/**
 * A seção "Para onde o card vai em cada evento" — o que ela OFERECE e o que ela ENVIA.
 *
 * Três decisões só existem na tela: oferecer como destino somente etapa que a API aceitaria (nunca a de perda),
 * mandar na edição apenas o que mudou, e mostrar o aviso/erro do servidor em português sem vazar texto de
 * infraestrutura. O texto da tela é de quem usa: nenhum nome de coluna do banco aparece.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/types";
import type { EventoDoFunil } from "@/hooks/pipelines/useEventosDoFunil";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import {
  EventosDoFunilSection,
  avisosDoEvento,
  corpoDosCampos,
  deltaDosCampos,
  problemaDosCampos,
  usoDoEvento,
} from "./_eventos";

// Polyfills que o Radix Select exige e o jsdom não tem.
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const PIPE = "11111111-1111-4111-8111-111111111111";
const ROTA = `/api/v1/pipelines/${PIPE}/events`;

const ETAPAS = [
  { id: "e1", name: "Carrinho", is_won: false, is_lost: false },
  { id: "e2", name: "Compras", is_won: true, is_lost: false },
  { id: "e3", name: "Cancelado", is_won: false, is_lost: true },
];

function evento(over: Partial<EventoDoFunil> = {}): EventoDoFunil {
  return {
    id: "ev-1", key: "purchase", label: "Compra", description: null, stage_id: "e2", respects_manual_move: false,
    state_key: "pedido", value_path: "value", value_unit: "reais", dedupe_path: "order_id", is_active: true,
    created_at: "2026-10-29T10:00:00Z", updated_at: "2026-10-29T10:00:00Z", ultimo_recebimento: null, recebidos_7_dias: 0,
    ...over,
  };
}

function servir(eventos: EventoDoFunil[]) {
  vi.mocked(apiClient.get).mockImplementation(async (path: string) =>
    path.endsWith("/events")
      ? { data: { eventos } }
      : { data: { etapas: ETAPAS, mapeamento: {} } },
  );
}

function montar(camposDaFicha: string[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EventosDoFunilSection pipelineId={PIPE} camposDaFicha={camposDaFicha} />
    </QueryClientProvider>,
  );
}

/** Abre o seletor e escolhe a opção pelo nome. */
async function escolher(user: ReturnType<typeof userEvent.setup>, testid: string, nome: string) {
  await user.click(screen.getByTestId(testid));
  await user.click(await screen.findByRole("option", { name: nome }));
}

beforeEach(() => {
  vi.clearAllMocks();
  servir([]);
});

describe("a lista", () => {
  it("funil sem eventos: explica o que acontece sem eles e oferece cadastrar", async () => {
    montar();
    expect(await screen.findByTestId("eventos-vazio")).toHaveTextContent("ainda não tem eventos cadastrados");
    expect(screen.getByRole("heading", { name: "Para onde o card vai em cada evento" })).toBeInTheDocument();
    expect(screen.getByTestId("novo-evento")).toBeInTheDocument();
  });

  it("mostra nome, chave e o destino em palavras, e marca o desativado", async () => {
    servir([evento(), evento({ id: "ev-2", key: "page_view", label: "Visita", stage_id: null, is_active: false })]);
    montar();
    expect(await screen.findByTestId("evento-purchase")).toHaveTextContent("Compra");
    expect(screen.getByTestId("evento-purchase")).toHaveTextContent("purchase");
    expect(screen.getByTestId("destino-purchase")).toHaveTextContent("O card vai para «Compras»");
    expect(screen.getByTestId("destino-page_view")).toHaveTextContent("Só registra, não move o card");
    expect(screen.getByTestId("desativado-page_view")).toBeInTheDocument();
    expect(screen.queryByTestId("desativado-purchase")).toBeNull();
  });

  it("falha ao carregar: diz isso, sem texto técnico", async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error("boom"));
    montar();
    expect(await screen.findByTestId("eventos-erro-leitura")).toHaveTextContent("Não foi possível carregar");
  });
});

describe("cadastrar", () => {
  it("⭐ oferece como destino SÓ etapa que a API aceitaria: a de perda não aparece", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    await user.click(screen.getByTestId("novo-etapa"));
    const nomes = within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(nomes).toEqual(["Não mover o card (só registrar)", "Carrinho", "Compras"]);
  });

  it("⭐ envia o cadastro completo, com null para o que ficou em branco e o par do valor junto", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { evento: evento(), avisos: [] } });
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Compra concluída");
    await user.type(screen.getByLabelText("Chave que o outro sistema envia"), "purchase");
    await escolher(user, "novo-etapa", "Compras");
    await user.click(screen.getByTestId("novo-avancado"));
    await user.type(screen.getByLabelText("Guardar o último conteúdo recebido em"), "pedido");
    await user.type(screen.getByLabelText("Campo do valor da venda"), "value");
    await user.type(screen.getByLabelText("Reconhecer o mesmo fato por"), "order_id");
    await user.click(screen.getByLabelText("Respeitar o que a equipe moveu à mão"));
    await user.click(screen.getByTestId("novo-salvar"));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith(ROTA, {
      key: "purchase", label: "Compra concluída", stage_id: "e2", respects_manual_move: false,
      state_key: "pedido", value_path: "value", value_unit: "reais", dedupe_path: "order_id",
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Evento cadastrado."));
  });

  it("sem opções avançadas e sem etapa: manda null, não string vazia, e o valor sem unidade", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { evento: evento(), avisos: [] } });
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Visita");
    await user.type(screen.getByLabelText("Chave que o outro sistema envia"), "page_view");
    await user.click(screen.getByTestId("novo-salvar"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(vi.mocked(apiClient.post).mock.calls[0]![1]).toEqual({
      key: "page_view", label: "Visita", stage_id: null, respects_manual_move: true,
      state_key: null, value_path: null, value_unit: null, dedupe_path: null,
    });
  });

  it("as opções avançadas começam escondidas num evento novo", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    expect(screen.queryByTestId("novo-opcoes")).toBeNull();
    await user.click(screen.getByTestId("novo-avancado"));
    expect(screen.getByTestId("novo-opcoes")).toBeInTheDocument();
  });

  it("⭐ chave fora do padrão: a tela diz o motivo e não deixa salvar", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Compra");
    await user.type(screen.getByLabelText("Chave que o outro sistema envia"), "Compra Concluída");
    expect(screen.getByTestId("novo-erro")).toHaveTextContent("A chave usa minúsculas");
    expect(screen.getByTestId("novo-salvar")).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it("nome em branco também bloqueia", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    expect(screen.getByTestId("novo-erro")).toHaveTextContent("Dê um nome ao evento.");
    expect(screen.getByTestId("novo-salvar")).toBeDisabled();
  });

  it("⭐ recusa de regra do servidor (422/409) aparece inteira, em português", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new ApiError(409, "state_conflict", undefined, "", "Já existe um evento com essa chave neste funil. («purchase»)"));
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Compra");
    await user.type(screen.getByLabelText("Chave que o outro sistema envia"), "purchase");
    await user.click(screen.getByTestId("novo-salvar"));
    expect(await screen.findByTestId("novo-erro")).toHaveTextContent("Já existe um evento com essa chave neste funil.");
  });

  it("erro de infraestrutura (500) não vaza: frase genérica", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new ApiError(500, "internal_error", undefined, "", "duplicate key value violates unique constraint"));
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Compra");
    await user.type(screen.getByLabelText("Chave que o outro sistema envia"), "purchase");
    await user.click(screen.getByTestId("novo-salvar"));
    const caixa = await screen.findByTestId("novo-erro");
    expect(caixa).toHaveTextContent("Não deu para salvar agora");
    expect(caixa).not.toHaveTextContent("unique constraint");
  });

  it("aviso do servidor (guardar em repetido) aparece depois de salvar", async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { evento: evento(), avisos: ["O evento «Revisão» já guarda o conteúdo em «pedido»: o último evento que chegar sobrescreve o outro."] },
    });
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("novo-evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Compra");
    await user.type(screen.getByLabelText("Chave que o outro sistema envia"), "purchase");
    await user.click(screen.getByTestId("novo-salvar"));
    expect(await screen.findByTestId("eventos-avisos")).toHaveTextContent("«Revisão» já guarda o conteúdo em «pedido»");
  });
});

describe("editar e desativar", () => {
  it("⭐ a edição manda SÓ o que mudou", async () => {
    servir([evento()]);
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { evento: evento({ label: "Compra concluída" }), avisos: [] } });
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("editar-purchase"));
    const nome = screen.getByLabelText("Nome do evento");
    await user.clear(nome);
    await user.type(nome, "Compra concluída");
    await user.click(screen.getByTestId("editar-purchase-salvar"));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    expect(apiClient.patch).toHaveBeenCalledWith(`${ROTA}/ev-1`, { label: "Compra concluída" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Evento atualizado."));
  });

  it("salvar sem mudar nada não chama a API e fecha o formulário", async () => {
    servir([evento()]);
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("editar-purchase"));
    await user.click(screen.getByTestId("editar-purchase-salvar"));
    expect(apiClient.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("form-editar-purchase")).toBeNull());
  });

  it("o formulário abre com o que está gravado, inclusive as opções avançadas já preenchidas", async () => {
    servir([evento()]);
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("editar-purchase"));
    expect(screen.getByLabelText("Nome do evento")).toHaveValue("Compra");
    expect(screen.getByLabelText("Chave que o outro sistema envia")).toHaveValue("purchase");
    expect(screen.getByLabelText("Guardar o último conteúdo recebido em")).toHaveValue("pedido");
    expect(screen.getByLabelText("Campo do valor da venda")).toHaveValue("value");
    expect(screen.getByLabelText("Reconhecer o mesmo fato por")).toHaveValue("order_id");
  });

  it("⭐ evento que já recebeu registros: a chave fica trancada e a tela explica", async () => {
    servir([evento({ ultimo_recebimento: "2026-10-29T12:00:00Z", recebidos_7_dias: 3 })]);
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("editar-purchase"));
    expect(screen.getByLabelText("Chave que o outro sistema envia")).toBeDisabled();
    expect(screen.getByText(/já recebeu registros, então a chave não pode mais mudar/)).toBeInTheDocument();
  });

  it("evento que nunca recebeu nada: a chave pode ser editada", async () => {
    servir([evento()]);
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("editar-purchase"));
    expect(screen.getByLabelText("Chave que o outro sistema envia")).toBeEnabled();
  });

  it("Desativar chama o DELETE; Ativar volta pelo PATCH", async () => {
    servir([evento(), evento({ id: "ev-2", key: "page_view", label: "Visita", is_active: false })]);
    vi.mocked(apiClient.delete).mockResolvedValue({ data: { evento: evento({ is_active: false }) } });
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { evento: evento(), avisos: [] } });
    const user = userEvent.setup();
    montar();
    await user.click(await screen.findByTestId("alternar-purchase"));
    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith(`${ROTA}/ev-1`));
    await user.click(screen.getByTestId("alternar-page_view"));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith(`${ROTA}/ev-2`, { is_active: true }));
  });
});

describe("a linguagem da tela", () => {
  it("⭐ nenhum nome de coluna do banco aparece, nem com as opções avançadas abertas", async () => {
    servir([evento()]);
    const user = userEvent.setup();
    const { container } = montar();
    await user.click(await screen.findByTestId("editar-purchase"));
    await user.click(screen.getByTestId("novo-evento")).catch(() => undefined);
    const texto = container.textContent ?? "";
    for (const jargao of ["state_key", "value_path", "value_unit", "dedupe_path", "respects_manual_move", "jsonb", "stage_id", "crm_"]) {
      expect(texto).not.toContain(jargao);
    }
  });
});

describe("funções puras", () => {
  const base = { label: "Compra", key: "purchase", stage_id: "e2", respects_manual_move: false, state_key: "", value_path: "", value_unit: "reais" as const, dedupe_path: "" };

  it("o valor sem caminho vai sem unidade; com caminho, o par inteiro", () => {
    expect(corpoDosCampos(base)).toMatchObject({ value_path: null, value_unit: null });
    expect(corpoDosCampos({ ...base, value_path: " value ", value_unit: "centavos" })).toMatchObject({ value_path: "value", value_unit: "centavos" });
  });

  it("deltaDosCampos devolve vazio quando nada mudou e só o campo mudado quando mudou", () => {
    const atual = evento({ state_key: null, value_path: null, value_unit: null, dedupe_path: null });
    const campos = { ...base, stage_id: "e2" };
    expect(deltaDosCampos(atual, campos)).toEqual({});
    expect(deltaDosCampos(atual, { ...campos, label: "Outro" })).toEqual({ label: "Outro" });
    expect(deltaDosCampos(atual, { ...campos, stage_id: "__sem_etapa__" })).toEqual({ stage_id: null });
  });

  it("problemaDosCampos: nome, chave e caminhos", () => {
    expect(problemaDosCampos(base)).toBeNull();
    expect(problemaDosCampos({ ...base, label: " " })).toContain("Dê um nome");
    expect(problemaDosCampos({ ...base, key: "1x" })).toContain("A chave usa");
    expect(problemaDosCampos({ ...base, value_path: "a..b" })).toContain("nomes de campo");
    expect(problemaDosCampos({ ...base, state_key: "meu-estado" })).toContain("Guardar em");
  });
});

describe("avisos que não bloqueiam", () => {
  it("⭐ etapa que fecha a venda sem campo do valor: avisa que a venda não vira conversão", async () => {
    servir([evento({ value_path: null, value_unit: null })]);
    montar();
    expect(await screen.findByTestId("aviso-purchase")).toHaveTextContent(
      "Esta etapa fecha a venda, mas o evento não define o valor, então a venda não será enviada como conversão.",
    );
  });

  it("com o campo do valor definido, não avisa", async () => {
    servir([evento()]);
    montar();
    await screen.findByTestId("evento-purchase");
    expect(screen.queryByTestId("aviso-purchase")).toBeNull();
  });

  it("⭐ etapa de destino arquivada (some da lista de etapas): avisa que o evento só registra", async () => {
    servir([evento({ stage_id: "etapa-arquivada" })]);
    montar();
    expect(await screen.findByTestId("aviso-purchase")).toHaveTextContent("A etapa de destino foi arquivada");
    expect(screen.getByTestId("destino-purchase")).toHaveTextContent("uma etapa que não está mais disponível");
  });

  it("⭐ dois eventos ativos guardando no mesmo lugar: os dois avisam, citando o outro", async () => {
    servir([
      evento({ id: "a", key: "compra", label: "Compra", stage_id: null, state_key: "pedido" }),
      evento({ id: "b", key: "revisao", label: "Revisão", stage_id: null, state_key: "pedido" }),
    ]);
    montar();
    expect(await screen.findByTestId("evento-compra")).toBeInTheDocument();
    expect(within(screen.getByTestId("evento-compra")).getByTestId("aviso-compra")).toHaveTextContent("«Revisão» guarda o conteúdo no mesmo lugar");
    expect(within(screen.getByTestId("evento-revisao")).getByTestId("aviso-revisao")).toHaveTextContent("«Compra» guarda o conteúdo no mesmo lugar");
  });

  it("evento desativado não gera aviso, nem faz o outro avisar", async () => {
    servir([
      evento({ id: "a", key: "compra", label: "Compra", stage_id: null, state_key: "pedido" }),
      evento({ id: "b", key: "velho", label: "Velho", stage_id: null, state_key: "pedido", is_active: false }),
    ]);
    montar();
    await screen.findByTestId("evento-compra");
    expect(screen.queryByTestId("aviso-compra")).toBeNull();
    expect(screen.queryByTestId("aviso-velho")).toBeNull();
  });
});

describe("bloqueio: guardar em campo da ficha", () => {
  it("⭐ 'guardar em' igual à chave de um campo da ficha: a tela explica e não deixa salvar", async () => {
    const user = userEvent.setup();
    montar(["forma_pagamento"]);
    await user.click(await screen.findByTestId("novo-evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Compra");
    await user.type(screen.getByLabelText("Chave que o outro sistema envia"), "purchase");
    await user.click(screen.getByTestId("novo-avancado"));
    await user.type(screen.getByLabelText("Guardar o último conteúdo recebido em"), "forma_pagamento");
    expect(screen.getByTestId("novo-erro")).toHaveTextContent("«forma_pagamento» já é um campo da ficha deste funil");
    expect(screen.getByTestId("novo-salvar")).toBeDisabled();
  });

  it("um nome que não é campo da ficha é aceito", async () => {
    const user = userEvent.setup();
    montar(["forma_pagamento"]);
    await user.click(await screen.findByTestId("novo-evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Compra");
    await user.type(screen.getByLabelText("Chave que o outro sistema envia"), "purchase");
    await user.click(screen.getByTestId("novo-avancado"));
    await user.type(screen.getByLabelText("Guardar o último conteúdo recebido em"), "pedido");
    expect(screen.queryByTestId("novo-erro")).toBeNull();
    expect(screen.getByTestId("novo-salvar")).toBeEnabled();
  });
});

describe("sinais de uso", () => {
  it("⭐ sem nenhum registro: 'Ainda não recebeu nada.'", async () => {
    servir([evento()]);
    montar();
    expect(await screen.findByTestId("uso-purchase")).toHaveTextContent("Ainda não recebeu nada.");
  });

  it("⭐ com registros: a data da última vez e a contagem dos últimos 7 dias", async () => {
    servir([evento({ ultimo_recebimento: "2026-10-29T15:30:00Z", recebidos_7_dias: 3 })]);
    montar();
    const uso = await screen.findByTestId("uso-purchase");
    expect(uso).toHaveTextContent("Visto pela última vez em");
    expect(uso).toHaveTextContent("3 nos últimos 7 dias");
    expect(uso).not.toHaveTextContent("Ainda não recebeu nada");
  });

  it("o idioma da data segue quem lê: a mesma hora sai diferente em português e em espanhol", () => {
    const e = evento({ ultimo_recebimento: "2026-03-03T15:30:00Z", recebidos_7_dias: 1 });
    expect(usoDoEvento(e, (x) => x, "pt-BR")).not.toBe(usoDoEvento(e, (x) => x, "en-US"));
  });

  it("recebeu há mais de 7 dias: mostra a data e zero na semana, não 'nada'", () => {
    const texto = usoDoEvento(evento({ ultimo_recebimento: "2026-09-01T10:00:00Z", recebidos_7_dias: 0 }), (x) => x, "es");
    expect(texto).toContain("Visto pela última vez em");
    expect(texto).toContain("0 nos últimos 7 dias");
  });
});

describe("avisosDoEvento (puro)", () => {
  const etapas = ETAPAS;
  it("evento desativado nunca avisa", () => {
    expect(avisosDoEvento(evento({ is_active: false, value_path: null, value_unit: null }), [], etapas)).toEqual([]);
  });
  it("etapa comum sem valor não avisa de venda", () => {
    expect(avisosDoEvento(evento({ stage_id: "e1", value_path: null, value_unit: null }), [], etapas)).toEqual([]);
  });
  it("evento sem etapa de destino não avisa de etapa arquivada", () => {
    expect(avisosDoEvento(evento({ stage_id: null }), [], etapas)).toEqual([]);
  });
});

