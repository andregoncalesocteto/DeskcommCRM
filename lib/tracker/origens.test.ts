import { describe, expect, it } from "vitest";

import { MAX_ORIGENS_POR_CHAVE, normalizarOrigem, normalizarOrigens, novaChaveSchema } from "./origens";

describe("normalizarOrigem", () => {
  it.each([
    ["https://loja.exemplo", "https://loja.exemplo"],
    ["https://loja.exemplo/", "https://loja.exemplo"],
    ["  HTTPS://Loja.Exemplo  ", "https://loja.exemplo"],
    ["https://loja.exemplo:8443", "https://loja.exemplo:8443"],
    ["https://loja.exemplo:443", "https://loja.exemplo"],
    ["http://localhost:3000", "http://localhost:3000"],
    ["http://127.0.0.1:5173", "http://127.0.0.1:5173"],
  ])("aceita %s", (entrada, esperado) => {
    expect(normalizarOrigem(entrada)).toBe(esperado);
  });

  it.each([
    "http://loja.exemplo", // http fora de localhost
    "http://localhost.evil.com", // parece localhost, não é
    "https://loja.exemplo/cardapio", // caminho
    "https://loja.exemplo/?a=1", // consulta
    "https://loja.exemplo/#x", // fragmento
    "https://user:senha@loja.exemplo", // credenciais
    "https://*.exemplo.com", // curinga
    "*",
    "loja.exemplo", // sem esquema
    "ftp://loja.exemplo",
    "javascript:alert(1)",
    "",
  ])("recusa %j", (entrada) => {
    expect(normalizarOrigem(entrada)).toBeNull();
  });
});

describe("normalizarOrigens", () => {
  it("tira repetidas depois de normalizar (a barra final não cria uma segunda origem)", () => {
    expect(normalizarOrigens(["https://a.exemplo", "https://a.exemplo/", "https://b.exemplo"])).toEqual({
      ok: true,
      origens: ["https://a.exemplo", "https://b.exemplo"],
    });
  });

  it("aponta a primeira inválida, com o texto original", () => {
    expect(normalizarOrigens(["https://a.exemplo", "http://b.exemplo"])).toEqual({
      ok: false,
      invalida: "http://b.exemplo",
    });
  });
});

describe("novaChaveSchema", () => {
  const base = { label: "Site", allowed_origins: ["https://a.exemplo"] };

  it("aceita o corpo mínimo e apara o rótulo", () => {
    expect(novaChaveSchema.parse({ ...base, label: "  Site  " }).label).toBe("Site");
  });

  it("recusa organization_id, pipeline_id e qualquer campo desconhecido (a organização nunca vem do corpo)", () => {
    expect(novaChaveSchema.safeParse({ ...base, organization_id: "x" }).success).toBe(false);
    expect(novaChaveSchema.safeParse({ ...base, pipeline_id: "x" }).success).toBe(false);
    expect(novaChaveSchema.safeParse({ ...base, public_key: "pk_x" }).success).toBe(false);
  });

  it("recusa rótulo vazio ou grande, e lista de origens vazia ou acima do teto", () => {
    expect(novaChaveSchema.safeParse({ ...base, label: " " }).success).toBe(false);
    expect(novaChaveSchema.safeParse({ ...base, label: "x".repeat(81) }).success).toBe(false);
    expect(novaChaveSchema.safeParse({ ...base, allowed_origins: [] }).success).toBe(false);
    const muitas = Array.from({ length: MAX_ORIGENS_POR_CHAVE + 1 }, (_, i) => `https://s${i}.exemplo`);
    expect(novaChaveSchema.safeParse({ ...base, allowed_origins: muitas }).success).toBe(false);
  });
});
