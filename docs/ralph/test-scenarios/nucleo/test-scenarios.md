# Cenários de Teste — Eventos do funil · Etapa 1 · Núcleo (US-001 a US-019)

> Gerado de `docs/ralph/prd.json` e dos documentos de desenho. Fonte de verdade: `test-scenarios.json`.
> Execução: `test-run.html` (artefato). Os resultados voltam ao repositório pelo botão «Copiar resultados (JSON)».

## Preparação do ambiente

**Ambiente**

- Stack local (ou homologação) com banco novo: baseline.sql aplicado + bootstrap-owner, sem variáveis opcionais (por exemplo sem RESEND_API_KEY). Daqui em diante {CRM} é o endereço do app, por exemplo http://localhost:3000.
- Organização A «Loja Teste A» e organização B «Loja Teste B», cada uma com o seu dono.
- Na organização A: gerente@teste.local (papel gerente), atendente@teste.local (papel atendente) e leitor@teste.local (papel visualizador). Na B: gerente-b@teste.local (gerente).

**Funil de referência (organização A)**

- Funil «Pedidos Bella» com estas etapas, nesta ordem: 1 Conversas · 2 Chamar humano · 3 Visitou o cardápio · 4 Viu um item · 5 Carrinho · 6 Revisão · 7 Compras (ganho) · 8 Cancelado (perda).
- Um campo declarado no funil: «Observação», chave observacao.
- Contato «Cliente Teste 01» (telefone +55 11 90000-0001) com um pedido aberto na etapa Conversas do funil «Pedidos Bella». Anotar o id do pedido (lead_id) lendo-o na resposta de GET /api/v1/leads ou no endereço do card; daqui em diante L1. Quando um cenário pedir «um pedido novo», criar outro contato «Cliente Teste NN» com pedido aberto em Conversas e anotar o id.

**Eventos de referência (cadastro à mão, nada vem pronto)**

- Cadastrar na tela (Configurações › Funis › Etapas do funil › «Para onde o card vai em cada evento») ou pelo POST do CT-014.1, uma linha por evento: page_view «Visitou o cardápio» → destino Visitou o cardápio · view_item «Viu um item» → Viu um item, guardar em ultimo_item · cart_sync «Carrinho atualizado» → Carrinho, guardar em carrinho · begin_checkout «Revisou o pedido» → Revisão, guardar em revisao, campo do valor value em reais · purchase «Compra» → Compras, guardar em compra, campo do valor value em reais, chave de repetição order_id, respeitar movimento manual DESLIGADO.
- Os outros ficam com «respeitar movimento manual» LIGADO (padrão). Os cenários que precisam de um evento a mais dizem qual nas pré-condições.

**Como chamar o MCP**

- Criar um token de API da organização A com os escopos de leitura e de escrita do MCP (aparece uma vez, começa com dsk_). Guardar como TOKEN_A; fazer o mesmo na B (TOKEN_B).
- Chamada: POST {CRM}/api/mcp com os cabeçalhos Authorization: Bearer TOKEN_A, Content-Type: application/json e Accept: application/json, text/event-stream, e o corpo {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<ferramenta>","arguments":{...}}}. Pode ser feita no Postman, no Insomnia ou no MCP Inspector.

**Como chamar a API do app (cadastro)**

- As rotas /api/v1/pipelines/{id}/events usam a sessão do navegador. Entrar no app como o usuário do cenário, copiar o cookie de sessão (DevTools › Application › Cookies) e enviá-lo no cabeçalho Cookie do Postman. {id} é o id do funil «Pedidos Bella», visível no endereço de Configurações › Funis.

**Como conferir o resultado**

- Etapa, valor e campos do pedido: abrir o card (ou GET /api/v1/leads/{lead_id}: stage, value_cents, custom_fields).
- Histórico: linha do tempo do card. Cada evento aceito aparece como «Registro de uma integração»; mudança de etapa aparece como mudança de etapa feita pelo sistema.
- Banco (quando o cenário pedir): psql no banco local, tabelas crm_pipeline_events, crm_lead_activities e api_audit_log.

## US-002 — Criar a tabela de cadastro de eventos do funil

### Cenário 1 — Banco recusa chave de evento fora do padrão
`CT-002.1 · FR-1, FR-2 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- Banco local com o baseline aplicado; psql conectado como dono do banco
- Funil «Pedidos Bella» existente (anotar PIPELINE_ID e ORG_ID)

**Steps para reproduzir:**
1. Executar insert into crm_pipeline_events (organization_id, pipeline_id, key, label) values ('<ORG_ID>','<PIPELINE_ID>','Compra Final','Compra')
2. Executar o mesmo insert com key 'compra-final'
3. Executar o mesmo insert com key '1compra'

**Resultado esperado:**
- Os três comandos falham com violação de check constraint (chave só aceita minúsculas, números e _, começando por letra)
- select count(*) from crm_pipeline_events devolve 0

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Banco exige campo do valor e unidade juntos
`CT-002.2 · FR-1 · integration · negativo · prioridade media · automatizável

**Pré-condições:**
- Mesmo ambiente do CT-002.1

**Steps para reproduzir:**
1. Executar insert com key 'x1', label 'X', value_path 'value' e value_unit nulo
2. Executar insert com key 'x2', label 'X', value_path nulo e value_unit 'reais'
3. Executar insert com key 'x3', label 'X', value_path 'value' e value_unit 'dolares'

**Resultado esperado:**
- Os três falham por check constraint
- Nenhuma linha é criada

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Banco recusa a mesma chave duas vezes no mesmo funil, mas aceita em outro
`CT-002.3 · FR-2 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Dois funis na organização A: «Pedidos Bella» e «Agenda»

**Steps para reproduzir:**
1. Inserir key 'compra' no funil «Pedidos Bella»
2. Inserir key 'compra' de novo no mesmo funil
3. Inserir key 'compra' no funil «Agenda»

**Resultado esperado:**
- O segundo insert falha com erro de chave duplicada (23505)
- O primeiro e o terceiro inserts passam

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Instalação nova não traz nenhum evento pronto
`CT-002.4 · FR-1 · e2e · sucesso · prioridade alta · heurística: Visibilidade do estado do sistema

**Pré-condições:**
- Banco novo, recém-instalado (sem nenhum evento cadastrado)
- Funil «Pedidos Bella» recém-criado, sem ter cadastrado nada

**Steps para reproduzir:**
1. Entrar como gerente@teste.local
2. Abrir Configurações › Funis › Etapas do funil do funil «Pedidos Bella»
3. Rolar até a seção «Para onde o card vai em cada evento»

**Resultado esperado:**
- A seção mostra a lista vazia, sem nenhum evento pré-cadastrado
- Há uma forma visível de cadastrar o primeiro evento

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Atualizar um banco que já tem dados não quebra
`CT-002.5 · FR-1 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Banco com a tabela já criada e 5 eventos cadastrados
- Cópia do baseline.sql da versão em teste

**Steps para reproduzir:**
1. Reaplicar o baseline.sql inteiro no banco pelo psql, sem a opção de parar no primeiro erro
2. Contar de novo os eventos: select count(*) from crm_pipeline_events

**Resultado esperado:**
- A reaplicação termina sem erro de objeto já existente
- A contagem continua 5 e os dados de cada evento estão idênticos

**Resultado da execução:** ⏳ pendente

---

## US-003 — Provar o isolamento do cadastro entre organizações

### Cenário 1 — Gerente de outra organização não lista os eventos do funil
`CT-003.1 · FR-1 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Evento «purchase» cadastrado no funil «Pedidos Bella» da organização A
- Logado como gerente-b@teste.local (organização B)

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar GET {CRM}/api/v1/pipelines/{id do funil da A}/events

**Resultado esperado:**
- Resposta 404 (funil não encontrado)
- Nenhum evento da organização A aparece no corpo

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Gerente de outra organização não cria evento no funil alheio
`CT-003.2 · FR-1 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Logado como gerente-b@teste.local
- Funil «Pedidos Bella» da A sem o evento «intruso»

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST {CRM}/api/v1/pipelines/{id do funil da A}/events com o corpo {"key":"intruso","label":"Intruso"}
2. Entrar como gerente@teste.local e abrir a seção de eventos do funil

**Resultado esperado:**
- O POST devolve 404
- O evento «intruso» não existe no funil da organização A

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Leitura direta no banco como usuário da outra organização devolve zero linhas
`CT-003.3 · FR-1 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Um evento em cada organização (A: purchase; B: purchase)
- JWT de gerente-b@teste.local (copiar do cookie de sessão)

**Steps para reproduzir:**
1. Enviar GET {SUPABASE}/rest/v1/crm_pipeline_events?select=* com a anon key e o cabeçalho Authorization: Bearer <JWT da B>
2. Repetir com o JWT de gerente@teste.local (A)

**Resultado esperado:**
- Com o JWT da B, só o evento da organização B aparece
- Com o JWT da A, só o evento da organização A aparece

**Resultado da execução:** ⏳ pendente

---

## US-004 — Índice único de event_id em crm_lead_activities

### Cenário 1 — Banco aceita o mesmo event_id em pedidos diferentes e recusa no mesmo pedido
`CT-004.1 · FR-7 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Dois pedidos abertos: L1 e L2 (contatos diferentes), ambos da organização A

**Steps para reproduzir:**
1. Inserir em crm_lead_activities uma atividade type 'external_event' para L1 com payload {"event":"page_view","event_id":"dup-1"}
2. Inserir a mesma atividade de novo para L1
3. Inserir a mesma atividade com event_id 'dup-1' para L2

**Resultado esperado:**
- O segundo insert falha com 23505 (índice uniq_lead_activities_external_event_id)
- O primeiro e o terceiro passam

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Atualização do banco remove duplicatas antigas e mantém a mais antiga
`CT-004.2 · FR-7 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Banco de uma versão anterior, sem o índice, com 3 atividades external_event do mesmo pedido e do mesmo event_id 'dup-9', com datas de criação diferentes (anotar a mais antiga)

**Steps para reproduzir:**
1. Aplicar o baseline.sql da versão em teste pelo psql, sem parar no primeiro erro
2. Consultar select id, created_at from crm_lead_activities where payload->>'event_id' = 'dup-9'
3. Aplicar o baseline.sql uma segunda vez

**Resultado esperado:**
- Sobra 1 só linha com event_id 'dup-9', a mais antiga
- A segunda aplicação não dá erro nem muda nada

**Resultado da execução:** ⏳ pendente

---

## US-005 — Tratar 23505 como repetido em registrarEventosDoNegocio

### Cenário 1 — Reenvio em sequência pela ferramenta antiga continua devolvendo registrado e depois repetido
`CT-005.1 · FR-7 · integration · sucesso · prioridade media · automatizável

**Pré-condições:**
- Pedido L1 aberto

**Steps para reproduzir:**
1. Chamar crm_add_lead_events com {"lead_id":"<L1>","events":[{"event":"qualquer_coisa","event_id":"seq-1"}]}
2. Chamar de novo exatamente igual

**Resultado esperado:**
- A primeira resposta traz o evento como registrado
- A segunda traz o mesmo event_id como repetido
- A linha do tempo de L1 tem 1 só registro desse evento

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Duas chamadas simultâneas com o mesmo event_id gravam uma só vez
`CT-005.2 · FR-7 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Pedido L1 aberto; evento page_view cadastrado
- Postman Runner (ou dois terminais) capaz de disparar duas chamadas ao mesmo tempo

**Steps para reproduzir:**
1. Preparar duas chamadas idênticas de crm_track_event com {"lead_id":"<L1>","events":[{"event":"page_view","event_id":"corrida-1"}]}
2. Disparar as duas no mesmo instante (repetir a rodada 5 vezes, trocando o event_id)

**Resultado esperado:**
- Em cada rodada, uma chamada devolve registrado e a outra repetido, nunca erro
- A linha do tempo mostra 1 registro por rodada, não 2

**Nota:** Sem automação, a janela de corrida pode não ser atingida; por isso 5 rodadas.

**Resultado da execução:** ⏳ pendente

---

## US-008 — crm_track_event: validação e registro dos eventos

### Cenário 1 — Registrar um evento cadastrado
`CT-008.1 · FR-4, FR-6 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Eventos de referência cadastrados
- Pedido L1 aberto em Conversas

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos {"lead_id":"<L1>","events":[{"event":"page_view","event_id":"t-001","data":{"screen_name":"home"}}]}
2. Abrir o card de L1 e olhar a linha do tempo

**Resultado esperado:**
- resultados traz 1 item, event_id «t-001», resultado «registrado»
- A linha do tempo ganha um «Registro de uma integração» com a hora de agora

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Lote misto devolve um resultado por evento, na ordem enviada
`CT-008.2 · FR-4, FR-5 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Eventos de referência cadastrados e o evento promo_dia cadastrado e DESATIVADO
- Pedido L1 aberto; o evento t-100 de page_view já foi registrado antes

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos {"lead_id":"<L1>","events":[{"event":"view_item","event_id":"t-101"},{"event":"cupom_xpto","event_id":"t-102"},{"event":"page_view","event_id":"t-100"},{"event":"promo_dia","event_id":"t-103"}]}

**Resultado esperado:**
- resultados vem na ordem enviada, com 4 itens
- t-101: registrado · t-102: recusado, codigo evento_nao_cadastrado · t-100: repetido · t-103: recusado, codigo evento_inativo
- A recusa de t-102 e t-103 não impede o registro de t-101

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — A recusa por evento desconhecido lista as chaves ativas
`CT-008.3 · FR-5 · integration · sucesso · prioridade alta · heurística: Ajuda para reconhecer e recuperar de erros · automatizável

**Pré-condições:**
- Eventos de referência cadastrados e promo_dia desativado

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos {"lead_id":"<L1>","events":[{"event":"cupom_xpto","event_id":"t-110"}]}

**Resultado esperado:**
- resultado «recusado», codigo «evento_nao_cadastrado»
- A mensagem cita page_view, view_item, cart_sync, begin_checkout e purchase
- A mensagem NÃO cita promo_dia (desativado)

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Limite de 50 eventos por chamada: 50 passam, 51 e 0 não
`CT-008.4 · FR-4 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Pedido L1 aberto; page_view cadastrado

**Steps para reproduzir:**
1. Chamar crm_track_event com 50 eventos page_view, event_id de b-001 a b-050
2. Chamar com 51 eventos (b-101 a b-151)
3. Chamar com events vazio []

**Resultado esperado:**
- A chamada de 50 devolve 50 resultados
- A de 51 é recusada por validação (máximo de 50) e nenhum dos 51 é registrado
- A de 0 é recusada por validação (mínimo de 1)

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Evento acima de 8 KB é recusado sem derrubar o lote
`CT-008.5 · FR-4 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Pedido L1 aberto; page_view cadastrado

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos 2 eventos page_view: g-001 com data.texto de 9.000 caracteres e g-002 com data.texto de 100 caracteres

**Resultado esperado:**
- g-001: recusado, codigo «evento_grande»
- g-002: registrado

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Chamada acima de 64 KB é recusada
`CT-008.6 · FR-4 · integration · alternativo · prioridade baixa

**Pré-condições:**
- Pedido L1 aberto; page_view cadastrado

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos 10 eventos page_view, cada um com data.texto de 7.000 caracteres (cada um abaixo de 8 KB, total acima de 64 KB)

**Resultado esperado:**
- A chamada devolve erro de tamanho
- Nenhum dos 10 eventos aparece na linha do tempo

**Nota:** A forma exata do erro não está na especificação; o QA registra o texto recebido na observação.

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Hora do evento no passado: 29 dias passa, 31 dias é recusada
`CT-008.7 · FR-4 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Pedido L1 aberto; page_view cadastrado

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos 2 eventos: h-001 com at de 29 dias atrás e h-002 com at de 31 dias atrás (formato ISO com fuso)

**Resultado esperado:**
- h-001: registrado
- h-002: recusado, codigo «hora_fora_da_janela»

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Hora do evento no futuro: 4 minutos passa, 6 minutos é recusada
`CT-008.8 · FR-4 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Pedido L1 aberto; page_view cadastrado

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos 2 eventos: f-001 com at 4 minutos à frente e f-002 com at 6 minutos à frente

**Resultado esperado:**
- f-001: registrado
- f-002: recusado, codigo «hora_fora_da_janela»

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — A hora gravada é a do evento, não a do envio
`CT-008.9 · FR-6 · integration · sucesso · prioridade media

**Pré-condições:**
- Pedido L1 aberto; page_view cadastrado

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos 1 evento page_view com at «2026-10-20T10:00:00-03:00» (ajustar para uma data dentro dos últimos 30 dias)
2. Abrir a linha do tempo do card L1

**Resultado esperado:**
- O registro aparece com a data e a hora informadas em at, não com a hora do envio

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — Campos obrigatórios: sem event_id e sem event
`CT-008.10 · FR-4 · integration · negativo · prioridade media · heurística: Prevenção de erros · automatizável

**Pré-condições:**
- Pedido L1 aberto

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos {"lead_id":"<L1>","events":[{"event":"page_view"}]}
2. Chamar com {"lead_id":"<L1>","events":[{"event_id":"x-1"}]}

**Resultado esperado:**
- As duas chamadas são recusadas por validação, indicando o campo que falta
- Nada é registrado

**Resultado da execução:** ⏳ pendente

---

### Cenário 11 — O funil vem do pedido, nunca da entrada
`CT-008.11 · FR-4 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Segundo funil «Agenda» com o evento outro_evento cadastrado; «Pedidos Bella» sem esse evento
- Pedido L1 no funil «Pedidos Bella»

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos {"lead_id":"<L1>","pipeline_id":"<id do funil Agenda>","events":[{"event":"outro_evento","event_id":"p-001"}]}

**Resultado esperado:**
- A chamada é recusada por validação, ou o evento sai como recusado «evento_nao_cadastrado»
- Em nenhum caso o evento é registrado em L1

**Resultado da execução:** ⏳ pendente

---

### Cenário 12 — Pedido de outra organização não é encontrado
`CT-008.12 · FR-4 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Pedido L1 pertence à organização A
- TOKEN_B (organização B)

**Steps para reproduzir:**
1. Com TOKEN_B, chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos {"lead_id":"<L1>","events":[{"event":"page_view","event_id":"x-b1"}]}

**Resultado esperado:**
- Resposta de erro com a mensagem «Pedido não encontrado.»
- A linha do tempo de L1 não ganha registro

**Resultado da execução:** ⏳ pendente

---

### Cenário 13 — Pedido de contato pessoal é recusado
`CT-008.13 · FR-4 · integration · nfr (seguranca) · prioridade media · automatizável

**Pré-condições:**
- Contato «Fulano Pessoal» marcado como pessoal, com um pedido aberto (id LP)

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos {"lead_id":"<LP>","events":[{"event":"page_view","event_id":"pp-1"}]}

**Resultado esperado:**
- Resposta de erro 403
- Nada é registrado no pedido

**Resultado da execução:** ⏳ pendente

---

### Cenário 14 — Token só de leitura não consegue escrever; sem token também não
`CT-008.14 · FR-4 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Token TOKEN_R criado só com o escopo de leitura do MCP

**Steps para reproduzir:**
1. Com TOKEN_R, chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos {"lead_id":"<L1>","events":[{"event":"page_view","event_id":"r-1"}]}
2. Repetir sem o cabeçalho Authorization

**Resultado esperado:**
- Com TOKEN_R: recusado por falta de permissão de escrita
- Sem token: 401
- Nada é registrado

**Resultado da execução:** ⏳ pendente

---

### Cenário 15 — Um lote de 50 eventos conta como uma só escrita no limite do token
`CT-008.15 · FR-4 · integration · nfr (desempenho) · prioridade media · automatizável

**Pré-condições:**
- Token com limite de 30 escritas por minuto, sem uso no último minuto
- Pedido L1 aberto; page_view cadastrado

**Steps para reproduzir:**
1. Chamar crm_track_event com 50 eventos (ids lt-001 a lt-050)
2. Dentro do mesmo minuto, fazer mais 29 chamadas com 1 evento cada
3. Fazer a 31ª chamada ainda dentro do minuto

**Resultado esperado:**
- As 30 primeiras chamadas são aceitas
- A 31ª é recusada por limite de taxa (429)

**Resultado da execução:** ⏳ pendente

---

## US-009 — crm_track_event: repetição de negócio, estado e valor

### Cenário 1 — A mesma compra com outro event_id é repetição
`CT-009.1 · FR-8 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Eventos de referência cadastrados; purchase com chave de repetição order_id
- Pedido L1 em Revisão

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase, event_id «c-1», data {"order_id":"PED-1","value":73.9}
2. Chamar de novo com event_id «c-2» e o mesmo order_id PED-1, value 99

**Resultado esperado:**
- A primeira: registrado
- A segunda: repetido
- O valor do pedido continua 7390 centavos e a linha do tempo tem 1 só compra

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — O último carrinho vence
`CT-009.2 · FR-9 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- cart_sync com «guardar em» carrinho
- Pedido L1 aberto

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos cart_sync, event_id «k-1», at 10:00, data {"items":[{"item_id":"pizza-1","quantity":1}]}
2. Chamar cart_sync, event_id «k-2», at 10:05, data {"items":[{"item_id":"pizza-1","quantity":1},{"item_id":"suco-1","quantity":2}]}
3. Consultar GET /api/v1/leads/<L1>

**Resultado esperado:**
- Ambas: registrado, estado «aplicado»
- custom_fields.carrinho mostra os 2 itens (pizza-1 e suco-1)

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Carrinho que chega atrasado não sobrescreve o mais novo
`CT-009.3 · FR-9 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Mesmo cenário do CT-009.2, pedido novo

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos cart_sync, event_id «k-11», at 10:05, itens pizza-1 e suco-1
2. Chamar cart_sync, event_id «k-10», at 10:00, só pizza-1 (chega depois, mas é mais antigo)
3. Consultar GET /api/v1/leads/<id>

**Resultado esperado:**
- O segundo devolve registrado com estado «ignorado_antigo»
- custom_fields.carrinho continua com pizza-1 e suco-1
- Os dois registros aparecem na linha do tempo

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Dois carrinhos com a mesma hora: o que chega por último vale
`CT-009.4 · FR-9 · integration · alternativo · prioridade baixa · automatizável

**Pré-condições:**
- Mesmo ambiente, pedido novo

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos cart_sync, event_id «k-21», at 10:00:00, itens [pizza-1]
2. Chamar cart_sync, event_id «k-22», at 10:00:00 (exatamente igual), itens [suco-1]

**Resultado esperado:**
- Os dois: registrado, estado «aplicado»
- custom_fields.carrinho mostra suco-1

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Valor em reais vira centavos e é gravado antes de mover
`CT-009.5 · FR-10 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- purchase com campo do valor value em reais
- Pedido novo em Revisão, sem valor

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase, event_id «v-1», data {"order_id":"PED-V1","value":73.9}
2. Abrir o card

**Resultado esperado:**
- valor «aplicado»
- O card está em Compras já com valor de R$ 73,90 (value_cents 7390)

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Arredondamento e zero em reais
`CT-009.6 · FR-10 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Mesmo ambiente; dois pedidos novos em Revisão

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase value 19.999 em um pedido
2. Chamar purchase value 0 em outro pedido (order_id diferente)

**Resultado esperado:**
- 19.999 vira 2000 centavos
- 0 é aceito e o pedido fica com valor 0

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Valor em centavos exige número inteiro
`CT-009.7 · FR-10 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Evento pagou_c cadastrado: destino Compras, campo do valor total, unidade CENTAVOS
- Dois pedidos novos

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos pagou_c com data {"total":7390}
2. Chamar pagou_c em outro pedido com data {"total":73.9}

**Resultado esperado:**
- total 7390 vira value_cents 7390
- total 73.9 é recusado com codigo «valor_invalido» e nada é gravado para esse evento

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Valor inválido é recusado e não grava nada
`CT-009.8 · FR-10 · integration · negativo · prioridade alta · heurística: Prevenção de erros · automatizável

**Pré-condições:**
- purchase com campo do valor value; pedido novo em Revisão

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase com data {"order_id":"PED-X1","value":"abc"}
2. Repetir com value -5
3. Abrir o card e a linha do tempo

**Resultado esperado:**
- As duas chamadas: recusado, codigo «valor_invalido»
- O card continua em Revisão, sem valor novo
- Não há registro novo na linha do tempo

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — Não existe teto para o valor da venda
`CT-009.9 · FR-10 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- purchase com campo do valor value; pedido novo em Revisão

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase com data {"order_id":"PED-GRANDE","value":99999999.99}

**Resultado esperado:**
- valor «aplicado»; value_cents 9999999999

**Nota:** Decisão do dono do produto: sem teto. O Design Doc ainda menciona um teto fixo; vale o PRD.

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — Pedido encerrado não muda de estado nem de valor
`CT-009.10 · FR-12 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Pedido ganho em Compras com valor 5000 centavos e carrinho gravado (fechado por um purchase anterior)

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos cart_sync com itens novos e begin_checkout com value 200

**Resultado esperado:**
- estado: «ignorado_pedido_encerrado»; valor: «ignorado_pedido_encerrado»
- O carrinho e o valor do card (5000) permanecem como estavam

**Resultado da execução:** ⏳ pendente

---

### Cenário 11 — Reenvio de um evento já registrado ainda completa estado e valor
`CT-009.11 · FR-9, FR-10 · integration · alternativo · prioridade media

**Pré-condições:**
- Pedido novo em Revisão
- Uma atividade external_event com event_id «rec-1» inserida direto no banco (simula queda do servidor antes de gravar valor e estado), com data {"order_id":"PED-R","value":40}

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase, event_id «rec-1», data {"order_id":"PED-R","value":40}
2. Abrir o card e a linha do tempo

**Resultado esperado:**
- O card termina em Compras com valor R$ 40,00 e o estado gravado
- A linha do tempo continua com 1 só registro de «rec-1»

**Nota:** O texto do resultado (repetido ou registrado) não é afirmado: a especificação se contradiz aqui. Ver coverage.blockedByOpenQuestions.

**Resultado da execução:** ⏳ pendente

---

## US-010 — crm_track_event: movimento da etapa

### Cenário 1 — Sequência completa, um evento por chamada, termina em Compras
`CT-010.1 · FR-11 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Eventos de referência cadastrados
- Pedido novo em Conversas

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos page_view; depois abrir o card
2. Chamar view_item
3. Chamar cart_sync
4. Chamar begin_checkout com value 73.9
5. Chamar purchase com order_id PED-S1 e value 73.9

**Resultado esperado:**
- Depois de cada chamada o card está em: Visitou o cardápio, Viu um item, Carrinho, Revisão, Compras
- No fim o pedido está ganho, com R$ 73,90

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Os cinco eventos em um único lote chegam a Compras
`CT-010.2 · FR-11 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Mesmo ambiente; pedido novo em Conversas

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos um lote com os 5 eventos em ordem (page_view, view_item, cart_sync, begin_checkout, purchase), event_ids diferentes, at crescente

**Resultado esperado:**
- 5 resultados «registrado», o último com movimento «movido» e etapa «Compras»
- O card termina em Compras com valor

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Evento de nível menor não faz o pedido retroceder
`CT-010.3 · FR-11 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Pedido novo em Revisão

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos view_item, event_id «n-1»

**Resultado esperado:**
- movimento «ja_na_etapa_ou_adiante»
- O card continua em Revisão
- O evento fica registrado na linha do tempo

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Mover para a etapa em que o pedido já está não gera mudança de etapa
`CT-010.4 · FR-14 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Pedido novo na etapa Visitou o cardápio

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos page_view, event_id «m-1»
2. Olhar a linha do tempo

**Resultado esperado:**
- movimento «ja_na_etapa_ou_adiante»
- A linha do tempo ganha o registro do evento, mas nenhuma nova mudança de etapa

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Desvio por «Chamar humano» não trava a compra
`CT-010.5 · FR-11 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Pedido novo em Revisão; um atendente o moveu à mão para «Chamar humano»

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase com order_id PED-D1 e value 50

**Resultado esperado:**
- O card vai para Compras, ganho, com R$ 50,00
- O resultado traz movimento «movido»

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Movimento manual da equipe é respeitado, mas estado e valor são gravados
`CT-010.6 · FR-13 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Pedido novo em Carrinho; um usuário (atendente@teste.local) o moveu à mão para Conversas pela tela

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos cart_sync com itens [pizza-1] (cart_sync respeita movimento manual)
2. Consultar GET /api/v1/leads/<id>

**Resultado esperado:**
- resultado «registrado» com movimento «respeita_movimento_manual»
- O card continua em Conversas
- custom_fields.carrinho contém pizza-1

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Depois de um evento que move, os seguintes voltam a mover
`CT-010.7 · FR-13 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Evento retomou_carrinho cadastrado: destino Carrinho, respeitar movimento manual DESLIGADO
- Pedido novo; um usuário o moveu à mão para Conversas

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos retomou_carrinho
2. Chamar begin_checkout (que respeita movimento manual) com value 10

**Resultado esperado:**
- retomou_carrinho move o card para Carrinho
- begin_checkout em seguida move o card para Revisão (o último movimento passou a ser do sistema)

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Pedido perdido não é reaberto por evento
`CT-010.8 · FR-11 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Pedido novo movido para Cancelado (perda) pela tela

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase com order_id PED-P1 e value 30

**Resultado esperado:**
- movimento «pedido_encerrado»
- O card continua em Cancelado, sem valor novo
- O evento fica registrado

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — Funil recusa o ganho: estado e valor ficam, o card não anda
`CT-010.9 · FR-3 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- A etapa Compras exige o campo «Forma de pagamento» (campo obrigatório por etapa, configurado em Configurações › Funis)
- Pedido novo em Revisão sem esse campo preenchido

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos purchase com order_id PED-F1 e value 60

**Resultado esperado:**
- movimento «recusado_pelo_funil» com a mensagem do funil citando o campo obrigatório
- O card continua em Revisão
- O valor R$ 60,00 e o estado «compra» já estão gravados no card

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — Etapa de destino arquivada só registra
`CT-010.10 · FR-3 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Evento arquivado_dest cadastrado com destino Carrinho; depois a etapa Carrinho é arquivada em Configurações › Funis
- Pedido novo em Conversas

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos arquivado_dest

**Resultado esperado:**
- movimento «etapa_arquivada»
- O card continua em Conversas
- O evento fica registrado na linha do tempo

**Resultado da execução:** ⏳ pendente

---

### Cenário 11 — Evento sem destino («Não mover») só registra
`CT-010.11 · FR-1 · integration · sucesso · prioridade media · automatizável

**Pré-condições:**
- Evento observou cadastrado com destino «Não mover»
- Pedido novo em Conversas

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos observou

**Resultado esperado:**
- movimento «sem_destino»
- O card continua em Conversas
- O evento fica registrado

**Resultado da execução:** ⏳ pendente

---

### Cenário 12 — Dois eventos simultâneos geram uma só mudança de etapa
`CT-010.12 · FR-11 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Pedido novo na etapa Visitou o cardápio
- Dois eventos view_item prontos, event_ids «sim-1» e «sim-2»

**Steps para reproduzir:**
1. Disparar as duas chamadas ao mesmo tempo (Postman Runner), uma para cada event_id
2. Olhar a linha do tempo do card

**Resultado esperado:**
- Os dois eventos ficam registrados
- Há uma só mudança de etapa, para «Viu um item»
- Um dos resultados pode trazer movimento «conflito» ou «ja_na_etapa_ou_adiante»; nenhum é erro

**Resultado da execução:** ⏳ pendente

---

### Cenário 13 — A mudança de etapa feita pelo evento aparece como feita pelo sistema
`CT-010.13 · FR-13 · e2e · sucesso · prioridade media

**Pré-condições:**
- Pedido novo em Conversas

**Steps para reproduzir:**
1. chamar a ferramenta crm_track_event (ver «Como chamar o MCP» na Preparação) com os argumentos page_view
2. Abrir o card e a linha do tempo
3. Olhar quem aparece como autor da mudança de etapa

**Resultado esperado:**
- A mudança para «Visitou o cardápio» aparece como feita pelo sistema/integração, sem nome de pessoa

**Resultado da execução:** ⏳ pendente

---

## US-011 — Leitura das chaves e gates do catálogo MCP

### Cenário 1 — Listar os eventos de um funil sem expor ids de etapa
`CT-011.1 · FR-15 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Eventos de referência cadastrados; promo_dia desativado

**Steps para reproduzir:**
1. Chamar crm_list_pipeline_events com {"pipeline_id":"<id do funil Pedidos Bella>"}

**Resultado esperado:**
- Cada evento traz chave, nome, ativo (verdadeiro/falso), nome da etapa de destino, se guarda estado e se define valor
- purchase aparece com etapa «Compras», guarda estado e define valor
- promo_dia aparece como inativo
- A resposta não contém nenhum id de etapa (uuid de crm_stages)

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Funil de outra organização não é listado
`CT-011.2 · FR-15 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- TOKEN_B (organização B)

**Steps para reproduzir:**
1. Com TOKEN_B, chamar crm_list_pipeline_events com o id do funil da organização A

**Resultado esperado:**
- Resposta de erro (funil não encontrado)
- Nenhum evento da A aparece

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — A ferramenta antiga continua aceitando qualquer nome de evento
`CT-011.3 · FR-15 · integration · alternativo · prioridade alta · automatizável

**Pré-condições:**
- Pedido L1 aberto; «nome_que_nao_existe» NÃO cadastrado no funil

**Steps para reproduzir:**
1. Chamar crm_add_lead_events com {"lead_id":"<L1>","events":[{"event":"nome_que_nao_existe","event_id":"old-1"}]}

**Resultado esperado:**
- O evento é registrado (contrato permissivo)
- O card não muda de etapa

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — A ferramenta nova aparece no catálogo com um rótulo sem jargão
`CT-011.4 · FR-4 · e2e · sucesso · prioridade baixa

**Pré-condições:**
- Logado como gerente@teste.local

**Steps para reproduzir:**
1. Abrir a tela onde se escolhem as ferramentas liberadas para um agente de IA ou para um token (Configurações › IA, na lista de ferramentas)
2. Procurar pela ferramenta que registra o que o cliente fez fora do CRM

**Resultado esperado:**
- Existe uma ferramenta com o rótulo «Registrar o que o cliente fez fora do CRM»
- O rótulo e a descrição não usam jargão técnico (nada de event_id, jsonb)

**Nota:** O caminho exato da tela não consta nos insumos; o QA anota onde encontrou.

**Resultado da execução:** ⏳ pendente

---

## US-013 — API de cadastro: listar eventos do funil

### Cenário 1 — Listar eventos com sinais de uso
`CT-013.1 · FR-16 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Eventos de referência cadastrados
- Enviados 3 eventos page_view e nenhum view_item

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), GET {CRM}/api/v1/pipelines/{id}/events

**Resultado esperado:**
- Os 5 eventos aparecem
- page_view traz a hora do último recebimento e contagem 3 nos últimos 7 dias
- view_item traz sem recebimento e contagem 0

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Papéis abaixo de gerente e quem não está logado não listam
`CT-013.2 · FR-17 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Sessões de atendente@teste.local e leitor@teste.local

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar o GET como atendente
2. Enviar o GET como leitor
3. Enviar o GET sem cookie

**Resultado esperado:**
- Atendente e leitor: 403
- Sem login: 401

**Resultado da execução:** ⏳ pendente

---

## US-014 — API de cadastro: criar evento

### Cenário 1 — Criar um evento completo
`CT-014.1 · FR-1, FR-17 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Funil «Pedidos Bella» sem o evento «compra_nova»
- Logado como gerente@teste.local

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST {CRM}/api/v1/pipelines/{id}/events com {"key":"compra_nova","label":"Compra nova","stage_id":"<id da etapa Compras>","state_key":"compra_nova","value_path":"value","value_unit":"reais","dedupe_path":"order_id","respects_manual_move":false}
2. Enviar GET da lista
3. Conferir a tabela api_audit_log

**Resultado esperado:**
- O POST devolve sucesso com o evento criado
- O GET lista «compra_nova» com os mesmos valores
- api_audit_log tem uma linha com ação pipeline_event.created para esse evento

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Chave duplicada no mesmo funil é recusada
`CT-014.2 · FR-2 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- Evento purchase já cadastrado

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com key «purchase» e label «Outra compra»

**Resultado esperado:**
- Recusado com mensagem dizendo que a chave já existe
- Continua existindo um só evento purchase

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Chaves fora do padrão são recusadas
`CT-014.3 · FR-2 · integration · negativo · prioridade alta · heurística: Prevenção de erros · automatizável

**Pré-condições:**
- Logado como gerente

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com key «Compra» (maiúscula)
2. Repetir com «1compra»
3. Repetir com «compra-final»
4. Repetir com key vazia

**Resultado esperado:**
- As quatro são recusadas por validação, com mensagem sobre o formato da chave

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Chave com 64 caracteres passa e com 65 não
`CT-014.4 · FR-2 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Logado como gerente

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com key «a» seguida de 63 letras «b» (64 no total), label «Limite»
2. Repetir com 65 caracteres e label «Limite 2»

**Resultado esperado:**
- 64 caracteres: criado
- 65 caracteres: recusado por validação

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Nome do evento: 80 caracteres passa; 81 e só espaços não
`CT-014.5 · FR-1 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Logado como gerente

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com label de 80 caracteres e key «lb80»
2. Repetir com label de 81 caracteres e key «lb81»
3. Repetir com label «   » (só espaços) e key «lb0»

**Resultado esperado:**
- 80: criado
- 81: recusado
- Só espaços: recusado

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Etapa de perda não pode ser destino
`CT-014.6 · FR-3 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- Logado como gerente

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com key «cancelou» e stage_id da etapa Cancelado (perda)

**Resultado esperado:**
- Recusado com mensagem dizendo que etapa de perda não serve de destino
- O evento não é criado

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Etapa de outro funil ou arquivada não pode ser destino
`CT-014.7 · FR-3 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- Etapa «Agendado» do funil «Agenda»; etapa «Antiga» do funil «Pedidos Bella» já arquivada

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com key «e1» e stage_id da etapa Agendado
2. Enviar POST com key «e2» e stage_id da etapa Antiga

**Resultado esperado:**
- Os dois são recusados
- Nenhum evento é criado

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — «Guardar em» igual a um campo declarado do funil é erro
`CT-014.8 · FR-16 · integration · negativo · prioridade alta · automatizável

**Pré-condições:**
- O funil tem o campo declarado «Observação» (chave observacao)

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com key «obs1», label «Obs» e state_key «observacao»

**Resultado esperado:**
- Resposta 422 com mensagem sobre o conflito com o campo do funil
- O evento não é criado

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — «Guardar em» repetido entre dois eventos salva e avisa
`CT-014.9 · FR-16 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Evento cart_sync já usa state_key «carrinho»

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com key «cart2», label «Carrinho 2» e state_key «carrinho»

**Resultado esperado:**
- O evento é criado
- A resposta traz um aviso dizendo que outro evento já guarda na mesma chave

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — Campo do valor e unidade têm de vir juntos
`CT-014.10 · FR-1 · integration · negativo · prioridade media · automatizável

**Pré-condições:**
- Logado como gerente

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com key «v1», label «V» e value_path «value» sem value_unit
2. Enviar POST com key «v2», label «V» e value_unit «reais» sem value_path
3. Enviar POST com value_unit «dolares»

**Resultado esperado:**
- Os três são recusados por validação

**Resultado da execução:** ⏳ pendente

---

### Cenário 11 — Criar com a mesma Idempotency-Key duas vezes cria um só evento
`CT-014.11 · FR-17 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Logado como gerente

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar POST com o cabeçalho Idempotency-Key: 11111111-1111-4111-8111-111111111111 e key «idem1»
2. Enviar de novo exatamente igual
3. Listar os eventos

**Resultado esperado:**
- As duas respostas trazem o mesmo evento
- A lista tem um só «idem1»

**Resultado da execução:** ⏳ pendente

---

### Cenário 12 — Papel insuficiente e organização no corpo
`CT-014.12 · FR-17 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Sessão de atendente@teste.local; sessão de gerente@teste.local

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), como atendente, enviar POST com key «ag1»
2. Como gerente, enviar POST com key «org1» e organization_id da organização B no corpo
3. Conferir em qual organização o evento «org1» existe

**Resultado esperado:**
- Atendente: 403
- Gerente: o evento é criado (ou o corpo é recusado) e nunca na organização B; a organização vem da sessão

**Resultado da execução:** ⏳ pendente

---

### Cenário 13 — Texto com HTML no nome do evento aparece como texto
`CT-014.13 · FR-17 · e2e · nfr (seguranca) · prioridade media

**Pré-condições:**
- Evento criado com label «<img src=x onerror=alert(1)>» (pelo POST)

**Steps para reproduzir:**
1. Abrir a seção de eventos do funil na tela
2. Olhar a linha do evento

**Resultado esperado:**
- O texto aparece literalmente, sem executar nada e sem imagem quebrada

**Resultado da execução:** ⏳ pendente

---

## US-015 — API de cadastro: editar e desativar evento

### Cenário 1 — Editar a etapa de destino muda para onde os próximos eventos levam
`CT-015.1 · FR-17 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Evento observou com destino «Não mover»; pedido novo em Conversas

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar PATCH {CRM}/api/v1/pipelines/{id}/events/{id do evento observou} com stage_id da etapa Carrinho
2. Chamar crm_track_event com observou
3. Conferir api_audit_log

**Resultado esperado:**
- O PATCH devolve o evento já com a etapa Carrinho
- O card vai para Carrinho
- api_audit_log tem pipeline_event.updated

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — A chave é imutável quando já existe atividade com ela
`CT-015.2 · FR-2 · integration · negativo · prioridade alta · heurística: Ajuda para reconhecer e recuperar de erros · automatizável

**Pré-condições:**
- Evento page_view com pelo menos 1 registro no histórico

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar PATCH no evento page_view com {"key":"visita"}

**Resultado esperado:**
- Resposta 409 com mensagem clara dizendo que a chave não muda depois de usada
- A chave continua page_view

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — A chave pode mudar enquanto ninguém a usou
`CT-015.3 · FR-2 · integration · alternativo · prioridade media · automatizável

**Pré-condições:**
- Evento «novo_sem_uso» criado e nunca recebido

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar PATCH com {"key":"renomeado"}

**Resultado esperado:**
- Sucesso; o evento aparece com a chave «renomeado»

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Desativar preserva o histórico e passa a recusar o evento
`CT-015.4 · FR-17 · integration · sucesso · prioridade alta · automatizável

**Pré-condições:**
- Evento view_item com 2 registros no histórico; pedido L1 aberto

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar DELETE {CRM}/api/v1/pipelines/{id}/events/{id do evento view_item}
2. Listar os eventos
3. Chamar crm_track_event com view_item, event_id «des-1»
4. Olhar a linha do tempo de um pedido que já recebeu view_item
5. Conferir api_audit_log

**Resultado esperado:**
- O DELETE responde sucesso e o evento continua na lista como inativo
- des-1: recusado, codigo «evento_inativo»
- Os 2 registros antigos continuam na linha do tempo
- api_audit_log tem pipeline_event.deactivated

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Editar ou desativar evento de outro funil/organização dá 404
`CT-015.5 · FR-17 · integration · nfr (seguranca) · prioridade alta · automatizável

**Pré-condições:**
- Sessão de gerente-b@teste.local
- Id de um evento da organização A

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar PATCH e DELETE em /api/v1/pipelines/{id do funil da A}/events/{id do evento}

**Resultado esperado:**
- As duas chamadas devolvem 404
- O evento da A não muda

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Atendente não edita nem desativa
`CT-015.6 · FR-17 · integration · nfr (seguranca) · prioridade media · automatizável

**Pré-condições:**
- Sessão de atendente@teste.local

**Steps para reproduzir:**
1. com o cookie de sessão do gerente (ver «Como chamar a API do app»), enviar PATCH e DELETE em um evento da organização A

**Resultado esperado:**
- As duas devolvem 403

**Resultado da execução:** ⏳ pendente

---

## US-016 — Tela: cadastrar e editar eventos do funil

### Cenário 1 — A seção fica no lugar certo da tela de funis
`CT-016.1 · FR-16 · e2e · sucesso · prioridade alta

**Pré-condições:**
- Logado como gerente@teste.local

**Steps para reproduzir:**
1. Abrir Configurações › Funis
2. Abrir as etapas do funil «Pedidos Bella»
3. Rolar a página

**Resultado esperado:**
- Existe a seção «Para onde o card vai em cada evento»
- Ela aparece logo abaixo de «Para onde o card vai em cada passo»
- O menu lateral não ganhou nenhum item novo

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — Cadastrar um evento pela tela
`CT-016.2 · FR-1, FR-16 · e2e · sucesso · prioridade alta · heurística: Visibilidade do estado do sistema

**Pré-condições:**
- Funil «Pedidos Bella» sem eventos

**Steps para reproduzir:**
1. Na seção «Para onde o card vai em cada evento», clicar no botão para adicionar um evento
2. Preencher o nome com «Visitou o cardápio» e a chave com «page_view»
3. Escolher a etapa de destino «Visitou o cardápio»
4. Salvar

**Resultado esperado:**
- A linha do evento aparece com o nome, a chave page_view e a etapa «Visitou o cardápio»
- Recarregar a página (F5): a linha continua lá

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Opções avançadas do evento
`CT-016.3 · FR-1 · e2e · sucesso · prioridade alta

**Pré-condições:**
- Evento purchase recém-criado, só com nome, chave e destino Compras

**Steps para reproduzir:**
1. Abrir o painel recolhível das opções avançadas do evento
2. Preencher «guardar em» com compra, campo do valor com value, unidade reais, chave de repetição com order_id
3. Desligar «respeitar movimento manual»
4. Salvar, recarregar a página e reabrir o painel

**Resultado esperado:**
- Os cinco valores continuam como foram salvos
- Os textos do painel estão em linguagem comum (nada de state_key, jsonb, value_path)

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — A lista de destinos não oferece etapa de perda nem arquivada
`CT-016.4 · FR-3 · e2e · sucesso · prioridade alta

**Pré-condições:**
- Etapa «Antiga» arquivada; etapa Cancelado é de perda

**Steps para reproduzir:**
1. Abrir o cadastro de um evento
2. Abrir a lista de etapas de destino

**Resultado esperado:**
- A lista tem «Não mover» e as etapas ativas que não são de perda
- Cancelado e Antiga não aparecem

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — Editar a etapa de destino pela tela
`CT-016.5 · FR-1 · e2e · sucesso · prioridade media

**Pré-condições:**
- Evento view_item com destino «Viu um item»

**Steps para reproduzir:**
1. Clicar em editar no evento view_item
2. Trocar o destino para «Carrinho»
3. Salvar

**Resultado esperado:**
- A linha passa a mostrar o destino «Carrinho»
- Depois de recarregar a página, continua «Carrinho»

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Desativar um evento pela tela
`CT-016.6 · FR-1 · e2e · sucesso · prioridade alta · heurística: Controle e liberdade do usuário

**Pré-condições:**
- Evento promo_dia ativo

**Steps para reproduzir:**
1. Clicar em desativar no evento promo_dia
2. Se a tela pedir confirmação, confirmar

**Resultado esperado:**
- O evento aparece como desativado (ou sai da lista de ativos), sem ser apagado do histórico
- Chamar crm_track_event com promo_dia devolve «evento_inativo»

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Chave repetida mostra erro legível ao lado do formulário
`CT-016.7 · FR-1 · e2e · negativo · prioridade alta · heurística: Ajuda para reconhecer e recuperar de erros

**Pré-condições:**
- Evento purchase já cadastrado

**Steps para reproduzir:**
1. Adicionar um novo evento com chave «purchase»
2. Salvar

**Resultado esperado:**
- A tela mostra uma mensagem em português dizendo que essa chave já existe, perto do campo
- O formulário continua com o que foi digitado
- Nenhuma mensagem genérica do tipo «ocorreu um erro»

**Resultado da execução:** ⏳ pendente

---

### Cenário 8 — Duplo clique em Salvar cria um só evento
`CT-016.8 · FR-1 · e2e · alternativo · prioridade media · heurística: Prevenção de erros

**Pré-condições:**
- Formulário de novo evento preenchido com chave «dclick»

**Steps para reproduzir:**
1. Dar dois cliques rápidos no botão de salvar
2. Recarregar a página

**Resultado esperado:**
- Existe uma só linha «dclick»

**Resultado da execução:** ⏳ pendente

---

### Cenário 9 — Atendente e visualizador não conseguem cadastrar
`CT-016.9 · FR-16 · e2e · nfr (seguranca) · prioridade alta

**Pré-condições:**
- Sessões de atendente@teste.local e leitor@teste.local

**Steps para reproduzir:**
1. Entrar como atendente e tentar chegar à seção de eventos do funil
2. Repetir como visualizador

**Resultado esperado:**
- Não há como criar, editar ou desativar evento (a seção não aparece, fica só leitura, ou a ação é recusada com mensagem)
- Nenhum evento muda

**Nota:** O comportamento exato (oculta, só leitura ou recusa) não está nos insumos; o QA anota o que viu.

**Resultado da execução:** ⏳ pendente

---

### Cenário 10 — Teclado: cadastrar um evento sem usar o mouse
`CT-016.10 · FR-16 · e2e · nfr (usabilidade) · prioridade baixa

**Pré-condições:**
- Seção de eventos aberta

**Steps para reproduzir:**
1. Percorrer com Tab até o botão de adicionar e acionar com Enter
2. Preencher os campos com Tab e digitação
3. Salvar com Enter

**Resultado esperado:**
- Todos os controles recebem foco visível
- O evento é criado sem usar o mouse

**Resultado da execução:** ⏳ pendente

---

### Cenário 11 — Celular: a seção cabe em 375 px
`CT-016.11 · FR-16 · e2e · nfr (usabilidade) · prioridade baixa

**Pré-condições:**
- Janela do navegador em 375 px de largura

**Steps para reproduzir:**
1. Abrir a seção de eventos com 5 eventos cadastrados
2. Abrir o painel de opções avançadas de um deles

**Resultado esperado:**
- Não há rolagem horizontal da página
- Nenhum texto fica cortado e os botões são tocáveis

**Resultado da execução:** ⏳ pendente

---

## US-017 — Tela: avisos e sinais de uso dos eventos

### Cenário 1 — Aviso de venda sem valor quando o destino é etapa de ganho
`CT-017.1 · FR-16 · e2e · sucesso · prioridade alta · heurística: Prevenção de erros

**Pré-condições:**
- Evento novo com destino Compras e sem campo do valor

**Steps para reproduzir:**
1. Escolher a etapa Compras como destino
2. Deixar o campo do valor vazio
3. Observar a tela e salvar

**Resultado esperado:**
- Aparece o aviso «esta etapa fecha a venda, mas o evento não define o valor, então a venda não será enviada como conversão»
- O evento é salvo mesmo assim (o aviso não bloqueia)

**Resultado da execução:** ⏳ pendente

---

### Cenário 2 — O aviso some quando o campo do valor é preenchido
`CT-017.2 · FR-16 · e2e · alternativo · prioridade media

**Pré-condições:**
- Mesmo evento do CT-017.1, com o aviso visível

**Steps para reproduzir:**
1. Preencher o campo do valor com value e a unidade reais

**Resultado esperado:**
- O aviso de venda sem valor desaparece

**Resultado da execução:** ⏳ pendente

---

### Cenário 3 — Aviso quando a etapa de destino foi arquivada
`CT-017.3 · FR-16 · e2e · alternativo · prioridade media

**Pré-condições:**
- Evento com destino Revisão; a etapa Revisão é arquivada depois

**Steps para reproduzir:**
1. Abrir a seção de eventos do funil

**Resultado esperado:**
- O evento mostra um aviso dizendo que a etapa foi arquivada e que o evento passa a só registrar

**Nota:** O texto exato do aviso não consta nos insumos; o QA anota o que leu.

**Resultado da execução:** ⏳ pendente

---

### Cenário 4 — Aviso quando dois eventos guardam no mesmo lugar
`CT-017.4 · FR-16 · e2e · alternativo · prioridade media

**Pré-condições:**
- cart_sync guarda em «carrinho»

**Steps para reproduzir:**
1. Editar outro evento e colocar «guardar em» = carrinho
2. Salvar

**Resultado esperado:**
- A tela avisa que outro evento já guarda no mesmo lugar
- O evento é salvo

**Resultado da execução:** ⏳ pendente

---

### Cenário 5 — «Guardar em» igual a um campo do funil bloqueia o salvamento
`CT-017.5 · FR-16 · e2e · negativo · prioridade alta

**Pré-condições:**
- O funil tem o campo «Observação» (chave observacao)

**Steps para reproduzir:**
1. Editar um evento e colocar «guardar em» = observacao
2. Tentar salvar

**Resultado esperado:**
- A tela mostra um erro (não um simples aviso) explicando o conflito com o campo do funil
- O evento NÃO é salvo

**Resultado da execução:** ⏳ pendente

---

### Cenário 6 — Evento que nunca recebeu nada diz isso
`CT-017.6 · FR-16 · e2e · sucesso · prioridade alta · heurística: Visibilidade do estado do sistema

**Pré-condições:**
- Evento view_item recém-cadastrado, sem nenhum recebimento

**Steps para reproduzir:**
1. Abrir a seção de eventos

**Resultado esperado:**
- O evento mostra «ainda não recebeu nada»

**Resultado da execução:** ⏳ pendente

---

### Cenário 7 — Evento que recebeu mostra último recebimento e contagem de 7 dias
`CT-017.7 · FR-16 · e2e · sucesso · prioridade alta · heurística: Visibilidade do estado do sistema

**Pré-condições:**
- Evento page_view; 3 chamadas de page_view feitas hoje

**Steps para reproduzir:**
1. Recarregar a seção de eventos
2. Olhar a linha do page_view

**Resultado esperado:**
- Aparece «visto pela última vez» com a hora da chamada mais recente
- A contagem dos últimos 7 dias mostra 3

**Resultado da execução:** ⏳ pendente

---

## Cobertura

| Story | Requisitos | Cenários | Camadas | Última rodada | Observação |
|---|---|---|---|---|---|
| US-001 | — | — | — | — | sem cenário: ver abaixo |
| US-002 | FR-1, FR-2 | CT-002.1 … CT-002.5 (5) | 4i / 1e2e | 5⏳ | — |
| US-003 | FR-1 | CT-003.1 … CT-003.3 (3) | 3i / 0e2e | 3⏳ | — |
| US-004 | FR-7 | CT-004.1 … CT-004.2 (2) | 2i / 0e2e | 2⏳ | — |
| US-005 | FR-7 | CT-005.1 … CT-005.2 (2) | 2i / 0e2e | 2⏳ | — |
| US-006 | — | — | — | — | sem cenário: ver abaixo |
| US-007 | — | — | — | — | sem cenário: ver abaixo |
| US-008 | FR-4, FR-5, FR-6 | CT-008.1 … CT-008.15 (15) | 15i / 0e2e | 15⏳ | — |
| US-009 | FR-8, FR-9, FR-10, FR-12 | CT-009.1 … CT-009.11 (11) | 11i / 0e2e | 11⏳ | — |
| US-010 | FR-1, FR-3, FR-11, FR-13, FR-14 | CT-010.1 … CT-010.13 (13) | 12i / 1e2e | 13⏳ | — |
| US-011 | FR-4, FR-15 | CT-011.1 … CT-011.4 (4) | 3i / 1e2e | 4⏳ | — |
| US-012 | — | — | — | — | sem cenário: ver abaixo |
| US-013 | FR-16, FR-17 | CT-013.1 … CT-013.2 (2) | 2i / 0e2e | 2⏳ | — |
| US-014 | FR-1, FR-2, FR-3, FR-16, FR-17 | CT-014.1 … CT-014.13 (13) | 12i / 1e2e | 13⏳ | — |
| US-015 | FR-2, FR-17 | CT-015.1 … CT-015.6 (6) | 6i / 0e2e | 6⏳ | — |
| US-016 | FR-1, FR-3, FR-16 | CT-016.1 … CT-016.11 (11) | 0i / 11e2e | 11⏳ | — |
| US-017 | FR-16 | CT-017.1 … CT-017.7 (7) | 0i / 7e2e | 7⏳ | — |
| US-018 | — | — | — | — | sem cenário: ver abaixo |
| US-019 | — | — | — | — | sem cenário: ver abaixo |

### Histórias sem cenário
- US-001: Documento de investigação (docs/design/eventos-do-funil-fase-0.md); não há comportamento para o QA executar.
- US-006: Funções puras de caminho e valor: teste unitário, fora do público deste documento. O comportamento aparece nos CT-009.5 a CT-009.9.
- US-007: Funções puras de decisão de movimento: teste unitário. O comportamento aparece nos CT-010.x.
- US-012: Prova do mantenedor pelo MCP direto, com tabela anexada ao PR. Os CT-008 a CT-011 refazem essa prova como cenários.
- US-018: Prova do mantenedor pela tela (spec Playwright e evidência). Os CT-016 e CT-017 refazem essa prova como cenários.
- US-019: Entrega documental (nota de versão e guia da Bella Capri), conferida por pnpm release:conferir e por revisão.

### Requisitos sem cenário
- nenhum

### Fora de escopo (Non-Goals do PRD)
- Evento de cancelamento ou perda pelo navegador; etapa de perda como destino (coberto só como recusa: CT-014.6).
- Modelo pronto / «aplicar modelo»: o cadastro é sempre à mão (CT-002.4 confere que nada nasce semeado).
- Mostrar o nome do evento no lugar de «Registro de uma integração» na linha do tempo.
- Teto máximo para o valor da venda (decisão do dono; CT-009.9 confere que não há).
- Alterar o comportamento de crm_add_lead_events ou crm_move_lead_stage (CT-011.3 confere que a primeira não mudou).
- Eventos por perfil de usuário e permissão por evento.

### Bloqueado por perguntas em aberto
- Evento com campo do valor cadastrado, mas sem esse campo no envio: a especificação não diz se é recusado (valor_invalido) ou registrado sem valor. Sem cenário até decidir.
- Resultado de um event_id já gravado por queda anterior: a tabela de resultados diz que «repetido» não faz mais nada, e o algoritmo diz que estado e valor ainda são aplicados. O CT-009.11 só afirma o estado final do card.
- Aviso de valor muito acima da média (pergunta em aberto 1 do PRD): fora das histórias.
- Contagem dos últimos 7 dias: usa a hora do evento (at) ou a hora do recebimento? Sem cenário de borda até decidir.
- Retenção: apagada a atividade, o mesmo event_id volta a ser aceito (pergunta 7 do PRD): comportamento a documentar, não a testar.

### Comportamento não documentado encontrado
- nenhum
