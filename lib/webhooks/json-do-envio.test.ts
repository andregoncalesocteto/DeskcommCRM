import { describe, expect, it } from "vitest";

import { jsonDoEnvio, jsonMudou, LIMITE_DO_JSON_EM_BYTES } from "./json-do-envio";

describe("jsonDoEnvio", () => {
  const itens = [{ item_id: "p1", quantity: 2 }];

  it("sem chave configurada o aninhado continua sendo descartado (como sempre foi)", () => {
    expect(jsonDoEnvio({ itens }, null)).toEqual({ tipo: "sem_configuracao" });
    expect(jsonDoEnvio({ itens }, undefined)).toEqual({ tipo: "sem_configuracao" });
    expect(jsonDoEnvio({ itens }, "")).toEqual({ tipo: "sem_configuracao" });
  });

  it("⭐ guarda objetos e listas de primeiro nível, juntos, e deixa os escalares de fora", () => {
    expect(jsonDoEnvio({ nome: "Maria", valor: 10, itens, cliente: { cidade: "Rio Preto" } }, "pedido_json")).toEqual({
      tipo: "conteudo",
      chave: "pedido_json",
      valor: { itens, cliente: { cidade: "Rio Preto" } },
    });
  });

  it("os campos reservados external_id e stage nunca entram", () => {
    expect(jsonDoEnvio({ external_id: { x: 1 }, stage: ["a"], itens }, "j")).toMatchObject({ tipo: "conteudo", valor: { itens } });
  });

  it("corpo só com escalares: 'vazio' (nada a guardar)", () => {
    expect(jsonDoEnvio({ nome: "Maria", valor: 10, nada: null }, "j")).toEqual({ tipo: "vazio" });
  });

  it("⭐ acima do limite não é guardado, e os bytes vão para o log", () => {
    const grande = { itens: [{ texto: "x".repeat(LIMITE_DO_JSON_EM_BYTES) }] };
    const r = jsonDoEnvio(grande, "j");
    expect(r.tipo).toBe("grande");
    if (r.tipo === "grande") expect(r.bytes).toBeGreaterThan(LIMITE_DO_JSON_EM_BYTES);
  });

  it("o limite conta BYTES (acentos pesam 2), não caracteres", () => {
    const quase = { itens: ["é".repeat(LIMITE_DO_JSON_EM_BYTES / 2)] };
    expect(jsonDoEnvio(quase, "j").tipo).toBe("grande");
  });
});

describe("jsonMudou", () => {
  it("compara o JSON, não o texto do objeto", () => {
    expect(jsonMudou({ itens: [1] }, { itens: [1] })).toBe(false);
    expect(jsonMudou({ itens: [1] }, { itens: [1, 2] })).toBe(true);
    expect(jsonMudou(undefined, { itens: [] })).toBe(true);
    expect(jsonMudou(null, { itens: [] })).toBe(true);
  });
});
