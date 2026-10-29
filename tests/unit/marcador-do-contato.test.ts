import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MARCADOR_DO_CONTATO,
  preencherMarcadorDoContato,
} from "@/lib/agent-engine/agent/marcador-do-contato";

/**
 * O link do cardápio da Bella Capri leva o id do contato (`?idtrack=<id>`). O
 * agente não tem ferramenta do catálogo, o contexto dele é projetado e NÃO traz o
 * id — e o modelo copiou o telefone (`?idtrack=+5517982290042`). O motor preenche
 * o marcador no envio, com o id do run.
 */

const CONTATO = "982559b9-42f6-4436-a918-158f15f54ef4";

describe("marcador {{id_do_contato}}", () => {
  it("vira o id do contato no link", () => {
    expect(
      preencherMarcadorDoContato(
        `Oi! 😊\nhttps://rpa.bellacapri.com.br/?idtrack=${MARCADOR_DO_CONTATO}`,
        CONTATO,
      ),
    ).toBe(`Oi! 😊\nhttps://rpa.bellacapri.com.br/?idtrack=${CONTATO}`);
  });

  it("troca todas as ocorrências", () => {
    const texto = `${MARCADOR_DO_CONTATO} e ${MARCADOR_DO_CONTATO}`;
    expect(preencherMarcadorDoContato(texto, CONTATO)).toBe(`${CONTATO} e ${CONTATO}`);
  });

  it("só toca o próprio marcador: outras chaves e a forma com uma chave só passam", () => {
    const texto = "{{nome}} {id_do_contato} {{ id_do_contato }}";
    expect(preencherMarcadorDoContato(texto, CONTATO)).toBe(texto);
  });

  it("texto sem marcador sai idêntico", () => {
    expect(preencherMarcadorDoContato("Tudo bem! Segue o cardápio.", CONTATO)).toBe(
      "Tudo bem! Segue o cardápio.",
    );
  });

  it("o valor que entra é o do run, nunca algo que o texto traga", () => {
    // `$&` e afins têm sentido em replace() com string; aqui o id é inserido literal.
    expect(preencherMarcadorDoContato(`a ${MARCADOR_DO_CONTATO} b`, "$&-$1")).toBe("a $&-$1 b");
  });
});

describe("fiação — o send_message preenche antes de qualquer gate", () => {
  const FONTE = readFileSync(
    join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
    "utf8",
  );

  it("o corpo que os gates medem já tem o id do contato, vindo do leadId do run", () => {
    const i = FONTE.indexOf("send_message: tool({");
    const j = FONTE.indexOf("update_lead_state: tool({", i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(FONTE.slice(i, j)).toMatch(
      /const body = formatarParaWhatsApp\(preencherMarcadorDoContato\(corpoDoModelo, leadId\)\)/,
    );
  });
});
