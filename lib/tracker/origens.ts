/**
 * As ORIGENS de onde uma chave pública do rastreador vale.
 *
 * A chave é um identificador público (vai no HTML do site), então o que a prende ao site do cliente é a lista de
 * origens: esquema + host + porta, sem caminho. Esta regra é pura e é a MESMA para cadastrar (a API de chaves) e para
 * comparar (a porta pública de coleta), para que "o que foi aceito no cadastro" e "o que a porta reconhece" nunca
 * sejam duas leituras da mesma URL.
 */
import { z } from "zod";

export const MAX_ORIGENS_POR_CHAVE = 20;

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1"]);
const HOST_COMUM = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/**
 * Devolve a origem normalizada (`https://loja.exemplo`, `http://localhost:3000`) ou `null` quando a entrada não é
 * uma origem aceita: https sempre; http só em localhost/127.0.0.1; sem usuário, caminho, consulta ou fragmento;
 * sem curinga (host só com letras, números, ponto e hífen).
 */
export function normalizarOrigem(bruta: string): string | null {
  let u: URL;
  try {
    u = new URL(bruta.trim());
  } catch {
    return null;
  }
  if (u.username !== "" || u.password !== "" || u.search !== "" || u.hash !== "") return null;
  if (u.pathname !== "/") return null;
  // O parser aceita `*` e outros símbolos no host (`https://*.exemplo.com` vira uma URL "válida"): curinga não existe aqui.
  if (!HOST_COMUM.test(u.hostname)) return null;
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && HOSTS_LOCAIS.has(u.hostname)) return u.origin;
  return null;
}

export type ResultadoDasOrigens = { ok: true; origens: string[] } | { ok: false; invalida: string };

/** Normaliza a lista inteira, sem repetidas; a primeira inválida é devolvida para a mensagem apontar para ela. */
export function normalizarOrigens(brutas: string[]): ResultadoDasOrigens {
  const vistas = new Set<string>();
  for (const bruta of brutas) {
    const o = normalizarOrigem(bruta);
    if (o === null) return { ok: false, invalida: bruta };
    vistas.add(o);
  }
  return { ok: true, origens: [...vistas] };
}

/** O corpo de POST /pipelines/[id]/tracker-keys. `strict`: campo desconhecido (inclusive `organization_id`) é recusado. */
export const novaChaveSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  allowed_origins: z.array(z.string().max(200)).min(1).max(MAX_ORIGENS_POR_CHAVE),
});
