// Lê o resultado de uma ferramenta MCP do ERP. Sucesso vem de `structuredContent`;
// erro (`isError`) traz um JSON `{ codigo, mensagem, detalhes? }` no texto.
// Puro: sem rede, sem escrita, sem import de app/.
import type { ZodType } from "zod";

export const CODIGOS_DE_ERRO_DO_ERP = [
  "termo_invalido",
  "nao_encontrado",
  "nao_autorizado",
  "erp_indisponivel",
  "tempo_esgotado",
  "erro_interno",
] as const;

export type CodigoDeErroDoErp =
  | (typeof CODIGOS_DE_ERRO_DO_ERP)[number]
  | "resposta_invalida"
  | "erp_nao_configurado";

export class ErpPdvError extends Error {
  readonly codigo: CodigoDeErroDoErp;
  readonly detalhes?: unknown;

  constructor(codigo: CodigoDeErroDoErp, mensagem: string, detalhes?: unknown) {
    super(mensagem);
    this.name = "ErpPdvError";
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export interface ResultadoDeFerramenta {
  isError?: boolean;
  structuredContent?: unknown;
  content?: ReadonlyArray<{ type?: string; text?: string }>;
}

function textoDe(resultado: ResultadoDeFerramenta): string {
  return (resultado.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

export function erroDoTexto(texto: string): ErpPdvError {
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return new ErpPdvError("resposta_invalida", texto);
  }
  if (typeof json !== "object" || json === null) {
    return new ErpPdvError("resposta_invalida", texto);
  }
  const { codigo, mensagem, detalhes } = json as Record<string, unknown>;
  const conhecido = (CODIGOS_DE_ERRO_DO_ERP as readonly unknown[]).includes(codigo);
  if (!conhecido || typeof mensagem !== "string") {
    return new ErpPdvError("resposta_invalida", texto);
  }
  return new ErpPdvError(codigo as CodigoDeErroDoErp, mensagem, detalhes);
}

export function lerResultado<T>(resultado: ResultadoDeFerramenta, esquema: ZodType<T>): T {
  if (resultado.isError) throw erroDoTexto(textoDe(resultado));
  const lido = esquema.safeParse(resultado.structuredContent);
  if (!lido.success) {
    throw new ErpPdvError("resposta_invalida", "O ERP devolveu um formato inesperado.");
  }
  return lido.data;
}
