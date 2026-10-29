/**
 * O conteúdo ANINHADO de um envio do webhook de entrada (a lista de itens do pedido, o objeto do cliente).
 *
 * O mapeador genérico só guarda escalares planos: objetos e listas são descartados. Quem quer consultar o que foi
 * comprado configura uma chave (`payload_state_key`); sem ela nada muda. Com ela, as chaves de primeiro nível do corpo
 * cujo valor é objeto ou lista são guardadas, juntas, nessa chave de `custom_fields` — como JSON, do jeito que vieram.
 *
 * Tem teto: JSON grande demais NÃO é guardado e o motivo volta para o log (o envio segue, só sem o JSON).
 */

export const LIMITE_DO_JSON_EM_BYTES = 32 * 1024;
/** Os campos reservados do corpo (`external_id` e `stage`) nunca entram no JSON guardado. */
const RESERVADAS = new Set(["external_id", "stage"]);

export type JsonDoEnvio =
  | { tipo: "sem_configuracao" }
  | { tipo: "vazio" }
  | { tipo: "grande"; bytes: number }
  | { tipo: "conteudo"; chave: string; valor: Record<string, unknown> };

export function jsonDoEnvio(payload: Record<string, unknown>, chave: string | null | undefined): JsonDoEnvio {
  if (!chave) return { tipo: "sem_configuracao" };
  const valor: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (RESERVADAS.has(k)) continue;
    if (v !== null && typeof v === "object") valor[k] = v;
  }
  if (Object.keys(valor).length === 0) return { tipo: "vazio" };
  const bytes = new TextEncoder().encode(JSON.stringify(valor)).length;
  if (bytes > LIMITE_DO_JSON_EM_BYTES) return { tipo: "grande", bytes };
  return { tipo: "conteudo", chave, valor };
}

/** O JSON novo difere do que o card já tem na chave? (`String()` do objeto não serve: vira «[object Object]».) */
export function jsonMudou(atual: unknown, novo: Record<string, unknown>): boolean {
  return JSON.stringify(atual ?? null) !== JSON.stringify(novo);
}
