import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lerResultado, ErpPdvError, type ResultadoDeFerramenta } from "./resposta";
import {
  ListaDeLojasSchema,
  ObterClienteSchema,
  ResultadoBuscaSchema,
} from "./tipos";

const DIR = join(process.cwd(), "tests/fixtures/pdv-erp");
const fixture = (nome: string): ResultadoDeFerramenta =>
  JSON.parse(readFileSync(join(DIR, `${nome}.json`), "utf-8"));

function erroDe(nome: string): ErpPdvError {
  try {
    lerResultado(fixture(nome), ListaDeLojasSchema);
  } catch (e) {
    expect(e).toBeInstanceOf(ErpPdvError);
    return e as ErpPdvError;
  }
  throw new Error("não lançou");
}

describe("fixtures do ERP: sucesso", () => {
  it("listar-lojas: cinco ativas", () => {
    const r = lerResultado(fixture("listar-lojas"), ListaDeLojasSchema);
    expect(r.lojas.map((l) => l.sigla)).toEqual(["CAS", "RPA", "RPV", "RPR", "RPI"]);
    expect(r.lojas.every((l) => l.ativa)).toBe(true);
  });

  it("listar-lojas-com-inativas: inclui a inativa", () => {
    const r = lerResultado(fixture("listar-lojas-com-inativas"), ListaDeLojasSchema);
    expect(r.lojas).toHaveLength(6);
    expect(r.lojas.find((l) => l.sigla === "TST")?.ativa).toBe(false);
  });

  it("buscar-por-telefone: um cliente", () => {
    const r = lerResultado(fixture("buscar-por-telefone"), ResultadoBuscaSchema);
    expect(r.clientes.map((c) => c.id)).toEqual(["c-0001"]);
    expect(r.truncado).toBe(false);
  });

  it("buscar-por-nome-3-resultados: três, sem truncar", () => {
    const r = lerResultado(fixture("buscar-por-nome-3-resultados"), ResultadoBuscaSchema);
    expect(r.clientes.map((c) => c.id)).toEqual(["c-0002", "c-0001", "c-0003"]);
    expect(r.total_encontrado).toBe(3);
    expect(r.truncado).toBe(false);
  });

  it("buscar-truncada: total maior que a lista; endereço pode ser null", () => {
    const r = lerResultado(fixture("buscar-truncada"), ResultadoBuscaSchema);
    expect(r.truncado).toBe(true);
    expect(r.total_encontrado).toBeGreaterThan(r.clientes.length);
    expect(r.clientes[1]?.endereco_principal).toBeNull();
  });

  it("buscar-vazia: não é erro", () => {
    const r = lerResultado(fixture("buscar-vazia"), ResultadoBuscaSchema);
    expect(r).toEqual({ clientes: [], total_encontrado: 0, truncado: false });
  });

  it("obter-cliente-completo: três endereços, um principal, um sem loja", () => {
    const { cliente } = lerResultado(fixture("obter-cliente-completo"), ObterClienteSchema);
    expect(cliente.cpf).toBe("52998224725");
    expect(cliente.data_nascimento).toBe("1988-03-14");
    expect(cliente.enderecos).toHaveLength(3);
    expect(cliente.enderecos.filter((e) => e.principal)).toHaveLength(1);
    expect(cliente.enderecos.map((e) => e.loja_entrega?.sigla ?? null)).toEqual(["CAS", "CAS", null]);
  });

  it("obter-cliente-sem-endereco: lista vazia", () => {
    const { cliente } = lerResultado(fixture("obter-cliente-sem-endereco"), ObterClienteSchema);
    expect(cliente.enderecos).toEqual([]);
  });

  it("obter-cliente-sem-campos-sensiveis: cpf e nascimento AUSENTES, não null", () => {
    const { cliente } = lerResultado(fixture("obter-cliente-sem-campos-sensiveis"), ObterClienteSchema);
    expect("cpf" in cliente).toBe(false);
    expect("data_nascimento" in cliente).toBe(false);
    expect(cliente.cpf).toBeUndefined();
    expect(cliente.data_nascimento).toBeUndefined();
  });
});

describe("fixtures do ERP: erro", () => {
  it.each([
    ["erro-termo-invalido", "termo_invalido"],
    ["erro-nao-encontrado", "nao_encontrado"],
    ["erro-nao-autorizado", "nao_autorizado"],
    ["erro-erp-indisponivel", "erp_indisponivel"],
    ["erro-tempo-esgotado", "tempo_esgotado"],
  ])("%s vira ErpPdvError %s", (nome, codigo) => {
    const e = erroDe(nome);
    expect(e.codigo).toBe(codigo);
    expect(e.message.length).toBeGreaterThan(0);
  });

  it("termo_invalido carrega detalhes", () => {
    expect(erroDe("erro-termo-invalido").detalhes).toEqual({ campo: "termo" });
  });

  it("erro-texto-nao-json vira resposta_invalida com o texto", () => {
    const e = erroDe("erro-texto-nao-json");
    expect(e.codigo).toBe("resposta_invalida");
    expect(e.message).toBe("Internal Server Error");
  });
});

describe("lerResultado: bordas", () => {
  it("código desconhecido no JSON de erro vira resposta_invalida", () => {
    const texto = JSON.stringify({ codigo: "outro", mensagem: "x" });
    expect(() =>
      lerResultado({ isError: true, content: [{ type: "text", text: texto }] }, ListaDeLojasSchema),
    ).toThrow(expect.objectContaining({ codigo: "resposta_invalida", message: texto }));
  });

  it("sucesso sem structuredContent ou com formato errado vira resposta_invalida", () => {
    for (const r of [{}, { structuredContent: { lojas: "x" } }]) {
      expect(() => lerResultado(r, ListaDeLojasSchema)).toThrow(
        expect.objectContaining({ codigo: "resposta_invalida" }),
      );
    }
  });

  it("todo arquivo da pasta de fixtures é coberto por um teste", () => {
    expect(readdirSync(DIR)).toHaveLength(15);
  });
});
