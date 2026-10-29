import { describe, expect, it } from "vitest";

import { resolverCaminho, valorEmCentavos } from "@/lib/leads/eventos-do-funil/caminho-e-valor";

/**
 * Duas funções puras do cadastro de eventos do funil: ler um campo do JSON do evento e converter o valor
 * da venda em centavos. A régua é compartilhada pela operação do MCP e pelo webhook de entrada.
 */

describe("resolverCaminho: só nome de campo, com ponto", () => {
  const dados = {
    value: 73.9,
    order_id: "PED-1",
    pedido: { total: 68.9, entrega: { taxa: 5 }, nulo: null },
    items: [{ item_id: "pz-1" }],
  };

  it.each([
    ["campo simples", "value", 73.9],
    ["outro campo simples", "order_id", "PED-1"],
    ["aninhado", "pedido.total", 68.9],
    ["aninhado em dois níveis", "pedido.entrega.taxa", 5],
    ["campo que existe e vale null", "pedido.nulo", null],
  ])("acha %s", (_nome, caminho, esperado) => {
    expect(resolverCaminho(dados, caminho)).toEqual(esperado);
  });

  it.each([
    ["campo ausente", "nao_existe"],
    ["ausente no meio do caminho", "pedido.nao_existe.taxa"],
    ["passar por cima de um valor simples", "order_id.tamanho"],
    ["índice de lista", "items[0].item_id"],
    ["índice numérico", "items.0.item_id"],
    ["atravessar uma lista", "items.item_id"],
    ["caminho vazio", ""],
    ["ponto duplo", "pedido..total"],
    ["ponto no começo", ".value"],
    ["ponto no fim", "value."],
    ["expressão", "value + 1"],
    ["caractere curinga", "pedido.*"],
  ])("devolve undefined para %s", (_nome, caminho) => {
    expect(resolverCaminho(dados, caminho)).toBeUndefined();
  });

  it("não alcança o protótipo do objeto", () => {
    expect(resolverCaminho({}, "__proto__")).toBeUndefined();
    expect(resolverCaminho({}, "constructor")).toBeUndefined();
    expect(resolverCaminho({ a: {} }, "a.constructor.name")).toBeUndefined();
    expect(resolverCaminho({}, "toString")).toBeUndefined();
  });

  it("dado que não é objeto devolve undefined, sem lançar", () => {
    for (const d of [null, undefined, 5, "texto", true, []]) expect(resolverCaminho(d, "value")).toBeUndefined();
  });
});

describe("valorEmCentavos: reais", () => {
  it.each([
    [73.9, 7390],
    [68.9, 6890],
    [0, 0],
    [0.01, 1],
    [59, 5900],
    ["73.90", 7390],
    ["  12  ", 1200],
    ["0.5", 50],
  ])("%s reais vale %s centavos", (valor, centavos) => {
    expect(valorEmCentavos(valor, "reais")).toEqual({ ok: true, centavos });
  });

  it("arredonda a terceira casa para cima na metade, sem o erro do ponto flutuante", () => {
    // 1.005 * 100 === 100.49999999999999 em JavaScript; a conta decimal dá 101.
    expect(1.005 * 100).toBeLessThan(100.5);
    expect(valorEmCentavos(1.005, "reais")).toEqual({ ok: true, centavos: 101 });
    expect(valorEmCentavos("1.004", "reais")).toEqual({ ok: true, centavos: 100 });
    expect(valorEmCentavos("2.675", "reais")).toEqual({ ok: true, centavos: 268 });
    expect(valorEmCentavos("0.999", "reais")).toEqual({ ok: true, centavos: 100 });
  });

  it("aceita valores altos: não há teto máximo", () => {
    expect(valorEmCentavos(5_000_000, "reais")).toEqual({ ok: true, centavos: 500_000_000 });
    expect(valorEmCentavos("99999999999", "reais")).toEqual({ ok: true, centavos: 9_999_999_999_900 });
  });

  it("só o inteiro seguro do JavaScript limita", () => {
    expect(valorEmCentavos("90071992547410", "reais")).toMatchObject({ ok: false, motivo: "fora_do_alcance" });
  });
});

describe("valorEmCentavos: centavos", () => {
  it.each([
    [6890, 6890],
    [0, 0],
    ["7390", 7390],
    ["7390.00", 7390],
    [7390.0, 7390],
  ])("%s centavos vale %s", (valor, centavos) => {
    expect(valorEmCentavos(valor, "centavos")).toEqual({ ok: true, centavos });
  });

  it("recusa fração de centavo", () => {
    expect(valorEmCentavos(73.9, "centavos")).toEqual({ ok: false, motivo: "centavos_nao_inteiro" });
    expect(valorEmCentavos("7390.5", "centavos")).toEqual({ ok: false, motivo: "centavos_nao_inteiro" });
  });
});

describe("valorEmCentavos: o que é recusado, nas duas unidades", () => {
  it.each(["reais", "centavos"] as const)("em %s", (unidade) => {
    expect(valorEmCentavos(-5, unidade)).toEqual({ ok: false, motivo: "negativo" });
    expect(valorEmCentavos("-0.01", unidade)).toEqual({ ok: false, motivo: "negativo" });
    expect(valorEmCentavos(Number.NaN, unidade)).toEqual({ ok: false, motivo: "nao_finito" });
    expect(valorEmCentavos(Number.POSITIVE_INFINITY, unidade)).toEqual({ ok: false, motivo: "nao_finito" });
    expect(valorEmCentavos(Number.NEGATIVE_INFINITY, unidade)).toEqual({ ok: false, motivo: "nao_finito" });
    for (const ruim of ["", "abc", "12,50", "1e3", "R$ 10", "10 reais", "1.2.3", " ", null, undefined, true, {}, [], [5]]) {
      expect(valorEmCentavos(ruim, unidade)).toEqual({ ok: false, motivo: "nao_numerico" });
    }
  });

  it("zero negativo não é negativo: é zero", () => {
    expect(valorEmCentavos(-0, "reais")).toEqual({ ok: true, centavos: 0 });
    expect(valorEmCentavos("-0", "reais")).toEqual({ ok: true, centavos: 0 });
  });
});
