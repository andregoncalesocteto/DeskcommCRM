import { describe, expect, it } from "vitest";

import { criarBancoFalso, type Linha } from "../../tests/helpers/banco-falso-de-eventos";
import { identificarPedido } from "./identificar-pedido";

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "33333333-3333-4333-8333-333333333333";
const FUNIL = "44444444-4444-4444-8444-444444444444";
const OUTRO_FUNIL = "55555555-5555-4555-8555-555555555555";
const CONTATO = "66666666-6666-4666-8666-666666666666";
const PESSOAL = "77777777-7777-4777-8777-777777777777";
const ANONIMO = "88888888-8888-4888-8888-888888888888";
const ALHEIO = "99999999-9999-4999-8999-999999999999";
const chave = { organizationId: ORG, pipelineId: FUNIL };

const contato = (id: string, extra: Linha = {}): Linha => ({
  id, organization_id: ORG, is_personal: false, is_anonymized: false, ...extra,
});
const pedido = (id: string, extra: Linha = {}): Linha => ({
  id, organization_id: ORG, pipeline_id: FUNIL, contact_id: CONTATO, status: "open", created_at: "2026-10-01T10:00:00Z", ...extra,
});

function banco(pedidos: Linha[], contatos: Linha[] = []) {
  return criarBancoFalso({
    contacts: [contato(CONTATO), contato(PESSOAL, { is_personal: true }), contato(ANONIMO, { is_anonymized: true }),
      contato(ALHEIO, { organization_id: OUTRA_ORG }), ...contatos] as Linha[],
    crm_leads: pedidos,
  } as never).client as never;
}

describe("identificarPedido", () => {
  it("acha o pedido aberto do contato no funil da chave", async () => {
    expect(await identificarPedido(banco([pedido("p1")]), chave, CONTATO)).toBe("p1");
  });

  it("⭐ vários abertos: vale o mais recente", async () => {
    const pedidos = [
      pedido("antigo", { created_at: "2026-10-01T10:00:00Z" }),
      pedido("novo", { created_at: "2026-10-05T10:00:00Z" }),
      pedido("meio", { created_at: "2026-10-03T10:00:00Z" }),
    ];
    expect(await identificarPedido(banco(pedidos), chave, CONTATO)).toBe("novo");
  });

  it("aceita o UUID em maiúsculas (o link pode vir assim)", async () => {
    expect(await identificarPedido(banco([pedido("p1")]), chave, CONTATO.toUpperCase())).toBe("p1");
  });

  it("⭐ UUID válido de contato sem pedido aberto: null (nunca cria pedido)", async () => {
    const db = banco([]);
    expect(await identificarPedido(db, chave, CONTATO)).toBeNull();
  });

  it("pedido ganho ou perdido não serve", async () => {
    expect(await identificarPedido(banco([pedido("g", { status: "won" }), pedido("l", { status: "lost" })]), chave, CONTATO)).toBeNull();
  });

  it("⭐ pedido de OUTRO funil não serve", async () => {
    expect(await identificarPedido(banco([pedido("fora", { pipeline_id: OUTRO_FUNIL })]), chave, CONTATO)).toBeNull();
  });

  it("⭐ telefone, e-mail, texto e vazio no lugar do id: null, sem consulta que revele algo", async () => {
    const db = banco([pedido("p1")]);
    for (const lixo of ["+5517982290042", "5517982290042", "a@b.com", "not-a-uuid", "", "   ", `${CONTATO}x`, `x${CONTATO}`]) {
      expect(await identificarPedido(db, chave, lixo)).toBeNull();
    }
  });

  it("sem idtrack nenhuma identidade é achada", async () => {
    expect(await identificarPedido(banco([pedido("p1")]), chave, undefined)).toBeNull();
  });

  it("⭐ contato pessoal e contato anonimizado são descartados", async () => {
    const pedidos = [pedido("pp", { contact_id: PESSOAL }), pedido("pa", { contact_id: ANONIMO })];
    expect(await identificarPedido(banco(pedidos), chave, PESSOAL)).toBeNull();
    expect(await identificarPedido(banco(pedidos), chave, ANONIMO)).toBeNull();
  });

  it("⭐ contato de outra organização não vira pedido, mesmo com o pedido no funil certo", async () => {
    expect(await identificarPedido(banco([pedido("x", { contact_id: ALHEIO })]), chave, ALHEIO)).toBeNull();
  });

  it("falha do banco não vira 'não achei': propaga", async () => {
    const quebrado = criarBancoFalso({ contacts: [], crm_leads: [] } as never, {
      erroEm: (tabela) => (tabela === "contacts" ? { message: "boom" } : null),
    }).client as never;
    await expect(identificarPedido(quebrado, chave, CONTATO)).rejects.toThrow("boom");
  });
});
