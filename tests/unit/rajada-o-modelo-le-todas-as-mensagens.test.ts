import { describe, expect, it } from "vitest";

import { buildOpeningMessage } from "@/lib/agent-engine/agent/inbound-turn";
import type { LeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

/**
 * A RAJADA CHEGA INTEIRA AO MODELO.
 *
 * O drain coalesce a rajada no job da PRIMEIRA mensagem, e a abertura do turno
 * nomeava só ela como "mensagem atual — responda a ESTA". Cliente que escreve uma
 * frase por mensagem — "olá tudo bem?" e, cinco segundos depois, "ainda preciso
 * saber o status do meu pedido" — tinha a pergunta tratada como histórico, e a
 * Bella (que só manda o link do cardápio e passa o resto à equipe) respondeu o
 * cumprimento com o link. Medido na instalação da Bella Capri: duas rodadas, a
 * mesma resposta, mesmo com o prompt mandando ler tudo.
 *
 * A âncora do turno continua sendo a mensagem do job (é ela que o pin protege de
 * um registro concorrente — ver `rajada-nao-cala-o-pedido-de-humano.test.ts`).
 * O que muda é que as mensagens que vieram DEPOIS dela, sem resposta nossa,
 * chegam ao modelo num bloco próprio.
 */

const CUMPRIMENTO = "olá tudo bem?";
const PERGUNTA = "ainda preciso saber o status do meu pedido";

function contexto(messages: unknown[]): LeadContext {
  return {
    lead_id: "11111111-1111-4111-8111-111111111111",
    contact: { name: "André", phone: null, email: null, tags: [], is_blocked: false },
    conversation_id: "22222222-2222-4222-8222-222222222222",
    last_human_decision: null,
    messages,
  } as unknown as LeadContext;
}

const abrir = (ctx: LeadContext, doJob: string) =>
  buildOpeningMessage(null, null, ctx, "sem notas", false, [], "", doJob);

const TITULO_DO_BLOCO = "## Mensagens que o cliente mandou logo depois, ainda sem resposta";

describe("rajada: o modelo lê as mensagens que vieram depois da âncora", () => {
  const rajada = contexto([
    { direction: "outbound", body: "Oi! Como posso ajudar?", sent_at: "2026-10-29T13:00:00-03:00" },
    { direction: "inbound", body: CUMPRIMENTO, sent_at: "2026-10-29T13:04:38-03:00" },
    { direction: "inbound", body: PERGUNTA, sent_at: "2026-10-29T13:04:43-03:00" },
  ]);

  it("cumprimento + pergunta: a pergunta entra no bloco das seguintes", () => {
    const abertura = abrir(rajada, CUMPRIMENTO);

    expect(abertura).toContain(TITULO_DO_BLOCO);
    expect(abertura).toContain(JSON.stringify({ textos: [PERGUNTA] }));
    expect(abertura).toContain("todas juntas");
    expect(abertura).toContain("é ela que decide o que fazer — nunca o cumprimento");
  });

  it("a âncora segue sendo a mensagem do job, e só ela", () => {
    const abertura = abrir(rajada, CUMPRIMENTO);

    expect(abertura).toContain(JSON.stringify({ texto: CUMPRIMENTO }));
    expect(abertura).not.toContain(JSON.stringify({ texto: PERGUNTA }));
  });

  it("três mensagens: as duas seguintes chegam em ordem, sem emendar", () => {
    const tres = contexto([
      { direction: "inbound", body: "oi", sent_at: "2026-10-29T13:00:00-03:00" },
      { direction: "inbound", body: "tudo bem?", sent_at: "2026-10-29T13:00:02-03:00" },
      { direction: "inbound", body: "quanto tempo demora a entrega?", sent_at: "2026-10-29T13:00:05-03:00" },
    ]);

    expect(abrir(tres, "oi")).toContain(
      JSON.stringify({ textos: ["tudo bem?", "quanto tempo demora a entrega?"] }),
    );
  });

  it("mensagem única: nada de bloco, e o texto antigo da instrução fica como era", () => {
    const unica = contexto([
      { direction: "outbound", body: "Oi!", sent_at: "2026-10-29T13:00:00-03:00" },
      { direction: "inbound", body: PERGUNTA, sent_at: "2026-10-29T13:00:05-03:00" },
    ]);
    const abertura = abrir(unica, PERGUNTA);

    expect(abertura).not.toContain(TITULO_DO_BLOCO);
    expect(abertura).toContain("Responda a ESTA mensagem agora.");
  });

  it("o que já foi respondido não volta: o corte é a última resposta nossa", () => {
    // A âncora ("oi") também aparece ANTES da nossa resposta. Sem o corte, o
    // "oi" de ontem seria tomado pela âncora e o "oi" de hoje viraria "seguinte".
    const ctx = contexto([
      { direction: "inbound", body: "oi", sent_at: "2026-10-28T10:00:00-03:00" },
      { direction: "outbound", body: "Oi! Segue o cardápio.", sent_at: "2026-10-28T10:01:00-03:00" },
      { direction: "inbound", body: "oi", sent_at: "2026-10-29T13:04:38-03:00" },
      { direction: "inbound", body: PERGUNTA, sent_at: "2026-10-29T13:04:43-03:00" },
    ]);

    expect(abrir(ctx, "oi")).toContain(JSON.stringify({ textos: [PERGUNTA] }));
  });

  it("âncora que não está entre as pendentes (registro concorrente pinado): sem bloco", () => {
    const concorrente = contexto([
      { direction: "inbound", body: "registro concorrente", sent_at: "2026-10-29T13:04:43-03:00" },
    ]);
    const abertura = abrir(concorrente, "mensagem que o job aponta");

    expect(abertura).not.toContain(TITULO_DO_BLOCO);
    expect(abertura).toContain(JSON.stringify({ texto: "mensagem que o job aponta" }));
  });

  it("mensagem sem corpo (mídia, registro vazio) não vira seguinte", () => {
    const ctx = contexto([
      { direction: "inbound", body: CUMPRIMENTO, sent_at: "2026-10-29T13:04:38-03:00" },
      { direction: "inbound", body: "   ", sent_at: "2026-10-29T13:04:40-03:00" },
    ]);

    expect(abrir(ctx, CUMPRIMENTO)).not.toContain(TITULO_DO_BLOCO);
  });

  it("em grupo não emenda vozes: com remetente, o bloco não aparece", () => {
    const grupo = contexto([
      { direction: "inbound", body: CUMPRIMENTO, sent_at: "2026-10-29T13:04:38-03:00" },
      { direction: "inbound", body: PERGUNTA, sent_at: "2026-10-29T13:04:43-03:00" },
    ]);
    const abertura = buildOpeningMessage(
      null,
      null,
      grupo,
      "sem notas",
      false,
      [],
      "",
      CUMPRIMENTO,
      { name: "Maria", phone: "+5511999990000" },
    );

    expect(abertura).not.toContain(TITULO_DO_BLOCO);
  });
});
