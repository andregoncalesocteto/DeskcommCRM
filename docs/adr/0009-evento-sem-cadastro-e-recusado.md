# ADR-0009 — Evento sem cadastro no funil é recusado, evento a evento

- **Status:** proposto. Decidido no debate de 29/10/2026 com o autor da feature; aguarda aprovação para ser aceito.
- **Data:** 2026-10-29
- **Contexto medido em:** `20963bb71` (topo da `main` local em 29/10/2026)
- **Doc que muda junto:** [`docs/design/eventos-do-funil.md`](../design/eventos-do-funil.md), seções 5 e 7
- **Decisões irmãs:** [ADR-0007](0007-cadastro-de-eventos-do-funil-em-tabela-propria.md) e [ADR-0008](0008-historico-e-a-fonte-de-verdade-do-pedido.md)

---

## Contexto

Com o cadastro de eventos por funil ([ADR-0007](0007-cadastro-de-eventos-do-funil-em-tabela-propria.md)), surge a pergunta de
contrato com quem integra: o que o CRM faz quando chega um evento cuja chave **não está cadastrada** no funil do pedido?

O que existe hoje: a ferramenta `crm_add_lead_events` (`lib/leads/eventos-externos.ts`) aceita **qualquer** nome de evento
que respeite o padrão (minúsculas, números e `_`). Ela é permissiva por desenho e já tem uso.

O que pesa na escolha:
- O integrador é, em geral, um terceiro (cardápio de outra empresa), que não consegue ver o log do CRM nem corrigir
  rápido o próprio código. Um erro de digitação em produção precisa ser percebido por ele.
- Nada nasce semeado com o funil. Um funil novo, sem eventos cadastrados, passa a recusar tudo até a pessoa cadastrar. É um
  atrito conhecido e assumido na decisão de não presumir que os funis se parecem.
- O histórico (`crm_lead_activities`) alimenta relatórios; nomes errados o poluem.
- Um lote reúne eventos independentes (visita, item, carrinho). Um evento errado não deveria impedir os demais.

---

## Decisão

**Vamos recusar, evento a evento, todo evento cuja chave não esteja cadastrada e ativa no funil do pedido, devolvendo na
resposta a lista de chaves válidas, e sem gravar nada para ele; os outros eventos do mesmo lote seguem normalmente.**

---

## Alternativas consideradas

| # | Alternativa | Prós | Contras | Veredito |
|---|---|---|---|---|
| A | **Aceitar e avisar**: registra no histórico, não move nem altera estado, e a resposta traz um aviso | Tolerante: um erro de digitação não perde o dado | O histórico acumula nomes errados que ninguém consegue limpar; o aviso é fácil de ignorar em produção; o cadastro deixa de ser contrato | Rejeitada pelo dono da feature |
| B | **Recusar o lote inteiro** se houver um evento desconhecido | Contrato simples | Um evento errado derruba visitas e itens válidos do mesmo envio; piora para quem manda lotes grandes | Rejeitada |
| C | **Cadastrar sozinho** ao receber o primeiro | Zero atrito de configuração | Qualquer chamada passa a criar eventos; a tela de cadastro vira lixo; esvazia o sentido de o funil decidir | Rejeitada |
| D | **Recusar por evento**, com a lista de chaves válidas | O cadastro é o contrato; o histórico só tem nomes conhecidos; o integrador vê o erro na hora e sabe como corrigir; eventos válidos não são prejudicados | Um nome errado perde aquele evento; um funil novo não aceita nada até cadastrar | **Escolhida** |

---

## Consequências

**Positivas**
- O histórico fica limpo: tudo o que está lá corresponde a um evento que alguém cadastrou, e os relatórios podem confiar nos nomes.
- O integrador descobre o erro na primeira chamada, com a lista do que é válido na mensagem.
- Recusar um evento não derruba os outros do lote.

**Negativas / trade-offs**
- Um erro de digitação em produção perde o evento até alguém corrigir. Mitigações previstas: a leitura
  `crm_list_pipeline_events` para consultar as chaves antes de integrar, a mensagem de recusa que lista as chaves ativas e
  uma contagem de recusas visível por organização.
- **Dois contratos convivem**: `crm_add_lead_events` segue permissiva e a operação nova é estrita. Aceito para não quebrar
  quem usa a primeira, e fica documentado qual escolher.
- Funil novo, sem eventos, recusa tudo até o cadastro. É atrito aceito.

**Obrigações**
- A recusa de validação **não** vai para o Sentry: é resposta normal ao integrador. Só erro inesperado alerta.
- Quem implementar um cliente (o plugin da etapa seguinte, por exemplo) não deve reenviar um evento `recusado`: a recusa é
  definitiva, não transitória.
- Medir `evento_nao_cadastrado` por organização; pico dessa recusa quase sempre é cadastro ou nome errado.
- O guia de integração e a spec do MCP descrevem os dois contratos e quando usar cada um.
