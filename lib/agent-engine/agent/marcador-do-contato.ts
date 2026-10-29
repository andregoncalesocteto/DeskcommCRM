/**
 * O marcador `{{id_do_contato}}`: o agente escreve, o motor preenche no envio.
 *
 * ## Por que existe
 *
 * Um agente sem nenhuma ferramenta do catálogo tem o contexto PROJETADO
 * (`turnoProjeta`, `projecao.ts`): o `lead_id` — que é o id do contato — sai do que
 * o modelo lê, de propósito, para UUID não chegar à tela do cliente. Só que há
 * mensagem em que o id do contato é exatamente o que o cliente precisa receber: o
 * link de um cardápio externo que reconhece o cliente por ele
 * (`https://loja.exemplo/?idtrack=<id>`). Mandar o modelo "copiar o identificador
 * do contexto" não funciona quando o contexto não o traz: medido na Bella Capri
 * (29/10/2026), ele copiou o telefone — o único valor que parecia um identificador
 * — e o link saiu com `?idtrack=+5517982290042`.
 *
 * ## Por que o motor preenche, e não o modelo
 *
 * O valor vem do `leadId` do RUN (fonte confiável: o job), nunca do texto do
 * modelo nem do cliente — o modelo não escolhe de quem é o id, e não precisa
 * conhecê-lo. Copiar 36 caracteres é trabalho que o motor faz sem errar.
 *
 * Só este marcador, só neste contato: nenhum outro `{{...}}` é tocado.
 */
export const MARCADOR_DO_CONTATO = '{{id_do_contato}}';

export function preencherMarcadorDoContato(texto: string, contatoId: string): string {
  return texto.split(MARCADOR_DO_CONTATO).join(contatoId);
}
