# Pacote de implantação — Bella Capri · loja RPA - Abrão Thomé (piloto)

> Documento de implantação gerado pela triagem do guia `deskcomm-cliente-novo`.
> Estado: **rascunho — nada publicado**. Publicar é ato humano, depois do botão Testar.
> **Nunca escreva aqui chave de IA, token `dsk_` ou senha.**

## 1. O negócio

| item | valor |
|---|---|
| Marca | Bella Capri — rede de pizzarias, 50 lojas |
| Loja piloto | RPA - Abrao Thomé |
| O que vende | pizzas, bebidas, massas e afins |
| Fuso | America/Sao_Paulo (assumido pelo DDD 41; **confirmar**) |
| Razão social | **pendente** (nomeia o controlador na LGPD) |

## 2. Estrutura da rede

- **Um tenant por loja**, cada um com o próprio número de WhatsApp. Estratégia: fechar a loja-piloto
  de ponta a ponta e só depois replicar para as outras 49 (a aplicação é manual, pela tela).
- Organização da piloto: `e6feb6df-0720-49af-a81c-33890fb6d9b1` (instalação local).
- **Acesso por usuário (decisão em aberto):** uma loja = vínculo a 1 tenant; grupo de lojas = N vínculos
  (sem conceito de grupo/região, troca pelo seletor de organização, sem visão somada); administrador
  que vê tudo = `platform_admins` (visão de plataforma, entra em loja via suporte temporário).
  Visão consolidada da rede sai de consultas agregadas (`deskcomm-metricas`), não de tela do produto.
  Se for requisito firme, avaliar extensão/PR no núcleo (`deskcomm-extensao`).

## 3. Canal

| item | valor |
|---|---|
| Número | 55 41 92010-9468 ("WB André"), sessão NOWEB, status WORKING (conferido no banco em 28/10/2026) |
| Agente | responde **24 h** |
| Atendimento humano | **todos os dias, 18h–23h** |
| Fora do horário humano | o agente avisa que a equipe responde a partir das 18h |

## 4. IA

| item | valor |
|---|---|
| Provedor | OpenAI |
| Chave | **pendente** — cadastrar em IA › Credenciais e esperar "validada" |
| Áudio | a mesma chave de OpenAI transcreve áudio (cliente de pizzaria manda muito áudio) |
| Teto de gasto | **US$ 10/mês** (o produto pausa o agente ao estourar) |
| Modelo do atendimento | **pendente** — um modelo que use ferramentas; escolher em IA › Provedores |

## 5. Funil "Pedidos — Cardápio Digital" (pipeline da loja)

Funil redefinido em 28/10/2026 (substitui o de 6 etapas com "Link Enviado"). A Bella NÃO move cards: o negócio nasce
em **Conversas** e todas as etapas seguintes são movidas pelo **cardápio digital via MCP**.

| # | Etapa | Evento do cardápio | Quem move | Papel |
|---|---|---|---|---|
| 1 | **Conversas** | — | nasce aqui (conversa iniciada pelo cliente ou pela plataforma) | etapa de entrada |
| 2 | **Visitas** | `page_view` | cardápio | — |
| 3 | **Visualizações** | `view_item` | cardápio | — |
| 4 | **Carrinho** | `cart_sync` | cardápio | — |
| 5 | **Revisão** | `begin_checkout` | cardápio | — |
| 6 | **Compras** | `purchase` | cardápio | **ganhou** |
| 7 | **Chamar Humano** | — | passagem para humano (slug `chamar-humano`) | — |
| 8 | **Cancelado** | `cancel` | cardápio | **perdeu** |

8 etapas = o teto do produto (4 a 8): não cabe mais nenhuma sem arquivar outra. Exatamente uma "ganhou" e uma "perdeu".

**Como ajustar o funil existente sem perder ids** (renomear mantém o id; só "Revisão" é nova):

| Etapa antiga (id) | Vira |
|---|---|
| Visitas (`6a3a1d29-e054-4f33-b406-dcb90ff9c948`) | **Conversas** |
| Link Enviado (`f80a9492-01a1-4ae7-8220-498c76a17bf8`) | **Visitas** |
| Visualização (`d5f2f5f4-1a68-43bc-baa3-a7fe47072d77`) | **Visualizações** |
| Carrinho (`2f0ccfbd-d090-4b50-8f72-ca222c2e951b`) | Carrinho (igual) |
| *(nova)* | **Revisão**, entre Carrinho e Compras (criar no fim e subir com "uma coluna para trás") |
| Compra (`9652f450-7bb7-48c7-889f-ae258cabb8cc`) | **Compras** |
| Chamar Humano (`663985b4-5b70-46da-85e6-ca306c7d22c2`) | igual |
| Perda (`927c63d1-e91a-4c43-9791-6dc19640b8a3`) | **Cancelado** |

Renomear não troca o slug (continuam `carrinho_abandonado`, `aguardando_pagamento`, `pago`, `cancelado` etc.): o
cardápio usa o **id** da etapa, nunca o slug. Só `chamar-humano` é lido por slug (pelo handoff).

**Para onde vai cada card (IA › Etapas do funil › "Para onde o card vai em cada passo"):**

| Passo do agente | Etapa |
|---|---|
| Novo lead | **Conversas** |
| Primeiro contato | Não mover o card |
| Em qualificação | Não mover o card |
| Qualificado | Não mover o card |
| Em negociação | Não mover o card |
| Ganho | **Compras** |
| Perdido | **Cancelado** |

Por quê: a Bella só conversa; o caminho de compra é registrado pelo cardápio. "Não mover" faz o espelho do motor
registrar `not_configured` só no log (medido: não abre aviso na Central). Manter Novo lead/Ganho/Perdido mapeados evita
o aviso de "funil mudo" na tela do agente. Isso também elimina a limitação da recompra: não há mais dependência da
transição `new → contacted` do motor.

**Decidido:** a passagem para humano move o card para **Chamar Humano do MESMO funil**. Funil separado foi descartado:
o produto não move entre funis (P-01, só clone) e o clone muda o id do negócio, quebrando o `idtrack` do cardápio.

**Vocabulário do funil:** Lead = Cliente, Deal = Pedido, Won = **Compra**, Lost = **Cancelado**.
"Exigir motivo de ganho" **desligado**. "Negócio encerrado que volta abre um negócio novo" **ligado** (a regra de
nascimento do negócio — só nasce se o contato não tem aberto — independe disso: ver "Estado dos testes").

**Cancelado exige `lost_reason`** quando movido pelo MCP. Sem lista própria valem os canônicos:
`requested_by_customer`, `price`, `no_response`, `product_unavailable`, `cancelled_by_store`, `cancelled_by_customer`,
`payment_failed`, `other`. O cardápio deve mandar `cancelled_by_customer` ou `payment_failed`, conforme o caso.
Motivos de perda próprios da Bella Capri: **pendente** (campo em branco por decisão do dono).

## 6. Integração do cardápio digital (decisão tomada, detalhes em aberto)

> **Atualização de 29/10/2026 (feature "Eventos do funil").** Os cinco eventos agora são **cadastrados à mão no funil**
> (Configurações › Funis › «Para onde o card vai em cada evento») e entram por uma operação só, que registra, guarda o
> estado, aplica o valor e move a etapa sem retroceder: `crm_track_event` (servidor, com token) **ou** o rastreador no
> site do cardápio (navegador, chave pública; manual para o time em `manual-rastreador-cardapio.md`). Detalhe e tabela de
> cadastro em `integracao-mcp-cardapio.md`, seção 5-A. Quando a compra também chegar por webhook, escolha **uma** porta
> (`docs/integracao/webhook-ou-rastreador.md`). O desenho abaixo (registrar + atualizar + mover, com a trava de níveis no
> cardápio) continua funcionando e está na seção 5-B do mesmo guia.
>
> **Fonte de verdade atual: `integracao-mcp-cardapio.md`** (mais `mcp-bellacapri.postman_collection.json`,
> `mcp-requests-postman.curl.txt` e `relatorios-bellacapri.sql`). As anotações históricas abaixo ficam como registro
> das decisões, mas o desenho ANTERIOR era: `page_view` e `view_item` são **registros que só crescem**
> (`crm_add_lead_events`, em lote, com `at` e `event_id`); `cart_sync`, `begin_checkout` e `purchase` são **estado**
> (`crm_update_lead`, JSON em `custom_fields.cart` / `checkout` / `pedido`); o pedido **não retrocede** (níveis 1 a 5,
> Chamar Humano fora); a ficha declara **9** campos. `crm_add_lead_events` está na `main` local
> (commit `ce188709d`) e roda na instalação local; depende de entrar no produto publicado (PR).

- Caminho escolhido: **MCP** — o backend do cardápio chama `/api/mcp` com `Authorization: Bearer dsk_…`
  (escopo `mcp:write`) e a ferramenta `crm_move_lead_stage`. O token fica **só no servidor** do cardápio.
  Um token por loja (Configurações › Tokens de API); 50 lojas = 50 tokens.
- As rotas REST `.../leads/[id]/move`, `/win` e `/lose` **não** aceitam bearer hoje; só o MCP e
  `PATCH /leads/[id]` (que não muda etapa) aceitam.
- **Decidido:** o link leva o parâmetro `?idtrack=<id do contato>` (`https://rpa.bellacapri.com.br/?idtrack=…`).
  A Bella não move etapa nenhuma (funil de 28/10/2026): o cardápio move Conversas → Visitas → Visualizações → Carrinho →
  Revisão → Compras/Cancelado. A loja é a organização já cadastrada (`e6feb6df-…`, "RPA - Abrao Thomé").
- **Como o cardápio acha o negócio do `idtrack`:** o negócio aberto do contato (`status=open`) quase sempre está em
  **Conversas** na primeira visita. Buscar `crm_list_leads(status=open, stage_id=<Conversas>, limit=100)` e escolher
  `contact_id == idtrack`; se não achar (visita repetida), buscar nas demais etapas abertas. Guardar o `id` do negócio
  e usá-lo nos `crm_move_lead_stage` seguintes. Em recompra o negócio aberto mais recente é o que vale.
- **Ids das etapas da loja RPA (conferidos no banco em 28/10/2026; por loja/tenant mudam):**

  | Evento | Etapa | `to_stage_id` |
  |---|---|---|
  | (nasce) | Conversas | `6a3a1d29-e054-4f33-b406-dcb90ff9c948` |
  | `page_view` | Visitas | `f80a9492-01a1-4ae7-8220-498c76a17bf8` |
  | `view_item` | Visualizações | `d5f2f5f4-1a68-43bc-baa3-a7fe47072d77` |
  | `add_to_cart` | Carrinho | `2f0ccfbd-d090-4b50-8f72-ca222c2e951b` |
  | `begin_checkout` | Revisão | `374d3ec8-b50d-46a7-888a-42a1d97be457` |
  | `purchase` | Compras (ganhou) | `9652f450-7bb7-48c7-889f-ae258cabb8cc` |
  | (handoff) | Chamar Humano | `663985b4-5b70-46da-85e6-ca306c7d22c2` |
  | `cancel` | Cancelado (perdeu; exige `lost_reason`) | `927c63d1-e91a-4c43-9791-6dc19640b8a3` |
- **Decidido (28/10/2026, SUBSTITUI tudo abaixo): `idtrack` = id do CONTATO (`contacts.id`).** Medido em conversa
  real: a Bella usa o id que o motor mostra como "lead" (= id do contato) e não chama as ferramentas de consulta,
  nem com o prompt mandando. O cardápio resolve o negócio do lado dele, só com MCP (sem mudar o CRM):
  1. `crm_get_contact(contact_id = idtrack)` → `phone` (login do cardápio sem digitar de novo; contato "pessoal"
     é recusado → login manual);
  2. `crm_list_leads(status=open, stage_id=<Conversas>, limit=100)` → a linha vem completa, com `contact_id`;
     escolher a de `contact_id == idtrack` (em recompra, a aberta mais recente);
  3. daí em diante usar o `id` do negócio em `crm_move_lead_stage` (Visualização → Carrinho → Compra).
  Tudo com `Authorization: Bearer dsk_…` (`mcp:read` e `mcp:write`), só no servidor do cardápio. O UUID no link é
  identificador, não credencial. Custo: varrer a lista de Conversas na primeira visita (irrelevante por loja).
  Alternativa descartada por ora: filtro `contact_id` de entrada em `crm_list_leads` (PR no núcleo).
- (histórico, superado) `idtrack` = id do NEGÓCIO (`crm_leads.id`), não telefone nem contato.
  Telefone na URL foi descartado por LGPD (log de servidor/CDN/histórico). Com o id do negócio o cardápio:
  1. `crm_get_lead(lead_id)` → linha do negócio, com `contact_id` (confirmar na 1ª chamada real);
  2. `crm_get_contact(contact_id)` → `phone`, usado para o login do cardápio sem o cliente digitar de novo
     (contato marcado "pessoal" é recusado → cair no login manual);
  3. `crm_move_lead_stage` para Visualização / Carrinho / Compra.
  Tudo com `Authorization: Bearer dsk_…` (escopos `mcp:read` e `mcp:write`), só no servidor do cardápio.
  O UUID no link é identificador, não credencial.
- **A validar no Testar:** a Bella só vê o id do CONTATO no contexto; precisa obter o id do NEGÓCIO por
  ferramenta antes de escrever o link, e copiá-lo sem erro. Se falhar, a saída é um PR no núcleo
  (filtro `contact_id` de entrada em `crm_list_leads`, ou rota com bearer).
- ~~**Aberto 1 — que id vai no `idtrack`:**~~ (histórico da análise) no motor do agente, o id que o modelo vê rotulado como "lead" é o do
  **contato** (`contact_id`), não o do **negócio** (`crm_leads.id`) que `crm_move_lead_stage` exige
  (`lib/ai/runtime/tools.ts`). O motor traduz contato → negócio aberto quando é o agente quem chama a
  ferramenta, mas o MCP chamado pelo cardápio **não** traduz.
- **Aberto 2 — como o agente escreve o id no link:** `{{placeholder}}` de id não é substituído pelo motor; o
  modelo teria que copiar o UUID do contexto para a URL, o que é frágil (um caractere errado e o rastreio se perde).
  Validar no botão Testar antes de depender disso.

## 7. Agente

| item | valor |
|---|---|
| Nome | Bella |
| Tom | caloroso e curto |
| Única operação | enviar o link do cardápio digital: `https://rpa.bellacapri.com.br/` |
| Não faz | pedidos, preço, status de pedido, reclamação, reserva, desconto |
| Tudo que não for cardápio/pedido | passa para o atendimento humano |
| Roteador | **não** (um agente só) |
| Base de conhecimento | **não** (preço e cardápio vivem no link) |
| Follow-ups | **não** nesta fase |
| Capacidades | mínimas: consultar o cadastro do cliente (para obter o código do atendimento), avançar o atendimento de fase (só no funil Pedidos) e passar para humano; nenhuma "crítica" ligada (nada de enviar mensagem avulsa, cancelar agenda, fechar caso) |

### Prompt (rascunho — a versão a colar em IA › Agentes)

```markdown
# Quem você é
Você atende os clientes da Bella Capri, uma rede de pizzarias, na unidade RPA - Abrão Thomé. Seu nome é Bella.
Fale de forma calorosa e curta.

# O que você faz
Seu único trabalho é levar o cliente ao cardápio digital, onde ele vê preços e faz o pedido.
Pedido, preço e sabores ficam todos no cardápio, não com você.

# O link do cardápio
O endereço do cardápio é https://rpa.bellacapri.com.br/ e o link que você envia sempre termina com o código do
cliente, escrito EXATAMENTE assim, com as chaves duplas:
https://rpa.bellacapri.com.br/?idtrack={{id_do_contato}}
- Escreva `{{id_do_contato}}` literalmente, sem trocar por nada: o sistema preenche o código certo do cliente
  na hora de enviar. Você não sabe o código e não precisa saber. Nunca use telefone, nome ou qualquer outro valor
  no lugar, e nunca copie o link de uma mensagem anterior: escreva o link de novo, com o marcador.
- Escreva ao cliente só a saudação e o link. Nunca explique o código, nunca fale em código, identificador,
  sistema ou cadastro nas mensagens. Para o cliente, é só o link do cardápio.

# Como você decide o próximo passo
- O cliente costuma mandar uma frase por mensagem. Antes de decidir, leia TODAS as mensagens que ele mandou
  desde a sua última resposta e trate tudo como um pedido só. Se alguma delas tiver uma pergunta ou pedido
  além de cumprimento (por exemplo "oi" e depois "quanto tempo demora a entrega?"), é essa pergunta que
  decide, nunca o cumprimento. Notas e o histórico de links já enviados não decidem nada.
- Se o cliente quer ver o cardápio, saber preço, sabor, bebida, massa ou fazer um pedido: envie o link com
  uma mensagem simpática e curta, dizendo que é por ali que ele vê tudo e faz o pedido.
- Se o cliente só cumprimentou: cumprimente e já envie o link, na mesma mensagem. Não pergunte se ele quer
  o cardápio: envie.
- Se a mensagem for só um sinal de presença, como "alô", "?", "alguém aí?", "oi?" ou só um emoji: o cliente
  está esperando resposta. Cumprimente e envie o link, sem chamar a equipe.
- Se for qualquer outra coisa: escreva ao cliente a mensagem da equipe (veja "Horário da equipe") e chame
  uma pessoa do time. Nesses casos você não faz perguntas, não argumenta, não tenta convencer e não tenta
  entender o motivo.
- Sempre escreva a mensagem ao cliente. Nunca chame a equipe em silêncio: o cliente precisa ler que alguém vai
  atendê-lo.

# Situações
- Preço ou o que tem no cardápio: não diga valores. Envie o link, é lá que está tudo atualizado.
- Prazo ou tempo de entrega, taxa de entrega, endereço, "cadê meu pedido" ou qualquer pergunta sobre um pedido
  já feito: escreva a mensagem da equipe e chame uma pessoa do time. Não responda com o link.
- Acompanhar ou mudar um pedido, reclamação, elogio, reserva, evento, pagamento, entrega ou qualquer dúvida
  que o cardápio não resolva: chame uma pessoa do time.
- Desconto, promoção, combo, preço para quantidade ou qualquer pedido para pagar menos: você não negocia e
  não pergunta o porquê. Escreva a mensagem da equipe e chame uma pessoa do time.
- Você nunca anota pedido por mensagem. Pedido é feito pelo cardápio.
- Se o cliente que já pediu voltar a pedir, envie o link de novo, escrito com o marcador {{id_do_contato}}.

# Horário da equipe
A equipe atende todos os dias das 18h às 23h, no horário de Brasília. Você não sabe que horas são, então
nunca prometa resposta imediata. Sempre que for chamar uma pessoa, escreva ao cliente algo assim, com suas
palavras e curto:
"Vou chamar a equipe pra te ajudar com isso. Eles atendem todos os dias das 18h às 23h e te respondem assim
que estiverem no horário. Você não precisa repetir o pedido."
Nunca diga "em instantes", "já já" nem "agora". Enquanto isso, você continua disponível para enviar o cardápio.

# Limites
Você não faz pedidos, não informa preço, não promete prazo, desconto nem entrega.
Você não fecha atendimento. Você chama uma pessoa do time para tudo que não seja enviar o cardápio.

# Estilo
Mensagens curtas, uma ideia por vez, sem jargão. Emoji com parcimônia (um, no máximo).
```

Notas do prompt: sem nome de ferramenta nem vocabulário interno; sem preço (uma fonte de verdade, o link);
"que horas são" já vem no contexto do turno, por isso a regra do horário funciona sem hora fixa no texto
além das 18h–23h.

### Skills da plataforma que precisam ser sobrescritas (IA › Skills)

A plataforma traz `objecao-preco` e `agendamento` ativas para toda organização; a primeira dispara com
"desconto/caro/mais barato" e faz a Bella negociar. A skill da organização vence a da plataforma de mesmo
nome: instalar, abrir o editor e trocar o **corpo** (manter o matcher).

⚠️ Medido em 28/10/2026: o matcher olha o histórico recente, não só a última mensagem. Um contato que já falou de
desconto (ou cujo atendente humano falou) dispara a skill mesmo quando escreve só "quero fazer um pedido", e a
Bella passava para humano em vez de mandar o link. Por isso o corpo abaixo limita a skill à ÚLTIMA mensagem.

`objecao-preco`:
```
Esta regra só vale quando a ÚLTIMA mensagem do cliente pede desconto, promoção ou reclama do preço. Nesse caso, a Bella Capri não negocia nem pergunta o motivo: escreva ao cliente que vai chamar a equipe, que ela atende todos os dias das 18h às 23h e responde assim que estiver no horário, e então chame uma pessoa do time. Nunca chame a equipe sem escrever essa mensagem. Não faça perguntas.
Se a última mensagem for cumprimento, pedido, pergunta sobre o cardápio ou qualquer outro assunto, ignore esta regra por completo e siga as instruções principais: envie o link do cardápio.
```

`agendamento`:
```
Esta regra só vale quando a ÚLTIMA mensagem do cliente pede para marcar, remarcar ou cancelar horário ou reserva. Nesse caso, a Bella Capri não agenda nada: escreva ao cliente que vai chamar a equipe, que ela atende todos os dias das 18h às 23h e responde assim que estiver no horário, e então chame uma pessoa do time. Nunca chame a equipe sem escrever essa mensagem. Não faça perguntas.
Se a última mensagem for cumprimento, pedido, pergunta sobre o cardápio ou qualquer outro assunto, ignore esta regra por completo e siga as instruções principais: envie o link do cardápio.
```

## Estado dos testes reais (28/10/2026) e limitações conhecidas

Provado em conversa real com o funil ANTERIOR (versão 3 do agente + mapeamento Primeiro contato → Link Enviado; histórico):
- Contato novo: a Bella responde com o link, `idtrack` = id do contato, e o card vai de Visitas para Link Enviado
  (transição `new → contacted` do motor, espelhada no CRM).
- Passagem para humano e skills: sem disparo indevido depois de limitar as skills à última mensagem.

**Recompra (resolvida pelo funil de 28/10/2026).** Antes, o estado do motor (`lead_state`, por contato) não reiniciava
ao fechar o negócio e o negócio novo da recompra ficava em Visitas mesmo com o link enviado (provado no +5517982290042).
Com o funil novo a Bella não depende mais dessa transição: o negócio nasce em **Conversas** (regra: só nasce se o contato
não tem negócio aberto) e o cardápio o move. A confirmar na primeira recompra real.

Outros pontos observados: a 1ª tentativa de mensagem da Bella é vetada pelo portão de vocabulário
(`internal_vocabulary_leak`) na maioria dos turnos e a 2ª sai certa; o aviso automático de passagem para humano é texto
fixo do produto e não cita o horário das 18h às 23h.

## 8. Memória da organização (regras da casa) — rascunho

- A equipe de atendimento humano trabalha todos os dias, das 18h às 23h (horário de Brasília).
- O cardápio digital da loja é https://rpa.bellacapri.com.br/ e é o único meio de ver preços e fazer pedido.
- Endereço, horário de funcionamento da loja e formas de pagamento: **pendente** (só entra se a pessoa quiser
  que o agente os diga; hoje o escopo é só o link).

## 9. Roteiro de teste (botão Testar, 5 mensagens)

1. "Oi" — deve cumprimentar e enviar o link.
2. "Quanto custa a pizza de calabresa?" — não pode dizer valor; envia o link.
3. "Quero fazer um pedido" — envia o link; não anota pedido.
4. "Meu pedido atrasou" — chama uma pessoa e informa o horário da equipe.
5. "Tem desconto pra 3 pizzas?" — não promete; chama uma pessoa.
Fora de 18h–23h, as mensagens 4 e 5 devem dizer que a equipe responde a partir das 18h.

## 10. Checklist de entrega (preencher na tela)

- [ ] Credencial OpenAI cadastrada e **validada**
- [ ] Modelo do atendimento escolhido (IA › Provedores)
- [ ] Funil de 6 etapas, uma "ganhou" (Compra) e uma "perdeu" (Perda), mapa dos 7 passos
- [ ] Teto de US$ 10/mês configurado
- [ ] Agente criado em rascunho com o número WORKING
- [ ] Memória publicada
- [ ] Testes 1–5 respondidos como esperado
- [ ] **Publicar (clique da pessoa)**
- [ ] Token `dsk_` da loja gerado e entregue ao backend do cardápio
- [ ] Decisões abertas da seção 6 fechadas
- [ ] Usuários e vínculos por loja/grupo definidos (seção 2)
