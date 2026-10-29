/**
 * Duas funções puras que o cadastro de eventos do funil usa para ler o JSON de um evento:
 * achar um campo por caminho (`value`, `pedido.total`) e converter o valor da venda em centavos.
 * Sem I/O, para a operação do MCP e o webhook de entrada compartilharem a MESMA régua.
 *
 * ## O caminho é só nome de campo, com ponto
 *
 * Sem índice de lista (`items[0]`), sem expressão, sem JSONPath: quem cadastra o evento não escreve
 * código, e um caminho "esperto" é uma porta para ler o que não devia. Um caminho fora da forma, ou que
 * tenta alcançar o protótipo do objeto, devolve `undefined` como se o campo não existisse.
 * A mesma forma é imposta pelo `check` da tabela `crm_pipeline_events`.
 *
 * ## O valor é aritmética decimal, não ponto flutuante
 *
 * `1.005 * 100` dá `100.49999999999999` e arredondaria para 100 centavos. Aqui o número é lido como TEXTO
 * decimal (a forma mais curta que o JavaScript imprime) e o ponto é deslocado duas casas, arredondando a
 * terceira casa para cima na metade. Não há teto máximo: a decisão do dono do produto é só exigir número
 * finito e não negativo; o limite é o do inteiro seguro do JavaScript.
 */

export const FORMA_DO_CAMINHO = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const SEGMENTOS_PROIBIDOS = new Set(["__proto__", "constructor", "prototype"]);

/** Lê `caminho` dentro de `data`. `undefined` quando não acha, não é objeto no meio do caminho, ou o caminho é inválido. */
export function resolverCaminho(data: unknown, caminho: string): unknown {
  if (typeof caminho !== "string" || !FORMA_DO_CAMINHO.test(caminho)) return undefined;
  let atual: unknown = data;
  for (const segmento of caminho.split(".")) {
    if (SEGMENTOS_PROIBIDOS.has(segmento)) return undefined;
    if (atual === null || typeof atual !== "object" || Array.isArray(atual)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(atual, segmento)) return undefined;
    atual = (atual as Record<string, unknown>)[segmento];
  }
  return atual;
}

export type UnidadeDoValor = "reais" | "centavos";

export type MotivoDeValorInvalido =
  | "nao_numerico"
  | "nao_finito"
  | "negativo"
  | "centavos_nao_inteiro"
  | "fora_do_alcance";

export type ResultadoDoValor =
  | { ok: true; centavos: number }
  | { ok: false; motivo: MotivoDeValorInvalido };

const NUMERO_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** Converte o valor de um evento em centavos inteiros. Recusa o que não é número decimal, finito e não negativo. */
export function valorEmCentavos(valor: unknown, unidade: UnidadeDoValor): ResultadoDoValor {
  let texto: string;
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return { ok: false, motivo: "nao_finito" };
    // Notação científica (1e21, 1e-7) não passa pelo deslocamento decimal: cai no arredondamento comum.
    texto = /e/i.test(String(valor)) ? valor.toFixed(20) : String(valor);
  } else if (typeof valor === "string") {
    texto = valor.trim();
  } else {
    return { ok: false, motivo: "nao_numerico" };
  }

  const m = NUMERO_DECIMAL.exec(texto);
  if (!m) return { ok: false, motivo: "nao_numerico" };
  const [, sinal, inteira = "0", fracao = ""] = m;
  const ehZero = /^0*$/.test(inteira) && /^0*$/.test(fracao);
  if (sinal === "-" && !ehZero) return { ok: false, motivo: "negativo" };

  let centavos: number;
  if (unidade === "centavos") {
    if (!/^0*$/.test(fracao)) return { ok: false, motivo: "centavos_nao_inteiro" };
    centavos = Number(inteira);
  } else {
    const tres = fracao.padEnd(3, "0");
    centavos = Number(inteira) * 100 + Number(tres.slice(0, 2)) + (tres.charAt(2) >= "5" ? 1 : 0);
  }
  if (!Number.isSafeInteger(centavos)) return { ok: false, motivo: "fora_do_alcance" };
  return { ok: true, centavos };
}
