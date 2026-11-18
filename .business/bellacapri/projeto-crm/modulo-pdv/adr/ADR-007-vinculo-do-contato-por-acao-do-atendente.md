# ADR-007: O vínculo entre o cliente do ERP e o contato do CRM é uma ação do atendente, pelo telefone

Status: Aceito
Data: 2026-11-18
Aceito em: 2026-11-18, pelo dono do projeto
Complementa: [ADR-002](ADR-002-cliente-mestre-no-erp.md) (o ERP segue como cadastro mestre; o contato espelho segue existindo). Não o substitui: muda **quando** e **por qual chave** o vínculo nasce.
Origem da decisão: o dono do projeto, ao ver a ficha de um cliente recusar a abertura com "Há mais de um contato com os dados deste cliente".

## 1. Contexto

- Até a fase 2, abrir a ficha de um cliente **criava ou reaproveitava** o contato espelho e gravava o vínculo (`pdv_customer_links`). A busca do contato usava telefone, hash do CPF e e-mail.
- No ERP real, **vários clientes compartilham o mesmo telefone** (a busca por telefone chegou a devolver 17 clientes, contra no máximo 1 no contrato), e o ERP não pode ser corrigido por quem opera o CRM.
- No CRM o telefone é a chave do contato: único por organização entre contatos vivos. O banco também limita o vínculo a **um cliente do ERP por contato**.
- Resultado medido: um cliente cujo telefone já pertencia a um contato vinculado a **outro** cliente do ERP não abria a ficha, com a mensagem "há mais de um contato". Excluir contatos não resolvia, porque o contato que bloqueava era o do outro cliente, e o CPF do cliente nem estava no CRM.
- Abrir uma tela de consulta gravava no banco, e quem apenas consultava criava contatos.

## 2. Decisão

Vamos **abrir a ficha apenas para ler** e fazer o vínculo com o contato do CRM por **ação explícita do atendente** (botões "Vincular ao CRM" e "Atualizar dados"), tendo o **telefone como única chave** entre o ERP e o CRM.

Regras:

- A pesquisa do cliente no ERP (nome, CPF ou telefone) **não muda**.
- "Vincular ao CRM" liga o cliente ao contato que tem aquele telefone (grafias com e sem o nono dígito e com e sem 55); se não houver contato, **cria** o contato com os dados do ERP. Se o contato do número já pertence a **outro** cliente do ERP, recusa e diz isso na ficha: quem vincula primeiro fica com o telefone. Sem telefone no ERP, não há vínculo.
- CPF e e-mail **não** servem para achar contato. Se o CPF ou o e-mail do cliente já são de outro contato, o contato novo nasce sem eles e o atendente é avisado.
- "Atualizar dados" faz o ERP sobrescrever nome, e-mail, CPF e nascimento do contato vinculado. O telefone nunca muda, e dado que o ERP não tem não apaga o do CRM.
- O cadastro de cliente **novo no ERP** fica para a fatia E3 do ERP.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | Manter o vínculo automático ao abrir a ficha, mudando só a busca para telefone | Nenhuma ação a mais do atendente | Consultar continua escrevendo; o telefone repetido no ERP continua bloqueando a ficha | Rejeitada |
| 2 | Um contato por cliente do ERP, mesmo com telefone repetido | Todo cliente abre e vincula | O telefone deixa de ser a chave: quebra a unicidade do contato e a conversa por WhatsApp se parte | Rejeitada |
| 3 | **Vínculo por botão, pelo telefone (escolhida)** | Abrir a ficha não escreve; o telefone segue como chave; o telefone repetido tem tratamento explícito | O atendente dá um clique a mais; o segundo cliente com o mesmo telefone fica sem vínculo | Aceita |

## 4. Consequências

- **Positivas:** consultar não grava; some o erro "há mais de um contato" na maior parte dos casos; a regra de quem é dono do telefone é visível na tela.
- **Negativas:** o cliente só entra no CRM depois do clique; clientes que repetem o telefone no ERP ficam só consultáveis.
- **Obrigações:** o PDV não pode exigir contato vinculado para consultar, e o fluxo de pedido (fases seguintes) precisa decidir o que fazer com cliente sem vínculo. Os vínculos criados pelas fases 1 e 2 permanecem como estão. Duas rotas novas (`POST` e `PATCH` em `/api/v1/pdv/clientes/{erp_id}/vinculo`) e duas ações de auditoria (`pdv.customer.linked`, `pdv.customer.updated`).
