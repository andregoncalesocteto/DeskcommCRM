import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// A chave de cifragem da instalação tem de existir ANTES de `lib/env.ts` carregar.
vi.hoisted(() => {
  process.env.AI_CRED_AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
});

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { cifrarChaveMcpExterno } from "@/lib/mcp/servidor-externo/segredo";
import {
  TEMPO_LIMITE_LEITURA_MS,
  buscarCliente,
  listarLojas,
  obterCliente,
  type OpcoesDoErp,
} from "./cliente";
import { ErpPdvError, type ResultadoDeFerramenta } from "./resposta";

const ORG = "bcc12320-f555-4fef-8d90-38a0ac5950e0";
const ENDPOINT = "https://erp.exemplo.test/mcp";
const CHAVE = "chave-secreta-do-erp-123";
const DIR = join(process.cwd(), "tests/fixtures/pdv-erp");
const fixture = (nome: string): ResultadoDeFerramenta =>
  JSON.parse(readFileSync(join(DIR, `${nome}.json`), "utf-8"));

function banco(settings: unknown, comChave = true) {
  const ids: unknown[] = [];
  const cifrado = comChave ? cifrarChaveMcpExterno(CHAVE) : {};
  const cadeia: Record<string, unknown> = {
    select: () => cadeia,
    eq: (coluna: string, valor: unknown) => (ids.push([coluna, valor]), cadeia),
    maybeSingle: async () => ({ data: { settings, ...cifrado }, error: null }),
  };
  return { ids, cliente: { from: () => cadeia } as never };
}

/** Um servidor MCP Streamable HTTP em memória: responde ao handshake e à ferramenta. */
function erpFalso(responder: (nome: string, args: Record<string, unknown>) => ResultadoDeFerramenta | Error) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown>; autorizacao: string | null }> = [];
  let fetches = 0;
  const fetch = (async (input: unknown, init?: RequestInit) => {
    fetches += 1;
    const metodo = init?.method ?? "GET";
    if (metodo === "DELETE") return new Response(null, { status: 200 });
    if (metodo !== "POST") return new Response(null, { status: 405 });
    const msg = JSON.parse(String(init?.body));
    if (msg.id === undefined) return new Response(null, { status: 202 });
    const json = (result: unknown) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }), {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "s1" },
      });
    if (msg.method === "initialize") {
      return json({
        protocolVersion: msg.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "erp-falso", version: "1" },
      });
    }
    if (msg.method === "tools/call") {
      const headers = new Headers(init?.headers as HeadersInit);
      const saida = responder(msg.params.name, msg.params.arguments);
      chamadas.push({ nome: msg.params.name, args: msg.params.arguments, autorizacao: headers.get("authorization") });
      if (saida instanceof Error) throw saida;
      return json(saida);
    }
    return json({});
  }) as unknown as NonNullable<OpcoesDoErp["fetch"]>;
  return { fetch, chamadas, fetches: () => fetches };
}

function comErp(saida: ResultadoDeFerramenta | Error) {
  const erp = erpFalso(() => saida);
  const { cliente } = banco({ mcp_externo: { endpoint: ENDPOINT } });
  return { erp, opcoes: { supabase: cliente, fetch: erp.fetch } satisfies OpcoesDoErp };
}

describe("tempo limite", () => {
  it("leituras: 15000 ms", () => {
    expect(TEMPO_LIMITE_LEITURA_MS).toBe(15000);
  });
});

describe("sem servidor registrado", () => {
  it("erp_nao_configurado e nenhuma rede", async () => {
    const erp = erpFalso(() => fixture("listar-lojas"));
    const { cliente } = banco({ proposals: { enabled: true } }, false);
    const err = await listarLojas(ORG, { supabase: cliente, fetch: erp.fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(ErpPdvError);
    expect(err.codigo).toBe("erp_nao_configurado");
    expect(erp.fetches()).toBe(0);
  });

  it("endereço sem chave também é não configurado", async () => {
    const erp = erpFalso(() => fixture("listar-lojas"));
    const { cliente } = banco({ mcp_externo: { endpoint: ENDPOINT } }, false);
    const err = await listarLojas(ORG, { supabase: cliente, fetch: erp.fetch }).catch((e) => e);
    expect(err.codigo).toBe("erp_nao_configurado");
    expect(erp.fetches()).toBe(0);
  });
});

describe("leituras", () => {
  it("listarLojas chama listar_lojas, manda a chave no cabeçalho e lê a resposta", async () => {
    const { erp, opcoes } = comErp(fixture("listar-lojas"));
    const lojas = await listarLojas(ORG, opcoes);
    expect(lojas.map((l) => l.sigla)).toEqual(["CAS", "RPA", "RPV", "RPR", "RPI"]);
    expect(erp.chamadas).toHaveLength(1);
    expect(erp.chamadas[0]).toMatchObject({ nome: "listar_lojas", args: { apenas_ativas: true } });
    expect(erp.chamadas[0]!.autorizacao).toBe(`Bearer ${CHAVE}`);
  });

  it("a leitura do cadastro é pela organização informada", async () => {
    const erp = erpFalso(() => fixture("listar-lojas"));
    const b = banco({ mcp_externo: { endpoint: ENDPOINT } });
    await listarLojas(ORG, { supabase: b.cliente, fetch: erp.fetch });
    expect(b.ids).toEqual([["id", ORG]]);
  });

  it("buscarCliente passa modo, termo e limite", async () => {
    const { erp, opcoes } = comErp(fixture("buscar-por-telefone"));
    const r = await buscarCliente(ORG, "telefone", "(19) 99876-5432", 6, opcoes);
    expect(r.clientes.length).toBeGreaterThan(0);
    expect(erp.chamadas[0]).toMatchObject({
      nome: "buscar_cliente",
      args: { modo: "telefone", termo: "(19) 99876-5432", limite: 6 },
    });
  });

  it("buscarCliente sem limite não o envia", async () => {
    const { erp, opcoes } = comErp(fixture("buscar-vazia"));
    await buscarCliente(ORG, "nome", "ana", undefined, opcoes);
    expect(erp.chamadas[0]!.args).toEqual({ modo: "nome", termo: "ana" });
  });

  it("obterCliente manda campos_sensiveis false por padrão", async () => {
    const { erp, opcoes } = comErp(fixture("obter-cliente-sem-campos-sensiveis"));
    const c = await obterCliente(ORG, "c-0001", opcoes);
    expect(c.id).toBe("c-0001");
    expect(erp.chamadas[0]).toMatchObject({
      nome: "obter_cliente",
      args: { cliente_id: "c-0001", campos_sensiveis: false },
    });
  });

  it("obterCliente com camposSensiveis manda true", async () => {
    const { erp, opcoes } = comErp(fixture("obter-cliente-completo"));
    await obterCliente(ORG, "c-0001", { ...opcoes, camposSensiveis: true });
    expect(erp.chamadas[0]!.args).toEqual({ cliente_id: "c-0001", campos_sensiveis: true });
  });
});

describe("erros", () => {
  it.each([
    ["erro-termo-invalido", "termo_invalido"],
    ["erro-nao-encontrado", "nao_encontrado"],
    ["erro-nao-autorizado", "nao_autorizado"],
    ["erro-erp-indisponivel", "erp_indisponivel"],
    ["erro-tempo-esgotado", "tempo_esgotado"],
    ["erro-texto-nao-json", "resposta_invalida"],
  ])("%s vira %s", async (nome, codigo) => {
    const { opcoes } = comErp(fixture(nome));
    const err = await buscarCliente(ORG, "nome", "x", undefined, opcoes).catch((e) => e);
    expect(err).toBeInstanceOf(ErpPdvError);
    expect(err.codigo).toBe(codigo);
  });

  it("formato inesperado em sucesso vira resposta_invalida", async () => {
    const { opcoes } = comErp({ content: [{ type: "text", text: "ok" }], structuredContent: { x: 1 } });
    const err = await listarLojas(ORG, opcoes).catch((e) => e);
    expect(err.codigo).toBe("resposta_invalida");
  });

  it("falha de rede vira erp_indisponivel, só com o host", async () => {
    const { opcoes } = comErp(new TypeError(`fetch failed ${ENDPOINT} ${CHAVE}`));
    const err = await listarLojas(ORG, opcoes).catch((e) => e);
    expect(err.codigo).toBe("erp_indisponivel");
    expect(JSON.stringify([err.message, err.detalhes])).toBe(
      JSON.stringify([err.message, { host: "erp.exemplo.test" }]),
    );
    expect(err.message).not.toContain(CHAVE);
    expect(err.message).not.toContain("/mcp");
  });

  it("tempo esgotado do transporte vira tempo_esgotado", async () => {
    const { opcoes } = comErp(new McpError(ErrorCode.RequestTimeout, "Request timed out"));
    const err = await listarLojas(ORG, opcoes).catch((e) => e);
    expect(err.codigo).toBe("tempo_esgotado");
  });

  it("endereço recusado pela guarda de saída vira erp_indisponivel", async () => {
    const { cliente } = banco({ mcp_externo: { endpoint: "http://10.0.0.5/mcp" } });
    const err = await listarLojas(ORG, { supabase: cliente }).catch((e) => e);
    expect(err.codigo).toBe("erp_indisponivel");
    expect(JSON.stringify(err.detalhes)).not.toContain("10.0.0.5/mcp");
  });
});
