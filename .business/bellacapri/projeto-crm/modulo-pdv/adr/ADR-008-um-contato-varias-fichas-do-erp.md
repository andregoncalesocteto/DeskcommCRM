# ADR-008: Um contato do CRM pode ter várias fichas do ERP, e o atendente escolhe se sobrescreve

Status: Aceito
Data: 2026-11-18
Aceito em: 2026-11-18, pelo dono do projeto
Altera parcialmente: [ADR-007](ADR-007-vinculo-do-contato-por-acao-do-atendente.md) (a regra "o contato do número que já é de outro cliente do ERP é recusado") e a unicidade do vínculo por contato do [ADR-002](ADR-002-cliente-mestre-no-erp.md). O ERP segue como cadastro mestre, o telefone segue como chave do contato e abrir a ficha segue só lendo.
Origem da decisão: o dono do projeto, ao testar o ADR-007 com dois clientes do ERP no mesmo telefone: a ficha mais completa ficou sem vínculo, porque a menos completa chegou primeiro.

## 1. Contexto

- O ERP duplica a mesma pessoa (e às vezes junta pessoas diferentes no mesmo telefone). Pelo ADR-007, a primeira ficha a vincular ficava com o contato e as outras só podiam ser consultadas.
- Sem vínculo não há pedido no PDV (fases seguintes): a ficha precisa estar ligada a um contato para o pedido nascer com conversa, funil e LGPD.
- O CRM não guarda a ficha do ERP; guarda o contato (nome, telefone, e-mail, CPF cifrado e nascimento) e o ponteiro `pdv_customer_links`.
- O banco limitava o vínculo a **um contato por cliente do ERP e um cliente do ERP por contato**.

## 2. Decisão

Vamos permitir que **um contato tenha várias fichas do ERP**, e deixar o **atendente escolher, a cada vínculo, se o ERP sobrescreve os dados do contato**.

Regras:

- O vínculo continua único por cliente do ERP (por organização). A unicidade por contato cai.
- Na ficha cujo telefone já tem contato, dois botões: **Vincular** só liga e não altera o contato; **Atualizar e vincular** liga e o ERP sobrescreve nome, e-mail, CPF e nascimento do contato, **com confirmação** que cita o nome atual do contato. O telefone nunca muda.
- Sem contato no telefone, o botão **Vincular** cria o contato com os dados do ERP e liga.
- A ficha avisa quando o contato já está ligado a outras fichas e a quantas.
- Não há regra automática de merge nem limite de fichas por contato.
- CPF ou e-mail que já pertencem a outro contato ficam de fora e a tela avisa, como no ADR-007.
- Dois contatos no mesmo número (grafias com e sem o nono dígito) continuam bloqueando até um gerente unir os contatos.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | Manter um contato por ficha, primeira vincula fica (ADR-007) | Sem mudança de schema | A ficha completa pode ficar sem vínculo e sem pedido | Rejeitada |
| 2 | Botão "trocar vínculo" que passa o contato de uma ficha para outra | Sem mudança de schema | A ficha que perde o vínculo fica sem pedido; é uma troca, não uma soma | Rejeitada |
| 3 | Várias fichas por contato, merge automático (preencher só o vazio) | Nenhuma decisão do atendente | Mistura dados quando o telefone é de pessoas diferentes; regra opaca | Rejeitada |
| 4 | **Várias fichas por contato, o atendente escolhe sobrescrever (escolhida)** | Toda ficha vinculável; o que muda no contato é decisão visível e confirmada | Migration de schema; o contato reflete a última ficha que sobrescreveu | Aceita |

## 4. Consequências

- **Positivas:** toda ficha do ERP pode ser vinculada e usada num pedido; o telefone repetido deixa de bloquear; a escolha de sobrescrever é do atendente.
- **Negativas:** o contato pode refletir dados de uma ficha e ter outras ligadas; o nome do contato pode ser trocado por engano (mitigado pela confirmação).
- **Obrigações:** migration que remove a unicidade `pdv_customer_links_org_contact_unico` (a `9422`), com apêndice no baseline; o pedido do PDV deve gravar **a ficha do ERP escolhida**, não deduzi-la do contato; anonimizar o contato vale para todas as fichas ligadas a ele.
