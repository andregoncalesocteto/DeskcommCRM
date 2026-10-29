/**
 * O valor da venda que um envio do webhook de entrada traz.
 *
 * Reaproveita a régua dos eventos do funil (`resolverCaminho`, `valorEmCentavos`): a mesma aritmética decimal, sem
 * ponto flutuante, e a mesma regra de "número finito e não negativo". Aqui o resultado nunca derruba o envio: valor
 * ilegível vira "sem valor" e o motivo volta para o log — o card é criado do mesmo jeito, só sem `value_cents`.
 */
import {
  resolverCaminho,
  valorEmCentavos,
  type MotivoDeValorInvalido,
  type UnidadeDoValor,
} from "@/lib/leads/eventos-do-funil/caminho-e-valor";

export interface ConfigDoValor {
  value_path?: string | null;
  value_unit?: string | null;
}

export type ValorDoEnvio =
  | { tipo: "sem_configuracao" }
  | { tipo: "ausente"; caminho: string }
  | { tipo: "invalido"; caminho: string; motivo: MotivoDeValorInvalido }
  | { tipo: "valor"; centavos: number };

export function valorDoEnvio(payload: Record<string, unknown>, config: ConfigDoValor): ValorDoEnvio {
  const caminho = config.value_path;
  const unidade = config.value_unit;
  if (!caminho || (unidade !== "reais" && unidade !== "centavos")) return { tipo: "sem_configuracao" };
  const bruto = resolverCaminho(payload, caminho);
  if (bruto === undefined || bruto === null || bruto === "") return { tipo: "ausente", caminho };
  const convertido = valorEmCentavos(bruto, unidade as UnidadeDoValor);
  if (!convertido.ok) return { tipo: "invalido", caminho, motivo: convertido.motivo };
  return { tipo: "valor", centavos: convertido.centavos };
}
