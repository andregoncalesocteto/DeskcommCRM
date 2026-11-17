// Leituras do ERP para o PDV (lojas e clientes). Transporte: o servidor MCP externo que a
// organização cadastrou, chamado por `chamarFerramentaRemota` sem passar pelo carregador do
// turno de conversa. O endereço e a chave nunca saem daqui: nem em log, nem em erro; só o host.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

import { chamarFerramentaRemota } from "@/lib/mcp/servidor-externo/chamada";
import { hostDoEndpoint, lerEndpointMcpExterno } from "@/lib/mcp/servidor-externo/registro";
import { abrirChaveMcpExterno } from "@/lib/mcp/servidor-externo/segredo";
import { createAdminClient } from "@/lib/supabase/admin";

import { ErpPdvError, erroDoTexto, lerResultado } from "./resposta";
import {
  ListaDeLojasSchema,
  ObterClienteSchema,
  ResultadoBuscaSchema,
  type Cliente,
  type Loja,
  type ResultadoBusca,
} from "./tipos";

/** Tempo limite por chamada, em ms. Leituras: 15 s (o padrão do transporte, explícito aqui). */
export const TEMPO_LIMITE_LEITURA_MS = 15_000;

export type ModoDeBusca = "telefone" | "nome" | "cpf";

export interface OpcoesDoErp {
  /** Cliente do banco; o padrão é o admin client, sempre filtrado por `organization_id`. */
  supabase?: SupabaseClient;
  /** `fetch` injetado (testes). */
  fetch?: FetchLike;
}

const COLUNAS =
  "settings, mcp_externo_chave_encrypted, mcp_externo_chave_iv, mcp_externo_chave_tag";

interface Servidor {
  endpoint: string;
  chave: string;
}

async function servidorDaOrganizacao(
  organizationId: string,
  supabase: SupabaseClient,
): Promise<Servidor> {
  const { data, error } = await supabase
    .from("organizations")
    .select(COLUNAS)
    .eq("id", organizationId)
    .maybeSingle();
  if (error) {
    throw new ErpPdvError("erp_indisponivel", "Não foi possível ler o cadastro do ERP.");
  }
  const linha = data as {
    settings?: unknown;
    mcp_externo_chave_encrypted?: string;
    mcp_externo_chave_iv?: string;
    mcp_externo_chave_tag?: string;
  } | null;
  const endpoint = lerEndpointMcpExterno(linha?.settings);
  const chave = abrirChaveMcpExterno({
    mcp_externo_chave_encrypted: linha?.mcp_externo_chave_encrypted,
    mcp_externo_chave_iv: linha?.mcp_externo_chave_iv,
    mcp_externo_chave_tag: linha?.mcp_externo_chave_tag,
  });
  if (!endpoint || !chave) {
    throw new ErpPdvError("erp_nao_configurado", "Esta organização não tem servidor do ERP cadastrado.");
  }
  return { endpoint, chave };
}

function ehTempoEsgotado(err: unknown): boolean {
  const e = err as { code?: unknown; name?: unknown; message?: unknown } | null;
  if (e?.code === -32001 || e?.name === "AbortError" || e?.name === "TimeoutError") return true;
  return typeof e?.message === "string" && /time(d)? ?out|timed out/i.test(e.message);
}

/** Erro do transporte ou do ERP → `ErpPdvError`. Nunca repassa a mensagem original de rede
 *  (pode citar o endereço); só o host. */
function traduzirErro(err: unknown, host: string): ErpPdvError {
  if (err instanceof ErpPdvError) return err;
  // `isError` do ERP chega como `Error` simples com o texto do servidor.
  const simples =
    err instanceof Error &&
    Object.getPrototypeOf(err) === Error.prototype &&
    !err.message.startsWith("unsafe_url:");
  if (simples) return erroDoTexto((err as Error).message);
  if (ehTempoEsgotado(err)) {
    return new ErpPdvError("tempo_esgotado", "O ERP demorou demais para responder.", { host });
  }
  return new ErpPdvError("erp_indisponivel", "Não foi possível falar com o ERP.", { host });
}

async function chamar<T>(
  organizationId: string,
  ferramenta: string,
  argumentos: Record<string, unknown>,
  esquema: Parameters<typeof lerResultado<T>>[1],
  opcoes?: OpcoesDoErp,
): Promise<T> {
  const servidor = await servidorDaOrganizacao(organizationId, opcoes?.supabase ?? createAdminClient());
  const host = hostDoEndpoint(servidor.endpoint);
  try {
    const r = await chamarFerramentaRemota(servidor, ferramenta, argumentos, {
      timeoutMs: TEMPO_LIMITE_LEITURA_MS,
      ...(opcoes?.fetch ? { fetch: opcoes.fetch } : {}),
    });
    return lerResultado(
      { structuredContent: r.dados, content: [{ type: "text", text: r.texto }] },
      esquema,
    );
  } catch (err) {
    throw traduzirErro(err, host);
  }
}

export async function listarLojas(organizationId: string, opcoes?: OpcoesDoErp): Promise<Loja[]> {
  const r = await chamar(organizationId, "listar_lojas", { apenas_ativas: true }, ListaDeLojasSchema, opcoes);
  return r.lojas;
}

export function buscarCliente(
  organizationId: string,
  modo: ModoDeBusca,
  termo: string,
  limite?: number,
  opcoes?: OpcoesDoErp,
): Promise<ResultadoBusca> {
  return chamar(
    organizationId,
    "buscar_cliente",
    { modo, termo, ...(limite === undefined ? {} : { limite }) },
    ResultadoBuscaSchema,
    opcoes,
  );
}

export async function obterCliente(
  organizationId: string,
  id: string,
  opcoes?: OpcoesDoErp & { camposSensiveis?: boolean },
): Promise<Cliente> {
  const r = await chamar(
    organizationId,
    "obter_cliente",
    { cliente_id: id, campos_sensiveis: opcoes?.camposSensiveis ?? false },
    ObterClienteSchema,
    opcoes,
  );
  return r.cliente;
}
