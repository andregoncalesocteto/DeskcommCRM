import { describe, expect, it } from "vitest";

import { valorDoEnvio } from "./valor-do-envio";

const reais = { value_path: "value", value_unit: "reais" };

describe("valorDoEnvio", () => {
  it("sem configuração (nenhum dos dois, ou só um): não faz nada", () => {
    expect(valorDoEnvio({ value: 10 }, {})).toEqual({ tipo: "sem_configuracao" });
    expect(valorDoEnvio({ value: 10 }, { value_path: "value", value_unit: null })).toEqual({ tipo: "sem_configuracao" });
    expect(valorDoEnvio({ value: 10 }, { value_path: null, value_unit: "reais" })).toEqual({ tipo: "sem_configuracao" });
    expect(valorDoEnvio({ value: 10 }, { value_path: "value", value_unit: "dólares" })).toEqual({ tipo: "sem_configuracao" });
  });

  it("reais viram centavos sem erro de ponto flutuante", () => {
    expect(valorDoEnvio({ value: 73.9 }, reais)).toEqual({ tipo: "valor", centavos: 7390 });
    expect(valorDoEnvio({ value: "1.005" }, reais)).toEqual({ tipo: "valor", centavos: 101 });
    expect(valorDoEnvio({ value: 0 }, reais)).toEqual({ tipo: "valor", centavos: 0 });
  });

  it("centavos ficam como estão, e só inteiros servem", () => {
    const c = { value_path: "pedido.total", value_unit: "centavos" };
    expect(valorDoEnvio({ pedido: { total: 7390 } }, c)).toEqual({ tipo: "valor", centavos: 7390 });
    expect(valorDoEnvio({ pedido: { total: "12.5" } }, c)).toMatchObject({ tipo: "invalido", motivo: "centavos_nao_inteiro" });
  });

  it("campo ausente, nulo ou vazio é 'ausente' (e o caminho volta para o log)", () => {
    expect(valorDoEnvio({}, reais)).toEqual({ tipo: "ausente", caminho: "value" });
    expect(valorDoEnvio({ value: null }, reais)).toEqual({ tipo: "ausente", caminho: "value" });
    expect(valorDoEnvio({ value: "" }, reais)).toEqual({ tipo: "ausente", caminho: "value" });
    expect(valorDoEnvio({ pedido: "x" }, { value_path: "pedido.total", value_unit: "reais" })).toEqual({ tipo: "ausente", caminho: "pedido.total" });
  });

  it("valor ilegível é 'inválido', com o motivo", () => {
    expect(valorDoEnvio({ value: "abc" }, reais)).toMatchObject({ tipo: "invalido", motivo: "nao_numerico" });
    expect(valorDoEnvio({ value: -1 }, reais)).toMatchObject({ tipo: "invalido", motivo: "negativo" });
    expect(valorDoEnvio({ value: Infinity }, reais)).toMatchObject({ tipo: "invalido", motivo: "nao_finito" });
  });

  it("caminho que tenta alcançar o protótipo não acha nada", () => {
    expect(valorDoEnvio({}, { value_path: "__proto__.x", value_unit: "reais" })).toMatchObject({ tipo: "ausente" });
  });
});
