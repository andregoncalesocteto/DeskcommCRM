import { describe, expect, it } from "vitest";

import {
  decidirMovimento,
  estadoDevePrevalecer,
  type EntradaDoMovimento,
} from "@/lib/leads/eventos-do-funil/decisao-de-movimento";

/**
 * A matriz de "para onde o card vai" quando um evento chega. Funil de exemplo, na ordem do quadro:
 *   Conversas(1000) · Visitas(2000) · Visualizações(2500) · Carrinho(2750) · Revisão(2875) · Compras(3000) · Chamar humano(5500)
 * Os eventos apontam para Visitas, Visualizações, Carrinho, Revisão e Compras. Conversas e "Chamar humano" ficam FORA do mapa.
 */
const E = {
  conversas: { id: "conversas", position: 1000 },
  visitas: { id: "visitas", position: 2000 },
  visualizacoes: { id: "visualizacoes", position: 2500 },
  carrinho: { id: "carrinho", position: 2750 },
  revisao: { id: "revisao", position: 2875 },
  compras: { id: "compras", position: 3000 },
  humano: { id: "humano", position: 5500 },
};
const MAPA = new Set(["visitas", "visualizacoes", "carrinho", "revisao", "compras"]);
const dest = (e: { id: string; position: number }, arquivada = false) => ({ ...e, arquivada });

function entrada(parcial: Partial<EntradaDoMovimento>): EntradaDoMovimento {
  return {
    etapaAtual: E.conversas,
    destino: dest(E.visitas),
    etapasDeDestinoDoFunil: MAPA,
    pedidoEncerrado: false,
    respeitaMovimentoManual: true,
    atorDoUltimoMovimento: "system",
    ...parcial,
  };
}

describe("decidirMovimento: não retrocede", () => {
  it.each([
    ["de fora do mapa (Conversas) para a primeira etapa do mapa", E.conversas, E.visitas, "movido"],
    ["de Visitas para Visualizações (dentro do mapa, à frente)", E.visitas, E.visualizacoes, "movido"],
    ["de Carrinho direto para Compras (pula Revisão)", E.carrinho, E.compras, "movido"],
    ["de Revisão para Visitas (dentro do mapa, atrás)", E.revisao, E.visitas, "ja_na_etapa_ou_adiante"],
    ["de Compras para Carrinho (atrás)", E.compras, E.carrinho, "ja_na_etapa_ou_adiante"],
    ["para a mesma etapa", E.carrinho, E.carrinho, "ja_na_etapa_ou_adiante"],
    ["do desvio 'Chamar humano' (fora do mapa) para Compras, mesmo atrás na ordem do quadro", E.humano, E.compras, "movido"],
    ["do desvio 'Chamar humano' para Visitas", E.humano, E.visitas, "movido"],
  ])("%s", (_nome, atual, destino, esperado) => {
    expect(decidirMovimento(entrada({ etapaAtual: atual, destino: dest(destino) }))).toBe(esperado);
  });

  it("etapa atual desconhecida (não deu para ler) não trava o avanço", () => {
    expect(decidirMovimento(entrada({ etapaAtual: null, destino: dest(E.carrinho) }))).toBe("movido");
  });

  it("⭐ posição igual à da etapa atual, dentro do mapa, NÃO move ('maior', não 'maior ou igual')", () => {
    const gemea = { id: "gemea", position: 2750 };
    const mapa = new Set([...MAPA, "gemea"]);
    expect(
      decidirMovimento(entrada({ etapaAtual: E.carrinho, destino: dest(gemea), etapasDeDestinoDoFunil: mapa })),
    ).toBe("ja_na_etapa_ou_adiante");
  });
});

describe("decidirMovimento: o que impede o movimento, em ordem de precedência", () => {
  it("sem destino cadastrado: o evento só registra (vence qualquer outro motivo)", () => {
    expect(decidirMovimento(entrada({ destino: null }))).toBe("sem_destino");
    expect(decidirMovimento(entrada({ destino: null, pedidoEncerrado: true }))).toBe("sem_destino");
  });

  it("pedido encerrado não se move, nem para frente", () => {
    expect(decidirMovimento(entrada({ pedidoEncerrado: true }))).toBe("pedido_encerrado");
  });

  it("etapa de destino arquivada: só registra", () => {
    expect(decidirMovimento(entrada({ destino: dest(E.visitas, true) }))).toBe("etapa_arquivada");
  });

  it("encerrado vence arquivada", () => {
    expect(decidirMovimento(entrada({ pedidoEncerrado: true, destino: dest(E.visitas, true) }))).toBe("pedido_encerrado");
  });

  it("destino que não está à frente vence o movimento manual (não há o que respeitar)", () => {
    expect(
      decidirMovimento(entrada({ etapaAtual: E.revisao, destino: dest(E.visitas), atorDoUltimoMovimento: "user" })),
    ).toBe("ja_na_etapa_ou_adiante");
  });
});

describe("decidirMovimento: respeitar o movimento manual da equipe", () => {
  const aMaoPeloGerente = { atorDoUltimoMovimento: "user", etapaAtual: E.carrinho, destino: dest(E.revisao) };

  it("flag ligado e último movimento de uma pessoa: registra e não move", () => {
    expect(decidirMovimento(entrada({ ...aMaoPeloGerente, respeitaMovimentoManual: true }))).toBe("respeita_movimento_manual");
  });

  it("flag DESLIGADO: o evento move mesmo depois de uma pessoa (a compra)", () => {
    expect(decidirMovimento(entrada({ ...aMaoPeloGerente, respeitaMovimentoManual: false }))).toBe("movido");
  });

  it.each(["system", "ai", "rule", "contact", null])("último movimento por %s não é manual: move", (ator) => {
    expect(decidirMovimento(entrada({ ...aMaoPeloGerente, atorDoUltimoMovimento: ator, respeitaMovimentoManual: true }))).toBe("movido");
  });

  it("depois que o evento move (ator system), o próximo volta a mover", () => {
    const antes = entrada({ ...aMaoPeloGerente, destino: dest(E.revisao) });
    expect(decidirMovimento(antes)).toBe("respeita_movimento_manual");
    const depois = entrada({ etapaAtual: E.revisao, destino: dest(E.compras), atorDoUltimoMovimento: "system" });
    expect(decidirMovimento(depois)).toBe("movido");
  });
});

describe("estadoDevePrevalecer: o mais novo vence", () => {
  const T = (min: number) => new Date(Date.UTC(2026, 9, 29, 17, min)).toISOString();

  it.each([
    ["mais novo que o último", T(10), T(5), true],
    ["igual ao último (reaplicar regrava o mesmo valor)", T(5), T(5), true],
    ["mais antigo que o último", T(1), T(5), false],
    ["sem último evento", T(1), null, true],
    ["último indefinido", T(1), undefined, true],
  ])("%s", (_nome, at, ultimo, esperado) => {
    expect(estadoDevePrevalecer(at, ultimo)).toBe(esperado);
  });

  it("aceita instante como texto, número e Date", () => {
    expect(estadoDevePrevalecer(new Date(T(10)), Date.parse(T(5)))).toBe(true);
    expect(estadoDevePrevalecer(Date.parse(T(1)), new Date(T(5)))).toBe(false);
  });

  it("hora ilegível no evento novo não prevalece; no anterior, não impede", () => {
    expect(estadoDevePrevalecer("ontem", T(5))).toBe(false);
    expect(estadoDevePrevalecer(T(5), "ontem")).toBe(true);
  });
});
