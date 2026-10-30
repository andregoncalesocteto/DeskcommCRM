# Cenários de Teste — Eventos do funil · Etapa 3 · Webhook de entrada (US-031 a US-036)

> Gerado de `docs/ralph/prd.json` e dos documentos de desenho. Fonte de verdade: `test-scenarios.json`.
> Execução: `test-run.html` (artefato). Os resultados voltam ao repositório pelo botão «Copiar resultados (JSON)».

## Preparação do ambiente

**Pré-requisito**

- As Etapas 1 e 2 estão aprovadas. Funil «Pedidos Bella» na organização A com as etapas Conversas · Chamar humano · Visitou o cardápio · Viu um item · Carrinho · Revisão · Compras (ganho) · Cancelado (perda) e o campo declarado «Observação» (chave observacao). {CRM} é o endereço do app.
- Logado como gerente@teste.local (organização A). Atendente: atendente@teste.local.

**A fonte do webhook**

- Em Webhooks › Receber dados, criar a fonte «Pedidos Plataforma»: funil «Pedidos Bella», etapa padrão Compras. Anotar o endereço de recebimento: .../api/v1/webhooks/in/<TOKEN>. Cenários que mudam a fonte dizem como.
- Quando um cenário falar em «reaproveitar o card aberto», ligar essa opção na fonte; ela exige assinatura: configurar o segredo da fonte e assinar os envios do jeito que a própria tela da fonte indica (cabeçalho e algoritmo).

**Envio de exemplo**

- Corpo básico: {"external_id":"PED-100","name":"Cliente Webhook 01","phone":"5511900000101","pedido":{"total":73.9,"forma":"pix"},"itens":[{"item_id":"pizza-1","nome":"Pizza grande","qtd":2}]}. Para cada cenário, trocar external_id e telefone para não colidir com envios anteriores.
- Resposta esperada de sucesso: 200 com {"data":{"lead_id":"..."}}.

**Como conferir o resultado**

- Card: etapa, ganho, valor e campos (abrir o card ou GET /api/v1/leads/{lead_id}: stage, value_cents, custom_fields).
- Log do webhook: Webhooks › Atividade (motivos de valor ou JSON descartados aparecem aqui).
- Quantidade de cards do contato: lista de pedidos do contato ou select count(*) from crm_leads where contact_id = '<id>'.
- Relatórios: arquivo .business/bellacapri/relatorios-bellacapri.sql, rodado com psql -v org=<id da organização> -f relatorios-bellacapri.sql.

## US-031 — Webhook de entrada: valor da venda em value_cents

### Cenário 1 — Valor em reais vira centavos no card novo
`CT-031.1 · FR-25 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Fonte com campo do valor «pedido.total», unidade reais, etapa padrão Compras
- Telefone 5511900000101 sem contato nem card

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo {"external_id":"PED-101","name":"Cliente Webhook 01","phone":"5511900000101","pedido":{"total":73.9}}
2. Abrir o card criado

**Resultado esperado:**
- Resposta 200 com lead_id
- O card está em Compras, ganho, com R$ 73,90 (value_cents 7390)

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Unidade em centavos exige inteiro
`CT-031.2 · FR-25 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Fonte com campo do valor «pedido.total» e unidade centavos

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo com pedido.total 7390 e telefone 5511900000102
2. Repetir com pedido.total 73.9 e telefone 5511900000103

**Resultado esperado:**
- Primeiro envio: card com value_cents 7390
- Segundo envio: 200, card criado sem valor, motivo no log do webhook

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Valor ausente: o card entra sem valor e o motivo vai para o log
`CT-031.3 · FR-25 · integration · alternativo · prioridade alta · heurística: Visibilidade do estado do sistema · automatizável

**Pré-condições:**
- Fonte com campo do valor configurado

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo sem o campo pedido (somente external_id, name e phone 5511900000104)
2. Abrir o card e depois Webhooks › Atividade

**Resultado esperado:**
- Resposta 200
- Card criado em Compras, sem valor
- O log do webhook registra o motivo (valor ausente)

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Valor ilegível ou negativo não derruba o envio
`CT-031.4 · FR-25 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- Fonte com campo do valor configurado

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo com pedido.total «abc» e telefone 5511900000105
2. Repetir com pedido.total -10 e telefone 5511900000106

**Resultado esperado:**
- As duas respostas são 200
- Os dois cards são criados sem valor
- O log registra o motivo de cada um

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Arredondamento, zero e valor muito grande
`CT-031.5 · FR-25 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Fonte em reais

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo com pedido.total 19.999 (telefone ...107)
2. Enviar com pedido.total 0 (telefone ...108)
3. Enviar com pedido.total 99999999.99 (telefone ...109)

**Resultado esperado:**
- 19.999 vira 2000 centavos
- 0 grava valor 0
- 99999999.99 grava 9999999999 (sem teto)

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Card reaproveitado recebe o valor antes de mudar de etapa
`CT-031.6 · FR-25 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Opção «reaproveitar o card aberto» ligada, com assinatura
- Contato «Cliente Bella 02» (telefone 5511900000110) com pedido aberto em Revisão, sem valor, nascido no WhatsApp

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo assinado, com external_id «PED-110», phone 5511900000110 e pedido.total 59.9
2. Contar os cards do contato
3. Abrir o card

**Resultado esperado:**
- A resposta traz o MESMO lead_id do card que já existia
- O contato continua com 1 só card
- O card foi de Revisão para Compras, ganho, com R$ 59,90

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Reenvio idêntico não altera nada
`CT-031.7 · FR-25 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Estado final do CT-031.1 ou CT-031.6

**Steps para reproduzir:**
1. Anotar etapa, valor, campos e o número de atividades do card
2. Enviar o mesmo corpo de novo, com o mesmo external_id
3. Comparar

**Resultado esperado:**
- Resposta 200 com o mesmo lead_id
- Etapa, valor, JSON e número de atividades idênticos aos anotados
- Continua 1 card

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Fonte sem a configuração nova se comporta como antes
`CT-031.8 · FR-25 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Fonte antiga «Pedidos Antigos» sem campo do valor e sem chave de JSON, com etapa padrão Conversas

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo com pedido.total 73.9, itens e telefone 5511900000111

**Resultado esperado:**
- Resposta 200
- Card criado em Conversas, sem valor
- custom_fields não tem a lista de itens nem o bloco pedido (o aninhado é descartado, como sempre foi)

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — Assinatura inválida e token inexistente continuam recusando
`CT-031.9 · FR-25 · integration · nfr (seguranca) · prioridade media · automatizável

**Pré-condições:**
- Fonte com segredo configurado

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo com assinatura errada
2. Enviar para um token que não existe

**Resultado esperado:**
- Assinatura errada: 401
- Token inexistente: 404
- Nenhum card é criado

**Resultado da execução:** ⏳ pendente

---

## US-032 — Webhook de entrada: guardar o JSON do pedido

### Cenário 1 — Itens e blocos aninhados são guardados como vieram
`CT-032.1 · FR-26 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Fonte com a chave de JSON «pedido_json»

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo com pedido.total 73.9, pedido.forma «pix» e itens [{item_id: pizza-1, nome: Pizza grande, qtd: 2}] (telefone ...120)
2. Abrir o card e olhar custom_fields.pedido_json

**Resultado esperado:**
- custom_fields.pedido_json contém o bloco pedido e a lista itens, idênticos ao enviado

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Sem a configuração, o aninhado continua descartado
`CT-032.2 · FR-26 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Fonte com campo do valor mas SEM chave de JSON

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo o mesmo corpo do CT-032.1, telefone ...121

**Resultado esperado:**
- O card é criado
- custom_fields não guarda a lista de itens nem o bloco pedido

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Limite de tamanho do JSON: abaixo passa, acima é recusado no log
`CT-032.3 · FR-26 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Fonte com chave de JSON «pedido_json»

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo com um bloco aninhado de cerca de 31 KB (telefone ...122)
2. Enviar outro com cerca de 33 KB (telefone ...123)
3. Abrir Webhooks › Atividade

**Resultado esperado:**
- 31 KB: o JSON é guardado
- 33 KB: o card é criado SEM o JSON e o log traz o motivo (tamanho acima do limite)
- Os dois envios respondem 200

**Nota:** O limite de 32 KB vem do guia da etapa; o PRD só diz «limite de tamanho».

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Lista vazia e objeto vazio
`CT-032.4 · FR-26 · integration · alternativo · prioridade baixa · automatizável

**Pré-condições:**
- Fonte com chave de JSON

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo com itens [] e pedido {} (telefone ...124)

**Resultado esperado:**
- Resposta 200 e card criado
- Nada quebra; o card guarda o que veio (vazio) ou não guarda nada, o QA anota qual

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Reenvio não altera o JSON guardado
`CT-032.5 · FR-26 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Card do CT-032.1

**Steps para reproduzir:**
1. Reenviar o mesmo corpo
2. Reenviar com itens diferentes e o MESMO external_id
3. Comparar pedido_json

**Resultado esperado:**
- No reenvio idêntico nada muda
- No reenvio com itens diferentes, o comportamento é o da fonte para reenvio (o QA anota se o JSON mudou ou não)

**Nota:** A especificação só garante o reenvio idêntico.

**Resultado da execução:** ⏳ pendente

---

## US-033 — Tela da fonte do webhook: valor e JSON

### Cenário 1 — A fonte mostra a seção «Valor e itens do pedido»
`CT-033.1 · FR-25, FR-26 · e2e · sucesso · prioridade alta

**Pré-condições:**
- Fonte «Pedidos Plataforma» criada

**Steps para reproduzir:**
1. Abrir Webhooks › Receber dados
2. Abrir a fonte «Pedidos Plataforma»
3. Procurar a seção «Valor e itens do pedido»

**Resultado esperado:**
- A seção existe com os campos «Campo do valor do pedido» (com a unidade reais/centavos) e «Guardar os itens e os demais dados aninhados em»
- Cada campo tem uma explicação em linguagem simples

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Salvar e reabrir mantém os valores
`CT-033.2 · FR-25, FR-26 · e2e · sucesso · prioridade alta · heurística: Visibilidade do estado do sistema

**Pré-condições:**
- Seção aberta

**Steps para reproduzir:**
1. Preencher o campo do valor com pedido.total e a unidade reais
2. Preencher o campo dos itens com pedido_json
3. Salvar a fonte, recarregar a página e reabrir a fonte

**Resultado esperado:**
- Os três valores continuam preenchidos

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Aviso: etapa padrão de ganho sem campo do valor
`CT-033.3 · FR-25 · e2e · sucesso · prioridade alta · heurística: Prevenção de erros

**Pré-condições:**
- Fonte com etapa padrão Compras (ganho) e campo do valor VAZIO

**Steps para reproduzir:**
1. Abrir a seção «Valor e itens do pedido»

**Resultado esperado:**
- A tela mostra um aviso dizendo que a venda chegará sem valor
- O aviso não impede salvar

**Nota:** Texto exato do aviso não consta nos insumos; o QA anota o que leu.

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — O aviso some quando faz sentido
`CT-033.4 · FR-25 · e2e · alternativo · prioridade media

**Pré-condições:**
- Mesma fonte, aviso visível

**Steps para reproduzir:**
1. Preencher o campo do valor
2. Em seguida, esvaziar o campo e trocar a etapa padrão para Conversas (não é de ganho)

**Resultado esperado:**
- Com o campo do valor preenchido, o aviso desaparece
- Com etapa padrão que não é de ganho, o aviso também não aparece

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Aviso: a etapa padrão vale para todo envio da fonte
`CT-033.5 · FR-25 · e2e · sucesso · prioridade media · heurística: Correspondência entre o sistema e o mundo real

**Pré-condições:**
- Qualquer fonte aberta

**Steps para reproduzir:**
1. Olhar a área da etapa padrão da fonte

**Resultado esperado:**
- Há um texto explicando que a etapa padrão vale para todo envio daquela fonte

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Chave do JSON igual a campo do funil é bloqueada
`CT-033.6 · FR-26 · e2e · negativo · prioridade alta · heurística: Ajuda para reconhecer e recuperar de erros

**Pré-condições:**
- O funil tem o campo «Observação» (chave observacao)

**Steps para reproduzir:**
1. Preencher «Guardar os itens e os demais dados aninhados em» com observacao
2. Tentar salvar

**Resultado esperado:**
- A tela recusa com mensagem explicando o conflito com o campo do funil
- A fonte não é salva com essa chave

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Esvaziar os campos volta ao comportamento antigo
`CT-033.7 · FR-26 · e2e · alternativo · prioridade media

**Pré-condições:**
- Fonte com valor e JSON configurados

**Steps para reproduzir:**
1. Esvaziar os dois campos e salvar
2. Enviar o corpo do CT-032.1 (telefone novo)

**Resultado esperado:**
- O card é criado sem valor e sem o JSON

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Texto com HTML no nome da fonte aparece como texto
`CT-033.8 · FR-25 · e2e · nfr (seguranca) · prioridade baixa

**Pré-condições:**
- Fonte chamada «<b>x</b><img src=x onerror=alert(1)>»

**Steps para reproduzir:**
1. Abrir a lista de fontes e a fonte

**Resultado esperado:**
- O nome aparece literalmente, sem executar nada

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — Teclado e celular
`CT-033.9 · FR-25 · e2e · nfr (usabilidade) · prioridade baixa

**Pré-condições:**
- Janela em 375 px

**Steps para reproduzir:**
1. Abrir a seção e conferir se cabe
2. Preencher os campos e salvar usando só Tab e Enter

**Resultado esperado:**
- Não há rolagem horizontal da página
- Todos os controles têm foco visível e funcionam pelo teclado

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — Atendente não altera a fonte
`CT-033.10 · FR-25 · e2e · nfr (seguranca) · prioridade media

**Pré-condições:**
- Sessão de atendente@teste.local

**Steps para reproduzir:**
1. Abrir Webhooks › Receber dados e tentar editar a fonte

**Resultado esperado:**
- Não há como salvar mudanças (acesso negado, somente leitura ou seção oculta)

**Nota:** Comportamento exato não está nos insumos; o QA anota o que viu.

**Resultado da execução:** ⏳ pendente

---

## US-034 — Relatórios separados por origem do pedido

### Cenário 1 — O relatório separa os cards por origem
`CT-034.1 · FR-27 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- 3 cards: um nascido no WhatsApp ainda em Conversas, um nascido no WhatsApp e ganho, e um nascido pelo webhook já ganho (CT-031.1)

**Steps para reproduzir:**
1. Rodar psql -v org=<id da organização A> -f .business/bellacapri/relatorios-bellacapri.sql
2. Procurar nas consultas de funil e de conversão a coluna origem

**Resultado esperado:**
- As consultas trazem uma coluna origem com os valores whatsapp, webhook e (para card sem origem) outros
- A linha webhook mostra 1 card ganho; a linha whatsapp mostra 2 cards, 1 ganho

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — A conversão da conversa à compra não conta o card do webhook
`CT-034.2 · FR-27 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Mesmos dados do CT-034.1

**Steps para reproduzir:**
1. Ler a taxa de conversão da conversa à compra do relatório, linha whatsapp

**Resultado esperado:**
- A taxa é 1 compra em 2 conversas (50%), sem contar o card do webhook

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — O arquivo roda só com -v org, sem outros parâmetros
`CT-034.3 · FR-27 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Nenhuma variável além de org definida

**Steps para reproduzir:**
1. Rodar psql -v org=<id> -f relatorios-bellacapri.sql sem nenhum outro -v

**Resultado esperado:**
- Todas as consultas rodam sem erro de variável não definida

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Rodar o relatório não deixa dado no banco
`CT-034.4 · FR-27 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Contar linhas de crm_leads e crm_lead_activities da organização antes

**Steps para reproduzir:**
1. Rodar o relatório
2. Contar de novo

**Resultado esperado:**
- As contagens são idênticas antes e depois

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Sem nenhum card do webhook, a conversão do WhatsApp não muda
`CT-034.5 · FR-27 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Organização com apenas cards nascidos no WhatsApp

**Steps para reproduzir:**
1. Rodar o relatório

**Resultado esperado:**
- Não há linha webhook (ou ela vem zerada)
- A taxa da linha whatsapp é a mesma que o relatório antigo mostrava para essa organização

**Resultado da execução:** ⏳ pendente

---

## US-035 — Provar o webhook de entrada com valor e JSON na stack local

### Cenário 1 — Cliente novo: card em Compras com valor e JSON
`CT-035.1 · FR-25, FR-26 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Fonte com valor «pedido.total» em reais e JSON em «pedido_json»; telefone 5511900000130 sem contato

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/webhooks/in/<TOKEN> com Content-Type: application/json e o corpo {"external_id":"PED-130","name":"Cliente Novo","phone":"5511900000130","pedido":{"total":73.9,"forma":"pix"},"itens":[{"item_id":"pizza-1","qtd":2}]}

**Resultado esperado:**
- Um contato e um card são criados
- O card está em Compras, ganho, R$ 73,90, com pedido_json guardado

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Cliente da Bella em Revisão fecha em um envio, sem duplicar
`CT-035.2 · FR-25 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Opção «reaproveitar o card aberto» ligada, com assinatura
- Contato com pedido aberto em Revisão, nascido no WhatsApp (origem whatsapp)

**Steps para reproduzir:**
1. Enviar o pedido finalizado assinado com o telefone desse contato e pedido.total 59.9
2. Contar os cards do contato e abrir o card

**Resultado esperado:**
- Continua 1 só card
- Ele foi para Compras, ganho, com R$ 59,90 e JSON
- A origem do card continua whatsapp

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Contato conhecido sem card aberto recebe um card novo
`CT-035.3 · FR-25 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Contato com um card antigo já ganho e nenhum aberto

**Steps para reproduzir:**
1. Enviar um pedido finalizado com o telefone desse contato

**Resultado esperado:**
- O contato passa a ter 2 cards: o antigo intacto e um novo em Compras com o valor do envio

**Resultado da execução:** ⏳ pendente

---

## US-036 — Documentação e release da etapa 3

### Cenário 1 — Mesma compra pelo rastreador e depois pelo webhook gera dois cards
`CT-036.1 · FR-25, FR-21 · e2e · alternativo · prioridade alta

**Pré-condições:**
- Etapa 2 pronta (chave e página de teste)
- Cliente com pedido aberto em Revisão, com carrinho gravado
- Opção «reaproveitar o card aberto» ligada

**Steps para reproduzir:**
1. Pela página de teste (?idtrack do contato), clicar em «Comprar» (order_id P-1042): o card fecha em Compras
2. Em seguida, enviar pelo webhook a mesma compra (mesmo telefone, valor 73.9)
3. Contar os cards do contato em Compras

**Resultado esperado:**
- O contato fica com DOIS cards em Compras (o fechado pelo rastreador e um novo criado pelo webhook)

**Nota:** Limite documentado em docs/integracao/webhook-ou-rastreador.md: o produto não reconhece a mesma compra nas duas portas. O cenário existe para o QA confirmar que o comportamento é exatamente o descrito, e para a equipe decidir se muda.

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Mesma compra pelo webhook e depois pelo rastreador não duplica o card
`CT-036.2 · FR-25, FR-21 · e2e · alternativo · prioridade alta

**Pré-condições:**
- Cliente com pedido aberto em Revisão
- Opção «reaproveitar o card aberto» ligada

**Steps para reproduzir:**
1. Enviar pelo webhook a compra (valor 73.9): o card fecha em Compras
2. Pela página de teste (?idtrack do contato), clicar em «Comprar»
3. Contar os cards do contato e olhar o valor

**Resultado esperado:**
- Continua 1 só card em Compras com R$ 73,90
- O valor não dobra

**Nota:** O guia diz que a compra do navegador «só registra o evento» e que o histórico mostra a compra duas vezes; isso depende da pergunta em aberto sobre pedido encerrado (ver coverage.blockedByOpenQuestions). O QA anota se a compra do navegador apareceu na linha do tempo.

**Resultado da execução:** ⏳ pendente

---

## Cobertura

| Story | Requisitos | Cenários | Camadas | Última rodada | Observação |
|---|---|---|---|---|---|
| US-031 | FR-25 | CT-031.1 … CT-031.9 (9) | 9i / 0e2e | 9⏳ | — |
| US-032 | FR-26 | CT-032.1 … CT-032.5 (5) | 5i / 0e2e | 5⏳ | — |
| US-033 | FR-25, FR-26 | CT-033.1 … CT-033.10 (10) | 0i / 10e2e | 10⏳ | — |
| US-034 | FR-27 | CT-034.1 … CT-034.5 (5) | 5i / 0e2e | 5⏳ | — |
| US-035 | FR-25, FR-26 | CT-035.1 … CT-035.3 (3) | 3i / 0e2e | 3⏳ | — |
| US-036 | FR-21, FR-25 | CT-036.1 … CT-036.2 (2) | 0i / 2e2e | 2⏳ | — |

### Histórias sem cenário
- US-036: A parte documental (nota de versão e guia com a tabela «quando usar cada porta») é conferida por pnpm release:conferir e por revisão; só o comportamento de duplicidade entre as duas portas virou cenário (CT-036.1 e CT-036.2).

### Requisitos sem cenário
- nenhum

### Fora de escopo (Non-Goals do PRD)
- Aplicar o campo stage do JSON do webhook na criação do card: hoje só vale a etapa padrão da fonte.
- Pico de envios simultâneos do mesmo external_id (a prova do mantenedor também não cobre).
- Fonte sem assinatura com «reaproveitar o card aberto» ligado (só liga com assinatura).

### Bloqueado por perguntas em aberto
- Pergunta 5 do PRD: compra duplicada entre rastreador e webhook. O CT-036.1 documenta o comportamento atual; se a regra mudar, o cenário muda.
- Pergunta 6 do PRD: um aviso por tipo de pedido (a fonte hoje leva todo envio à mesma etapa). Fora deste conjunto.
- Pedido encerrado e rastreador (mesma dúvida do conjunto do Rastreador): decide o resultado esperado do CT-036.2.

### Comportamento não documentado encontrado
- nenhum
