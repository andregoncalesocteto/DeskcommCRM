# Cenários de Teste — Eventos do funil · Etapa 2 · Rastreador (US-020 a US-030)

> Gerado de `docs/ralph/prd.json` e dos documentos de desenho. Fonte de verdade: `test-scenarios.json`.
> Execução: `test-run.html` (artefato). Os resultados voltam ao repositório pelo botão «Copiar resultados (JSON)».

## Preparação do ambiente

**Pré-requisito**

- A Etapa 1 (Núcleo) está aprovada: o funil «Pedidos Bella» existe na organização A, com as etapas Conversas · Chamar humano · Visitou o cardápio · Viu um item · Carrinho · Revisão · Compras (ganho) · Cancelado (perda), e os 5 eventos de referência cadastrados à mão (page_view, view_item, cart_sync, begin_checkout, purchase; purchase com campo do valor value em reais, chave de repetição order_id e «respeitar movimento manual» desligado).
- Usuários da organização A: gerente@teste.local, atendente@teste.local, leitor@teste.local. Da B: gerente-b@teste.local. {CRM} é o endereço do app (ex.: http://localhost:3000).
- Contato «Cliente Teste 01» com pedido aberto em Conversas no funil «Pedidos Bella». Anotar o id do CONTATO (é ele o idtrack) e o id do pedido. Daqui em diante: ID_C1 (contato) e L1 (pedido). Para cada cenário que pedir «um cliente novo», criar outro contato com pedido aberto em Conversas.

**A chave do rastreador**

- Criar uma chave pela tela (CT-028.1) com o nome «Cardápio Teste» e os sites http://localhost:5555 e http://localhost:3000. Anotar o valor pk_… como CHAVE. Cenários que usam outra chave dizem qual.

**O site de teste (outra origem)**

- Criar uma pasta com o arquivo cardapio-teste.html e servi-la na porta 5555 (cd pasta && python3 -m http.server 5555). A porta 5555 é uma origem diferente da do CRM, de propósito.
- Conteúdo do arquivo: uma página com <head> contendo, no lugar indicado, o código copiado da tela (CT-028.1), e no <body> cinco botões que chamam: rastreador('track','page_view',{screen_name:'home'}) · rastreador('track','view_item',{item_id:'pizza-1',item_name:'Pizza grande',price:59.9}) · rastreador('track','cart_sync',{items:[{item_id:'pizza-1',item_name:'Pizza grande',price:59.9,quantity:1}]}) · rastreador('track','begin_checkout',{value:73.9,item_count:1,delivery_type:'delivery'}) · rastreador('track','purchase',{order_id:'P-1042',value:73.9,payment_method:'pix'}).
- Abrir sempre como http://localhost:5555/cardapio-teste.html?idtrack=<ID_C1>, com as Ferramentas do Desenvolvedor abertas nas abas Console, Network e Application.

**Como chamar a porta pública e a API**

- Porta pública: POST {CRM}/api/v1/coleta/<CHAVE>, sem login, corpo {"idtrack":"<uuid do contato>","events":[{"event":"page_view","event_id":"<uuid>","data":{...}}]}. Pelo Postman/curl, enviar também o cabeçalho Origin quando o cenário pedir.
- API de chaves: rotas /api/v1/pipelines/{id}/tracker-keys, com o cookie de sessão do gerente (copiar do navegador: DevTools › Application › Cookies).
- Como conferir o resultado: card do pedido (etapa, valor, campos) e linha do tempo; ou GET /api/v1/leads/{id}. Banco, quando o cenário pedir: tabela crm_lead_activities (campo payload).

## US-020 — Tabela de chaves públicas do rastreador

### Cenário 1 — A chave decide organização e funil; o corpo não
`CT-020.1 · FR-18 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Segundo funil «Agenda» na organização A, com um pedido aberto do mesmo contato ID_C1 (L2) e o evento page_view cadastrado
- CHAVE pertence ao funil «Pedidos Bella»

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"page_view","event_id":"<uuid>","pipeline_id":"<id do funil Agenda>","organization_id":"<id da org B>"}]} (com pipeline_id e organization_id extras)
2. Olhar os pedidos L1 e L2

**Resultado esperado:**
- Nenhum evento é registrado em L2 nem na organização B
- Ou a chamada é recusada por validação, ou o evento vai só para o funil da chave (L1)

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Gerente de outra organização não vê nem revoga chaves alheias
`CT-020.2 · FR-18 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- CHAVE criada na organização A
- Sessão de gerente-b@teste.local

**Steps para reproduzir:**
1. Enviar GET /api/v1/pipelines/{id do funil da A}/tracker-keys como gerente da B
2. Enviar a revogação da chave da A como gerente da B

**Resultado esperado:**
- Nas duas chamadas: 404
- A chave da A continua ativa (o código de instalação segue funcionando)

**Resultado da execução:** ⏳ pendente

---

## US-021 — API de gerenciamento das chaves públicas

### Cenário 1 — Criar, listar e revogar a chave pela API
`CT-021.1 · FR-18 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Sessão de gerente@teste.local

**Steps para reproduzir:**
1. Enviar POST em /api/v1/pipelines/{id}/tracker-keys com {"name":"Cardápio API","allowed_origins":["https://cardapio.minhaloja.com.br"]}
2. Enviar GET da lista
3. Enviar a revogação dessa chave
4. Enviar GET da lista de novo
5. Conferir api_audit_log

**Resultado esperado:**
- O POST devolve a chave (pk_…)
- O primeiro GET lista a chave como ativa
- Depois da revogação a lista mostra a chave como revogada
- api_audit_log tem uma linha para a criação e outra para a revogação

**Nota:** Os nomes dos campos do corpo seguem o contrato da rota; se divergirem, o QA anota o corpo que funcionou.

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Sites permitidos: o que é aceito e o que é recusado
`CT-021.2 · FR-18 · integration · negativo · prioridade alta · heurística: Prevenção de erros · automatizável

**Pré-condições:**
- Sessão de gerente@teste.local

**Steps para reproduzir:**
1. Criar chave com site https://cardapio.minhaloja.com.br
2. Criar chave com site http://localhost:3000
3. Criar chave com site http://cardapio.minhaloja.com.br (http fora do localhost)
4. Criar chave com site https://cardapio.minhaloja.com.br/menu (com caminho)
5. Criar chave com a lista de sites vazia
6. Criar chave com site «*»

**Resultado esperado:**
- Os dois primeiros são aceitos
- Os quatro últimos são recusados por validação

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Atendente e visualizador não gerenciam chaves
`CT-021.3 · FR-18 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Sessões de atendente@teste.local e leitor@teste.local

**Steps para reproduzir:**
1. Como atendente, enviar POST de criação
2. Como visualizador, enviar GET da lista
3. Sem cookie, enviar GET da lista

**Resultado esperado:**
- Atendente: 403 · visualizador: 403 · sem cookie: 401

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — A organização vem da sessão, não do corpo
`CT-021.4 · FR-18 · integration · nfr (seguranca) · prioridade media · automatizável

**Pré-condições:**
- Sessão de gerente@teste.local

**Steps para reproduzir:**
1. Enviar POST de criação com organization_id da B no corpo
2. Listar as chaves como gerente-b@teste.local

**Resultado esperado:**
- A chave nunca aparece para a organização B

**Resultado da execução:** ⏳ pendente

---

## US-022 — Porta pública de coleta: rota, chave e CORS

### Cenário 1 — Pré-checagem (OPTIONS) de origem permitida
`CT-022.1 · FR-19 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- CHAVE com o site http://localhost:5555 permitido

**Steps para reproduzir:**
1. Enviar OPTIONS {CRM}/api/v1/coleta/<CHAVE> com os cabeçalhos Origin: http://localhost:5555 e Access-Control-Request-Method: POST

**Resultado esperado:**
- Resposta 204 com Access-Control-Allow-Origin igual a http://localhost:5555 (nunca «*»)

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Origem não permitida não recebe cabeçalhos de CORS
`CT-022.2 · FR-19 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- CHAVE com http://localhost:5555 permitido, mas não https://site-malvado.example

**Steps para reproduzir:**
1. Enviar OPTIONS à porta com Origin: https://site-malvado.example
2. Enviar POST com um evento válido e Origin: https://site-malvado.example
3. Olhar o pedido L1

**Resultado esperado:**
- Nenhuma das respostas traz Access-Control-Allow-Origin
- O evento do POST não é registrado em L1

**Nota:** Se o evento for registrado mesmo sem CORS, o QA reprova o cenário e anota.

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Enviar eventos de origem permitida
`CT-022.3 · FR-18 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- CHAVE ativa; page_view cadastrado; L1 aberto em Conversas

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"page_view","event_id":"11111111-1111-4111-8111-111111111111","data":{"screen_name":"home"}}]}
2. Abrir o card de L1

**Resultado esperado:**
- Resposta 200 com Access-Control-Allow-Origin: http://localhost:5555
- L1 vai para «Visitou o cardápio» e a linha do tempo ganha o registro

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Chave revogada ou desconhecida é recusada
`CT-022.4 · FR-18 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- Uma chave REVOGADA (REV) e o texto «pk_naoexiste»

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<REV> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"page_view","event_id":"<uuid>"}]}
2. Repetir com a chave pk_naoexiste

**Resultado esperado:**
- As duas respostas são de erro (sem sucesso)
- L1 não muda e a linha do tempo não ganha registro
- As respostas não trazem cabeçalhos de CORS

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Lote de 20 eventos passa, 21 e 0 não
`CT-022.5 · FR-19 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- CHAVE ativa; page_view cadastrado

**Steps para reproduzir:**
1. Enviar um lote com 20 eventos page_view (uuids diferentes)
2. Enviar um lote com 21 eventos
3. Enviar um lote com events vazio

**Resultado esperado:**
- 20: aceito
- 21: recusado por validação, sem efeito
- 0: recusado por validação

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Corpo inválido é recusado
`CT-022.6 · FR-19 · integration · negativo · prioridade media · automatizável

**Pré-condições:**
- CHAVE ativa

**Steps para reproduzir:**
1. Enviar corpo que não é JSON (texto «abc»)
2. Enviar {"events":[]} sem idtrack
3. Enviar {"idtrack":"<ID_C1>","events":"page_view"}
4. Enviar GET à mesma rota

**Resultado esperado:**
- Os três primeiros: erro de validação (4xx)
- GET: método não permitido
- Nenhum evento é registrado

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Evento não cadastrado no funil não tem efeito
`CT-022.7 · FR-19 · integration · negativo · prioridade media · automatizável

**Pré-condições:**
- CHAVE ativa; evento «cupom_xpto» NÃO cadastrado

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"cupom_xpto","event_id":"<uuid>"}]}
2. Olhar a linha do tempo de L1

**Resultado esperado:**
- Nenhum registro novo e nenhuma mudança de etapa em L1

**Resultado da execução:** ⏳ pendente

---

## US-023 — Porta pública de coleta: limite de taxa e resposta sem vazamento

### Cenário 1 — Limite de taxa por visitante: 60 por minuto
`CT-023.1 · FR-19 · integration · nfr (desempenho) · prioridade alta · automatizável

**Pré-condições:**
- CHAVE ativa; um único IP de origem; nenhum envio no último minuto

**Steps para reproduzir:**
1. Enviar 60 chamadas em menos de 1 minuto (Postman Runner), cada uma com 1 evento page_view de event_id novo
2. Enviar a 61ª chamada

**Resultado esperado:**
- As 60 primeiras são aceitas
- A 61ª recebe 429 com o cabeçalho Retry-After
- A resposta 429 traz Access-Control-Allow-Origin da origem permitida

**Nota:** O guia fala em 60 por minuto por visitante e 1.200 por minuto por chave; este cenário confere o primeiro.

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — A resposta tem a mesma forma para idtrack inexistente, sem pedido e válido
`CT-023.2 · FR-18 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- ID_SEM_PEDIDO: contato sem nenhum pedido aberto
- Um UUID que não corresponde a nenhum contato (00000000-0000-4000-8000-000000000000)
- ID_C1 com pedido aberto

**Steps para reproduzir:**
1. Enviar a mesma chamada (mesmo event_id «e-1» de page_view) com cada um dos três idtrack
2. Comparar status e corpo das três respostas

**Resultado esperado:**
- Os três status são iguais
- Os três corpos são idênticos
- Nada na resposta mostra se o contato ou o pedido existe

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — A resposta nunca traz dado pessoal nem de funil
`CT-023.3 · FR-18 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- ID_C1 com telefone e nome cadastrados

**Steps para reproduzir:**
1. Enviar um page_view válido para ID_C1
2. Ler o corpo inteiro da resposta

**Resultado esperado:**
- O corpo não contém o nome, o telefone nem o e-mail do contato
- O corpo não contém etapa, valor nem ids de pedido

**Resultado da execução:** ⏳ pendente

---

## US-024 — Identificar o pedido pelo idtrack

### Cenário 1 — UUID de contato com pedido aberto registra no pedido
`CT-024.1 · FR-20 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- ID_C1 com L1 aberto no funil da chave

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"page_view","event_id":"<uuid>"}]}

**Resultado esperado:**
- O registro aparece na linha do tempo de L1

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Contato sem pedido aberto: nada é criado
`CT-024.2 · FR-20 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- Contato ID_SEM_PEDIDO sem pedido aberto; contar os pedidos da organização antes

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_SEM_PEDIDO>","events":[{"event":"page_view","event_id":"<uuid>"}]}
2. Contar os pedidos da organização de novo

**Resultado esperado:**
- A quantidade de pedidos não muda
- Nenhuma atividade nova aparece para esse contato

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Telefone no lugar do idtrack é descartado
`CT-024.3 · FR-20 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- L1 aberto; telefone do contato 5511900000001

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"5511900000001","events":[{"event":"page_view","event_id":"<uuid>"}]}
2. Repetir com idtrack «abc» e com um UUID com um caractere a menos

**Resultado esperado:**
- As três chamadas não têm efeito em L1
- As respostas não explicam o motivo do descarte

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Contato pessoal é descartado
`CT-024.4 · FR-20 · integration · nfr (seguranca) · prioridade media · automatizável

**Pré-condições:**
- Contato pessoal com pedido aberto

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID do contato pessoal>","events":[{"event":"page_view","event_id":"<uuid>"}]}

**Resultado esperado:**
- Nada é registrado no pedido desse contato

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Com vários pedidos abertos, vale o mais recente
`CT-024.5 · FR-20 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Contato com 2 pedidos abertos no funil da chave: o mais antigo (LA) e o criado depois (LB)

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID do contato>","events":[{"event":"page_view","event_id":"<uuid>"}]}

**Resultado esperado:**
- O registro aparece em LB
- LA não ganha nada

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Pedido aberto só em outro funil: descartado
`CT-024.6 · FR-20 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- Contato cujo único pedido aberto está no funil «Agenda»

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID desse contato>","events":[{"event":"page_view","event_id":"<uuid>"}]}

**Resultado esperado:**
- Nenhum registro no pedido do funil «Agenda»
- Nenhum pedido novo no funil «Pedidos Bella»

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — idtrack de um contato de outra organização é descartado
`CT-024.7 · FR-20 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Contato da organização B com pedido aberto (ID_B)

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_B>","events":[{"event":"page_view","event_id":"<uuid>"}]} usando a CHAVE da organização A

**Resultado esperado:**
- Nada é registrado na organização B
- A resposta é igual à de um idtrack inexistente

**Resultado da execução:** ⏳ pendente

---

## US-025 — Regras de confiança para evento vindo do navegador

### Cenário 1 — Todo evento do navegador é marcado com a origem
`CT-025.1 · FR-21 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- CHAVE ativa; L1 aberto

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"page_view","event_id":"<uuid>"}]}
2. Consultar a atividade criada: select payload from crm_lead_activities where lead_id = '<L1>' order by created_at desc limit 1

**Resultado esperado:**
- O payload da atividade contém origem «navegador»

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Compra do navegador sem estado antes não fecha o pedido
`CT-025.2 · FR-21 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- L1 em Conversas, sem nenhum cart_sync nem begin_checkout

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"purchase","event_id":"<uuid>","data":{"order_id":"PED-N1","value":73.9}}]}
2. Abrir o card de L1

**Resultado esperado:**
- O card continua em Conversas, sem valor
- A compra aparece registrada na linha do tempo

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Só visitar a página não conta como estado
`CT-025.3 · FR-21 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- L1 em Conversas
- Cadastro ajustado só para este cenário: view_item SEM «guardar em» (page_view também não guarda nada); nenhum cart_sync nem begin_checkout enviado
- Enviados antes, pela porta, apenas um page_view e um view_item

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"purchase","event_id":"<uuid>","data":{"order_id":"PED-N2","value":50}}]}

**Resultado esperado:**
- A compra fica só registrada e o card não vai a Compras

**Nota:** A trava olha eventos de estado (os que guardam conteúdo); por isso o cadastro é ajustado na pré-condição.

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Compra do navegador depois de um carrinho fecha o pedido
`CT-025.4 · FR-21 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- L1 em Conversas

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"cart_sync","event_id":"<uuid1>","data":{"items":[{"item_id":"pizza-1","quantity":1}]}}]}
2. Enviar begin_checkout com value 73.9
3. Enviar purchase com order_id PED-OK e value 73.9

**Resultado esperado:**
- O card termina em Compras, ganho, com R$ 73,90

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Mesma compra com outro event_id é repetição
`CT-025.5 · FR-21 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- L1 já fechado por um purchase com order_id PED-OK

**Steps para reproduzir:**
1. Enviar purchase com order_id PED-OK e event_id novo
2. Olhar a linha do tempo

**Resultado esperado:**
- Não aparece segunda compra
- Valor e etapa do card não mudam

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Pedido encerrado não é alterado pelo navegador
`CT-025.6 · FR-12 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- L1 fechado em Compras com R$ 73,90

**Steps para reproduzir:**
1. Enviar cart_sync com itens diferentes e begin_checkout com value 5 pela porta
2. Olhar o card

**Resultado esperado:**
- Etapa, valor (R$ 73,90) e carrinho do card não mudam
- Nenhum pedido novo é criado

**Nota:** Se o idtrack só enxerga pedido ABERTO, o evento é simplesmente descartado; o QA anota se ele ficou ou não na linha do tempo. Ver coverage.blockedByOpenQuestions.

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Cancelamento não existe na porta pública
`CT-025.7 · FR-22 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- L1 em Carrinho
- Evento «cancelou» NÃO cadastrado

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"cancelou","event_id":"<uuid>","data":{"order_id":"PED-C"}}]}

**Resultado esperado:**
- L1 continua em Carrinho, aberto
- Nenhuma mudança de etapa para Cancelado

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Compra com valor inválido pelo navegador não grava nada
`CT-025.8 · FR-21 · integration · nfr (seguranca) · prioridade media · automatizável

**Pré-condições:**
- L1 em Revisão (com carrinho já gravado)

**Steps para reproduzir:**
1. enviar POST {CRM}/api/v1/coleta/<CHAVE> com o cabeçalho Origin: http://localhost:5555 e o corpo {"idtrack":"<ID_C1>","events":[{"event":"purchase","event_id":"<uuid>","data":{"order_id":"PED-NEG","value":-10}}]}

**Resultado esperado:**
- L1 continua em Revisão e sem valor novo

**Resultado da execução:** ⏳ pendente

---

## US-026 — Script do rastreador: inicialização, fila e envio em lote

### Cenário 1 — O script é um arquivo estático sem dependências
`CT-026.1 · FR-23 · integration · sucesso · prioridade media · automatizável

**Pré-condições:**
- App no ar

**Steps para reproduzir:**
1. Abrir {CRM}/rastreador.js no navegador
2. Abrir cardapio-teste.html?idtrack=<ID_C1> com a aba Network aberta e recarregar

**Resultado esperado:**
- O arquivo abre como JavaScript (status 200)
- Na aba Network, só aparecem pedidos ao {CRM} e à própria página (nenhum domínio de terceiros)
- O Console não mostra erro

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Eventos rápidos viajam juntos em um lote
`CT-026.2 · FR-23 · e2e · sucesso · prioridade alta

**Pré-condições:**
- Página de teste aberta com ?idtrack=<ID_C1>; aba Network filtrada por «coleta»

**Steps para reproduzir:**
1. Clicar nos cinco botões, um depois do outro, em menos de 3 segundos
2. Esperar 4 segundos

**Resultado esperado:**
- Aparece UMA só requisição POST para /api/v1/coleta/<CHAVE>
- O corpo dessa requisição tem 5 eventos, cada um com event_id (UUID)

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Lote de no máximo 20 eventos
`CT-026.3 · FR-23 · e2e · alternativo · prioridade media

**Pré-condições:**
- Página de teste aberta; Console aberto

**Steps para reproduzir:**
1. No Console, executar: for (let i=0;i<25;i++) rastreador('track','page_view',{screen_name:'t'+i})
2. Esperar 8 segundos olhando a aba Network

**Resultado esperado:**
- Aparecem requisições à porta com no máximo 20 eventos cada (20 + 5, ou equivalente)
- Nenhum evento é enviado duas vezes

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Evento enviado ao sair da página
`CT-026.4 · FR-23 · e2e · alternativo · prioridade media

**Pré-condições:**
- Página de teste aberta

**Steps para reproduzir:**
1. Clicar no botão «Ver item» e, em menos de 1 segundo, fechar a aba
2. Abrir o card de L1 e olhar a linha do tempo

**Resultado esperado:**
- O view_item aparece registrado em L1 mesmo sem esperar os 3 segundos

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Falha de rede: o evento é reenviado com o mesmo event_id
`CT-026.5 · FR-23 · e2e · alternativo · prioridade alta · heurística: Controle e liberdade do usuário

**Pré-condições:**
- Página de teste aberta; Network aberta

**Steps para reproduzir:**
1. Em Network, marcar «Offline»
2. Clicar em «Ver item»
3. Esperar 5 segundos, desmarcar «Offline» e esperar 10 segundos

**Resultado esperado:**
- O evento é reenviado quando a rede volta
- O event_id da nova tentativa é o mesmo da primeira
- L1 tem um só registro desse view_item

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — CRM fora do ar: reenvia só em falha de servidor
`CT-026.6 · FR-23 · e2e · alternativo · prioridade media

**Pré-condições:**
- Página de teste aberta

**Steps para reproduzir:**
1. Parar o app do CRM (por exemplo docker stop do serviço app)
2. Clicar em «Ver item»
3. Esperar 10 segundos e subir o app de novo
4. Esperar mais 20 segundos

**Resultado esperado:**
- Durante a queda, o script faz novas tentativas espaçadas
- Depois que o CRM volta, o evento é entregue uma vez
- A página do cardápio continua funcionando o tempo todo

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Evento recusado não é reenviado
`CT-026.7 · FR-23 · e2e · alternativo · prioridade alta

**Pré-condições:**
- Evento «cupom_xpto» não cadastrado; página de teste aberta com debug ligado

**Steps para reproduzir:**
1. No Console, executar rastreador('track','cupom_xpto',{})
2. Esperar 15 segundos olhando a aba Network

**Resultado esperado:**
- Há exatamente uma requisição com esse evento
- Não aparecem novas tentativas

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Erros do script nunca quebram a página
`CT-026.8 · FR-23 · e2e · negativo · prioridade alta · heurística: Prevenção de erros

**Pré-condições:**
- Página de teste aberta

**Steps para reproduzir:**
1. No Console, executar rastreador('track')
2. Executar rastreador('track', null, undefined)
3. Executar const o={}; o.o=o; rastreador('track','view_item',o)
4. Clicar nos botões da página

**Resultado esperado:**
- O Console não mostra erro sem tratamento (Uncaught)
- Os botões da página continuam funcionando

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — O script não observa a página sozinho
`CT-026.9 · FR-23 · e2e · alternativo · prioridade media

**Pré-condições:**
- Página de teste aberta; Network filtrada por «coleta»

**Steps para reproduzir:**
1. No Console, executar window.dataLayer = window.dataLayer || []; dataLayer.push({event:'purchase'})
2. Adicionar a um botão da página o atributo data-evento="purchase" e clicar nele
3. Esperar 5 segundos

**Resultado esperado:**
- Nenhuma requisição à porta é feita

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — Chave inexistente ou revogada não quebra a página
`CT-026.10 · FR-23 · e2e · negativo · prioridade media

**Pré-condições:**
- Página de teste com a chave trocada por pk_naoexiste

**Steps para reproduzir:**
1. Abrir a página com ?idtrack=<ID_C1>
2. Clicar em «Ver item»
3. Esperar 30 segundos olhando o Console

**Resultado esperado:**
- A página funciona normalmente
- O script desiste depois de poucas tentativas (no máximo 5, com espera crescente)
- Nada é registrado no CRM

**Resultado da execução:** ⏳ pendente

---

## US-027 — Script do rastreador: idtrack, privacidade e depuração

### Cenário 1 — idtrack válido: envia e guarda na sessão do navegador
`CT-027.1 · FR-20, FR-24 · e2e · sucesso · prioridade alta

**Pré-condições:**
- Página de teste; aba Application aberta

**Steps para reproduzir:**
1. Abrir cardapio-teste.html?idtrack=<ID_C1>
2. Em Application › Session Storage, olhar a origem http://localhost:5555
3. Clicar em «Ver item»

**Resultado esperado:**
- Há uma entrada na sessão guardando o idtrack
- O view_item chega ao CRM (linha do tempo de L1)

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Páginas seguintes da mesma aba continuam enviando
`CT-027.2 · FR-20 · e2e · alternativo · prioridade media

**Pré-condições:**
- Passo anterior feito (idtrack guardado)

**Steps para reproduzir:**
1. Na mesma aba, abrir http://localhost:5555/cardapio-teste.html (sem ?idtrack)
2. Clicar em «Ver item»

**Resultado esperado:**
- O evento é enviado usando o idtrack da sessão

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Sem idtrack: nada é enviado nem guardado
`CT-027.3 · FR-20 · e2e · nfr (seguranca) · prioridade alta

**Pré-condições:**
- Aba nova, sem nada em Session Storage

**Steps para reproduzir:**
1. Abrir http://localhost:5555/cardapio-teste.html sem ?idtrack
2. Clicar em todos os botões
3. Esperar 5 segundos

**Resultado esperado:**
- Nenhuma requisição à porta
- Nada é guardado em Session Storage nem Local Storage

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — idtrack que não é UUID é ignorado
`CT-027.4 · FR-20 · e2e · nfr (seguranca) · prioridade alta

**Pré-condições:**
- Aba nova

**Steps para reproduzir:**
1. Abrir …/cardapio-teste.html?idtrack=11999999999 e clicar nos botões
2. Repetir com ?idtrack=abc
3. Repetir com ?idtrack=joao@email.com

**Resultado esperado:**
- Nas três tentativas: nenhuma requisição e nada guardado

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — storage:false: nada fica no navegador
`CT-027.5 · FR-24 · e2e · nfr (seguranca) · prioridade alta

**Pré-condições:**
- Página de teste com o código de instalação alterado para incluir storage:false na inicialização

**Steps para reproduzir:**
1. Abrir …/cardapio-teste.html?idtrack=<ID_C1>
2. Clicar em «Ver item»
3. Olhar Session Storage, Local Storage e Cookies

**Resultado esperado:**
- O evento chega ao CRM
- Não há nenhuma entrada do rastreador em Session Storage, Local Storage ou Cookies

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — optOut apaga o que foi guardado e para o envio
`CT-027.6 · FR-24 · e2e · sucesso · prioridade alta · heurística: Controle e liberdade do usuário

**Pré-condições:**
- Página de teste aberta com ?idtrack=<ID_C1> e idtrack já guardado

**Steps para reproduzir:**
1. No Console, executar rastreador('optOut')
2. Olhar Session Storage e Local Storage
3. Clicar em «Ver item»
4. Recarregar a página (com o ?idtrack ainda na URL) e clicar em «Ver item»

**Resultado esperado:**
- O idtrack some da sessão
- Aparece o marcador rastreador_optout em Local Storage
- Nenhuma requisição à porta, nem depois de recarregar

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — optIn volta a enviar
`CT-027.7 · FR-24 · e2e · alternativo · prioridade media

**Pré-condições:**
- Estado do CT-027.6

**Steps para reproduzir:**
1. No Console, executar rastreador('optIn')
2. Recarregar com ?idtrack=<ID_C1>
3. Clicar em «Ver item»

**Resultado esperado:**
- O evento é enviado e registrado em L1

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Modo de depuração avisa que o evento não está cadastrado
`CT-027.8 · FR-23 · e2e · sucesso · prioridade media · heurística: Ajuda para reconhecer e recuperar de erros

**Pré-condições:**
- Página de teste com debug:true na inicialização; evento «cupom_xpto» não cadastrado

**Steps para reproduzir:**
1. No Console, executar rastreador('track','cupom_xpto',{})
2. Esperar 5 segundos
3. Repetir com o debug desligado

**Resultado esperado:**
- Com debug ligado, o Console avisa que o evento «cupom_xpto» não está cadastrado e lista os cadastrados
- Com debug desligado, o Console fica em silêncio

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — O script nunca envia telefone, e-mail nem nome
`CT-027.9 · FR-24 · e2e · nfr (seguranca) · prioridade alta

**Pré-condições:**
- Página de teste aberta com ?idtrack=<ID_C1>; Network aberta

**Steps para reproduzir:**
1. No Console, executar rastreador('track','view_item',{item_id:'pizza-1',item_name:'Pizza grande',phone:'11999999999',email:'a@b.com',nome:'Maria',cpf:'123',contato:{telefone:'11988887777'},obs:'fale com ana@exemplo.com'})
2. Esperar 5 segundos e abrir o corpo da requisição na aba Network

**Resultado esperado:**
- O corpo enviado NÃO contém phone, email, nome, cpf nem contato.telefone
- O valor com cara de e-mail (ana@exemplo.com) também não aparece
- item_name «Pizza grande» continua no corpo

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — O script não cria cookies
`CT-027.10 · FR-24 · e2e · nfr (seguranca) · prioridade media

**Pré-condições:**
- Página de teste aberta com ?idtrack=<ID_C1>

**Steps para reproduzir:**
1. Clicar em todos os botões
2. Em Application › Cookies, olhar http://localhost:5555

**Resultado esperado:**
- O rastreador não cria nenhum cookie

**Resultado da execução:** ⏳ pendente

---

## US-028 — Tela de instalação do rastreador

### Cenário 1 — Criar a chave e copiar o código de instalação
`CT-028.1 · FR-18 · e2e · sucesso · prioridade alta

**Pré-condições:**
- Logado como gerente@teste.local; funil «Pedidos Bella» sem chave

**Steps para reproduzir:**
1. Abrir Configurações › Funis e o funil «Pedidos Bella»
2. Achar a seção «Rastreador para o site do cardápio»
3. Clicar em «Criar chave do rastreador»
4. Preencher o nome com «Cardápio Teste» e, em sites, duas linhas: http://localhost:5555 e http://localhost:3000
5. Confirmar
6. Clicar em «Copiar código de instalação» e colar o resultado num editor de texto

**Resultado esperado:**
- A chave aparece na lista com o nome e os dois sites
- O texto colado traz a chave pk_… e o endereço do CRM
- O código é um trecho para colar no <head> da página

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Sites inválidos são recusados com mensagem clara
`CT-028.2 · FR-18 · e2e · negativo · prioridade alta · heurística: Ajuda para reconhecer e recuperar de erros

**Pré-condições:**
- Formulário de criação de chave aberto

**Steps para reproduzir:**
1. Informar o site cardapio.minhaloja.com.br (sem https) e confirmar
2. Trocar por http://cardapio.minhaloja.com.br e confirmar
3. Trocar por https://cardapio.minhaloja.com.br/menu e confirmar
4. Deixar o campo de sites vazio e confirmar

**Resultado esperado:**
- Nas quatro tentativas a chave NÃO é criada
- Cada tentativa mostra uma mensagem em português explicando o formato esperado (https, sem nada depois do nome do site)

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — A tela explica a chave em linguagem simples
`CT-028.3 · FR-18 · e2e · sucesso · prioridade media · heurística: Correspondência entre o sistema e o mundo real

**Pré-condições:**
- Seção do rastreador aberta

**Steps para reproduzir:**
1. Ler o texto da seção

**Resultado esperado:**
- O texto explica que a chave é pública, não é senha, e só permite enviar eventos dos sites listados
- O texto diz que o cancelamento não passa por essa chave
- Não há jargão técnico

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — A tela mostra se a chave já recebeu evento
`CT-028.4 · FR-18 · e2e · sucesso · prioridade alta · heurística: Visibilidade do estado do sistema

**Pré-condições:**
- Chave recém-criada, nunca usada

**Steps para reproduzir:**
1. Olhar a linha da chave
2. Abrir a página de teste e clicar em «Ver item» duas vezes
3. Recarregar a seção

**Resultado esperado:**
- Antes: «ainda não recebeu nada» (ou equivalente)
- Depois: mostra a hora do último recebimento e a contagem dos últimos 7 dias

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Revogar a chave pela tela
`CT-028.5 · FR-18 · e2e · sucesso · prioridade alta · heurística: Controle e liberdade do usuário

**Pré-condições:**
- Chave ativa em uso na página de teste

**Steps para reproduzir:**
1. Clicar em revogar na linha da chave
2. Confirmar, se a tela pedir
3. Na página de teste, clicar em «Ver item»

**Resultado esperado:**
- A chave aparece como revogada
- O envio da página de teste deixa de ter efeito no CRM

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — A seção não cria item novo no menu lateral
`CT-028.6 · FR-18 · e2e · sucesso · prioridade baixa

**Pré-condições:**
- Logado como gerente

**Steps para reproduzir:**
1. Olhar todos os itens do menu lateral antes e depois de abrir a seção

**Resultado esperado:**
- O menu não ganhou item novo; a seção só existe dentro de Configurações › Funis

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Duplo clique em «Criar chave» cria uma só
`CT-028.7 · FR-18 · e2e · alternativo · prioridade media · heurística: Prevenção de erros

**Pré-condições:**
- Formulário preenchido

**Steps para reproduzir:**
1. Dar dois cliques rápidos em criar
2. Olhar a lista de chaves

**Resultado esperado:**
- Existe uma só chave nova

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Nome da chave com HTML aparece como texto
`CT-028.8 · FR-18 · e2e · nfr (seguranca) · prioridade media

**Pré-condições:**
- Chave criada com o nome «<img src=x onerror=alert(1)>»

**Steps para reproduzir:**
1. Olhar a lista de chaves

**Resultado esperado:**
- O texto aparece literalmente, sem executar nada

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — Atendente e visualizador não gerenciam a chave
`CT-028.9 · FR-18 · e2e · nfr (seguranca) · prioridade alta

**Pré-condições:**
- Sessões de atendente@teste.local e leitor@teste.local

**Steps para reproduzir:**
1. Entrar como atendente e procurar a seção do rastreador
2. Repetir como visualizador

**Resultado esperado:**
- Não há como criar nem revogar chave (seção oculta, só leitura ou ação recusada com mensagem)

**Nota:** Comportamento exato não está nos insumos; o QA anota o que viu.

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — Celular e teclado
`CT-028.10 · FR-18 · e2e · nfr (usabilidade) · prioridade baixa

**Pré-condições:**
- Janela em 375 px; depois voltar ao tamanho normal

**Steps para reproduzir:**
1. Abrir a seção e conferir se cabe sem rolagem horizontal
2. Voltar ao tamanho normal e criar uma chave só com Tab, digitação e Enter

**Resultado esperado:**
- Nada fica cortado em 375 px
- A chave é criada sem usar o mouse e o foco é sempre visível

**Resultado da execução:** ⏳ pendente

---

## US-029 — Prova de ponta a ponta da etapa 2

### Cenário 1 — Jornada completa do cardápio até a compra
`CT-029.1 · FR-21, FR-23 · e2e · sucesso · prioridade alta

**Pré-condições:**
- Chave ativa; 5 eventos cadastrados; L1 em Conversas; página de teste servida em http://localhost:5555

**Steps para reproduzir:**
1. Abrir …/cardapio-teste.html?idtrack=<ID_C1>
2. Clicar em «Ver página», «Ver item», «Atualizar carrinho», «Revisar» e «Comprar», com uns 4 segundos entre cada clique
3. Abrir o card de L1 no CRM

**Resultado esperado:**
- O card chega a Compras, ganho, com R$ 73,90
- Os dados do carrinho, da revisão e da compra estão guardados no card
- A linha do tempo mostra os cinco eventos, marcados com origem navegador
- Nenhum dado pessoal (telefone, e-mail, nome) aparece nos eventos

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Recarregar a página de sucesso não duplica a compra
`CT-029.2 · FR-8 · e2e · alternativo · prioridade alta

**Pré-condições:**
- Estado final do CT-029.1

**Steps para reproduzir:**
1. Na página de teste, clicar em «Comprar» mais duas vezes
2. Esperar 5 segundos e olhar a linha do tempo e o valor

**Resultado esperado:**
- Continua uma só compra e R$ 73,90
- Nenhum card novo é criado

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Comprar sem carrinho antes não fecha o pedido
`CT-029.3 · FR-21 · e2e · nfr (seguranca) · prioridade alta

**Pré-condições:**
- Cliente novo (ID_C2) com pedido aberto em Conversas

**Steps para reproduzir:**
1. Abrir …/cardapio-teste.html?idtrack=<ID_C2>
2. Clicar só em «Comprar»
3. Abrir o card

**Resultado esperado:**
- O card continua fora de Compras e sem valor
- A compra aparece registrada na linha do tempo

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Link com telefone no idtrack não envia nada
`CT-029.4 · FR-20 · e2e · negativo · prioridade alta

**Pré-condições:**
- Cliente novo

**Steps para reproduzir:**
1. Abrir …/cardapio-teste.html?idtrack=11999999999
2. Clicar em todos os botões

**Resultado esperado:**
- Nenhuma requisição à porta e nenhum registro no CRM

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Mesmo código em um site que não está na lista
`CT-029.5 · FR-19 · e2e · nfr (seguranca) · prioridade alta

**Pré-condições:**
- Servir a mesma pasta também na porta 5556 (python3 -m http.server 5556); a chave só permite a porta 5555

**Steps para reproduzir:**
1. Abrir http://localhost:5556/cardapio-teste.html?idtrack=<ID_C1>
2. Clicar em «Ver item»
3. Olhar o Console e o card de L1

**Resultado esperado:**
- O navegador bloqueia a resposta por CORS (erro no Console)
- O CRM não registra o evento em L1

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Chave revogada para na hora
`CT-029.6 · FR-18 · e2e · negativo · prioridade alta

**Pré-condições:**
- Página de teste funcionando

**Steps para reproduzir:**
1. Revogar a chave pela tela
2. Na mesma aba da página de teste, clicar em «Ver item»

**Resultado esperado:**
- O evento não chega ao CRM

**Resultado da execução:** ⏳ pendente

---

## Cobertura

| Story | Requisitos | Cenários | Camadas | Última rodada | Observação |
|---|---|---|---|---|---|
| US-020 | FR-18 | CT-020.1 … CT-020.2 (2) | 2i / 0e2e | 2⏳ | — |
| US-021 | FR-18 | CT-021.1 … CT-021.4 (4) | 4i / 0e2e | 4⏳ | — |
| US-022 | FR-18, FR-19 | CT-022.1 … CT-022.7 (7) | 7i / 0e2e | 7⏳ | — |
| US-023 | FR-18, FR-19 | CT-023.1 … CT-023.3 (3) | 3i / 0e2e | 3⏳ | — |
| US-024 | FR-20 | CT-024.1 … CT-024.7 (7) | 7i / 0e2e | 7⏳ | — |
| US-025 | FR-12, FR-21, FR-22 | CT-025.1 … CT-025.8 (8) | 8i / 0e2e | 8⏳ | — |
| US-026 | FR-23 | CT-026.1 … CT-026.10 (10) | 1i / 9e2e | 10⏳ | — |
| US-027 | FR-20, FR-23, FR-24 | CT-027.1 … CT-027.10 (10) | 0i / 10e2e | 10⏳ | — |
| US-028 | FR-18 | CT-028.1 … CT-028.10 (10) | 0i / 10e2e | 10⏳ | — |
| US-029 | FR-8, FR-18, FR-19, FR-20, FR-21, FR-23 | CT-029.1 … CT-029.6 (6) | 0i / 6e2e | 6⏳ | — |
| US-030 | — | — | — | — | sem cenário: ver abaixo |

### Histórias sem cenário
- US-030: Entrega documental (guia de instalação, nota de versão, conferência da LGPD), conferida por pnpm release:conferir e por revisão. O que o guia afirma sobre privacidade é testado nos CT-027.9 e CT-027.10.

### Requisitos sem cenário
- nenhum

### Fora de escopo (Non-Goals do PRD)
- Evento de cancelamento ou perda pelo navegador (CT-025.7 confere só que não existe).
- Link assinado para identificar o cliente.
- Observação automática por atributos HTML e leitura do dataLayer (CT-026.9 confere que não acontece).
- Tabela de visitante anônimo e login do cardápio por telefone no script.
- Celular real, outros navegadores e proxy/CDN que reescreva Origin (a evidência do mantenedor também não cobre).

### Bloqueado por perguntas em aberto
- idtrack cujo único pedido está encerrado: a US-024 diz que o servidor acha o pedido ABERTO mais recente e descarta o resto; a US-025 diz que pedido encerrado «só registra o evento». O CT-025.6 só afirma que nada muda no pedido.
- Pergunta 3 do PRD (chave pública em texto ou hash): decisão interna, não observável pelo QA.
- Pergunta 4 do PRD (texto de consentimento revisado pela LGPD): revisão de texto jurídico, não executável como cenário.

### Comportamento não documentado encontrado
- nenhum
