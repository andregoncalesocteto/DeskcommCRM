# Plano de migração: protótipo do PDV para dentro do DeskcommCRM

Versão: 0.9 (rascunho)
Data: 2026-11-16
Relacionado: [prd-fr-010-pdv-balcao-e-telefone.md](prd-fr-010-pdv-balcao-e-telefone.md), [prd-call-center-pdv-visao-geral.md](prd-call-center-pdv-visao-geral.md)

> **Como ler.** "Lido no código" significa conferido por leitura de arquivos, feita por um agente de busca sobre a `main` local do DeskcommCRM e por mim sobre o protótipo. Nada foi executado: nem o protótipo, nem o CRM, nem os testes. Os tamanhos são estimativas de ordem de grandeza.

---

## 1. O que se migra e o que não

O protótipo (`cart-craft-counter`) é um front-end em TanStack Start, React 19, Tailwind 4 e shadcn, com estado local e dados de exemplo. O DeskcommCRM é Next.js 16 com Supabase e RLS. **O código não migra direto.** O que se aproveita:

| Do protótipo | Destino | Observação |
| --- | --- | --- |
| Componentes de UI (shadcn) | Reaproveitar a composição e o estilo | O CRM também usa shadcn (`new-york`), então a conversão é de rota e de estado, não de biblioteca |
| Regras puras de `customers.ts` (máscaras, CPF, data, validação de endereço, endereço principal, remoção com novo principal) | Reescrever no CRM com os mesmos casos de teste | O CRM já tem validação de CPF por módulo 11 em `lib/schemas/contacts.ts`; reutilizar |
| Testes em `src/test/` | Viram a especificação dos testes novos | Servem de cenários, não de código |
| `menu.ts` (preço, meio a meio, adicionais) | Não migra como regra | O preço vem do ERP; o protótipo vira só a referência da forma do item |
| `orders.ts` (taxa fixa, pagamento) | Não migra | Diverge do PRD (ver PRD do FR-010) |
| `aiService.ts` (assistente por regras) | Não migra o parser. Migram o conjunto de ações e os casos de teste como especificação | O parser vira um ponto de IA que devolve ações estruturadas (D5) |
| `session-store.ts` (estado em memória) | Troca por estado no servidor | Carrinho e pedido precisam sobreviver ao recarregamento e ser auditáveis |

---

## 2. O que o CRM já tem e o que falta (lido no código)

| Necessidade do PDV | Situação no CRM | Evidência |
| --- | --- | --- |
| Cadastro de cliente | **Existe** como contato: nome, e-mail, telefone (E.164), CPF cifrado com hash, data de nascimento | `contacts` em `supabase/baseline.sql` |
| Unicidade de CPF, telefone e e-mail por organização | **Existe** (índices parciais) | `uniq_contacts_org_cpf/phone/email` |
| Busca de cliente por telefone, nome ou CPF | **Existe** na API de contatos, inclusive CPF por hash e variantes do telefone brasileiro | `GET /api/v1/contacts?search=`, `crm_search_contacts` |
| Endereço de contato, vários por cliente | **Ausente.** Só caberia em `custom_fields` | Sem `contact_addresses`; spec de vários telefones é só rascunho |
| Catálogo | **Existe, plano**: código, nome, descrição, preço, foto, estoque | `catalog_products` |
| Tamanho, meio a meio, adicionais, preço por loja | **Ausente** | Cada tamanho teria que ser um produto |
| API de catálogo e de contatos com token `dsk_` | **Parcial.** Contatos aceita bearer só na listagem; produtos só aceita sessão | `lib/auth/public-paths.ts` |
| Entidade de pedido | **Parcial.** `orders` é espelho de e-commerce (`nuvemshop`, `vtex`, `shopify`), sem itens | CHECK de `external_provider` |
| Análogo de venda com itens | **Existe no módulo Comandas** (`sales`, `sale_items`), mas é de serviço, com comissão e fidelidade | `fn_financeiro_provisionar` |
| Módulo opcional, desligado por padrão, com tabelas próprias | **Existe**, com dois exemplos (Honorários e Comandas) | ADR-0002, `lib/instalacao/modulos.ts` |
| Navegação de módulo | **Existe**: porta no `NAV_CATALOG` com `modulo: "<slug>"` e `notFound` no layout | `lib/navigation/catalogo.ts` |
| Fila e worker com retentativa e aviso | **Existe**: `event_log`, dreno, backoff, aviso `event_dead` | `lib/event-log/drain.ts` |
| Idempotência na criação | **Existe**: `Idempotency-Key` com recibo no Postgres | `lib/api/idempotency.ts` |
| Chamada de MCP externo pelo servidor | **Existe**, com cabeçalhos de identidade e proteção anti-SSRF | `lib/mcp/servidor-externo/` |
| Escrita remota durante a conversa da IA | **Recusada por desenho** | `escrita_sem_escopo_do_turno` |
| Aviso na Central para pedido não enviado | **Ausente**; o tipo de aviso é uma lista fechada no banco | `agent_inbox_items_kind_check` |
| Painel de carrinho na lateral do inbox | **Ausente**; a lateral é um catálogo fixo, sem plug-in | `MODULOS_DA_LATERAL` |
| Eventos do app no funil | **Existe**: coleta pública com chave, carrinho como projeção no lead | `POST /api/v1/coleta/[chave]`, `cart_sync` |
| Carrinho abandonado | **Ausente** como conceito (só nome de etapa de funil) | Sem detector |
| Rede de lojas, consolidação | **Ausente** | Sem relação entre organizações |
| Permissão por loja dentro de um tenant | **Ausente, e não é necessária** | Todos os operadores do tenant atuam em todas as lojas dele |

---

## 3. Decisões que precisam sair antes de construir

### D1. Tenants e lojas (decidido em 2026-11-16, revisada)

Decisão: **um tenant por unidade operacional, cada um com a lista das lojas que atende, mais um tenant do Call Center que atende todas.** Exemplos: Campinas atende a loja CAS; Rio Preto atende RPA, RPV, RPR e RPI; o Call Center atende todas. Cada tenant tem as suas conexões, os seus agentes e a sua configuração. **Todos os operadores do tenant atuam em todas as lojas dele** (o balcão de Rio Preto vê as quatro).

Esta decisão **substitui** duas anteriores: a organização única com grupos de lojas, e a versão em que cada operador tinha um escopo de lojas dentro do tenant. A atual é a mais simples: respeita o isolamento por tenant que o CRM já tem, **não exige acesso entre organizações** (o ERP é a camada comum) e **não exige permissão por loja** dentro do tenant.

**Modelo proposto** (nomes provisórios):
- `pdv_stores`: as lojas que o tenant atende, com o identificador do ERP (por exemplo CAS, RPA, RPV, RPR, RPI).
- Pedido, endereço e tentativa de envio levam `store_id`.
- Mapeamento **conexão para loja** (um número de WhatsApp por loja, dentro do tenant), para a loja do pedido ser definida pelo canal de entrada, como o PRD pai decide.
- Não há tabela de grupos nem de escopo de operador: o tenant é o grupo, e o papel `agent` já basta.

**Regras:**
- O tenant é resolvido no servidor, a partir do usuário autenticado. A loja que vem na requisição é validada contra as lojas do tenant e nunca vale sozinha.
- RLS por tenant, que já existe. Consultas com acesso privilegiado filtram também pela loja do tenant, não só pelo tenant.
- O ERP é o cadastro mestre de cliente e fornece o histórico completo. Cada tenant guarda um contato espelho com o identificador do ERP.
- No tenant do Call Center, o pedido é registrado para qualquer loja e fica no tenant do call center.

**Consequências que precisam de decisão:**
- **Pedido do call center para loja de outro tenant:** fica só no tenant do call center, **sem cópia** no tenant da loja (confirmado em 2026-11-16). O painel por loja (FR-005) e a visão da rede saem do ERP ou de relatório.
- **Loja calculada fora do tenant:** em entrega, o ERP calcula a loja pelo endereço. Se ela não pertence ao tenant do operador, recusa ou encaminha?
- **Cliente em vários tenants:** contatos espelhados; pedido de LGPD precisa ser cumprido em cada tenant.
- **Administração:** aba **Lojas** na configuração do tenant, no mesmo grupo de Equipe e Agentes. Lista as lojas do tenant, o código do ERP e a conexão de WhatsApp de cada uma. No CRM, cada porta de configuração é uma entrada do `NAV_CATALOG` (grupo, seção, papel mínimo, e `modulo:` para aparecer só com o módulo ligado), então a aba é uma entrada com `modulo: "pdv"` no grupo `organizacao`. Não achei no catálogo um item chamado "Saúde"; o encaixe exato da aba precisa ser conferido na implementação.

**Comparação, para registro:** a organização única com grupos dava atendimento de qualquer loja e painel consolidado, mas perdia o isolamento por RLS entre lojas e exigia construir grupos e escopos; um tenant por loja isola, mas o call center não enxergaria as lojas. A configuração por unidade operacional resolve os dois, ao custo de o pedido do call center ficar no tenant dele.

### D2. Onde mora o cliente
Decisão já tomada nas interfaces: o ERP é o cadastro mestre. O CRM já tem contatos que sustentam conversas, funil e LGPD. Proposta: o contato guarda o identificador do ERP, e é criado ou atualizado quando o atendente seleciona o cliente. Precisa de regra para conflito (CPF igual com dados diferentes).

### D3. Onde mora o pedido
O pedido é usado por todos os canais (PDV agora, WhatsApp e app depois). Proposta: tabelas do pedido dentro do módulo `pdv` (ver ADR-0002), em vez de reaproveitar `orders` (espelho de e-commerce, sem itens) ou Comandas (serviço, com comissão). Quem decide é um ADR, porque estender Comandas é a alternativa mais barata e a mais torta.

### D4. Cardápio e preço: do ERP, não do catálogo
Pelo PRD, o ERP é a fonte única de preço, estoque e taxa. Então o PDV **não** usa `catalog_products` como fonte: consulta o ERP por loja e grava no item o preço informado. Isso dispensa criar variação de tamanho, meio a meio e adicionais no catálogo do CRM, e elimina o risco de divergência. O catálogo do CRM segue só para a IA de atendimento.

### D5. O assistente do atendente (decidido: entra)
Decidido em 2026-11-16: o assistente faz parte do FR-010 (sub-requisito FR-010.8). Desenho:
- **Não usa o runtime de atendimento por turno de contato.** Ele limita as escritas ao contato da conversa (`escritaCabeNoTurno`), e uma ferramenta de pedido seria recusada. Mexer nisso é mudança de núcleo.
- **Segue o precedente de "Conversar com o caso"** (`lib/agent-engine/agent/conversa-do-caso.ts`, rota `app/api/v1/ai/cases/[id]/chat`): ponto de IA próprio (por exemplo `pdv_assistant`) que reaproveita agente, provedor, credencial, orçamento (sem isenção) e rastro (`llm_calls`). Esse emissor mora em `lib/agent-engine/`, onde um teste varre a herança de provedor.
- **Devolve ações propostas, não executa.** O formato é o do protótipo (`adicionar_item`, `remover_item`, `identificar_cliente`, `definir_tipo`, `definir_loja`, `definir_endereco`, `pendencias`…). O PDV valida cada ação no servidor contra o ERP e a aplica; o atendente confirma o pedido.
- **Minimização de dados:** só o primeiro nome do cliente e o necessário para montar o pedido vão ao modelo; CPF, telefone e e-mail não. O `conversa-do-caso` já segue essa regra.
- **Conjunto de ferramentas de pedido compartilhado:** as consultas de cardápio, loja e disponibilidade no ERP podem servir ao assistente do PDV e à IA do WhatsApp (FR-003), em vez de duas implementações.
- **Pontos a verificar na implementação (não confirmados):** se um ponto de IA novo exige registro no catálogo de provedores e propósitos, e se `PURPOSES_ISENTOS` precisa de ajuste para o teto de orçamento.

---

## 4. Desenho proposto do módulo

Slug `pdv`, módulo oficial com tabelas próprias, instalado pelo administrador da instalação em `/admin/modulos`.

**Tabelas do módulo** (nomes provisórios; criadas pela função `fn_pdv_provisionar`, não no baseline para todos):
- `pdv_orders`: organização, contato, loja, origem (telefone, balcão), tipo (balcão, entrega), endereço (cópia no momento do pedido), estado (rascunho, confirmado, enviado, recusado, cancelado), totais e taxa informados pelo ERP, chave de idempotência, identificador do ERP, atendente.
- `pdv_order_items`: produto do ERP, nome e tamanho no momento, quantidade, preço unitário informado pelo ERP, composição (meio a meio, adicionais, removidos, observação).
- `pdv_order_attempts`: tentativas de envio, dados enviados, resposta do ERP, erro.
- `pdv_customer_links`: vínculo do contato espelho com o cliente do ERP. **Os endereços do cliente não são guardados no CRM**: o ERP é o cadastro mestre e os devolve em `obter_cliente`; o pedido guarda só a cópia do endereço usado (ver o Design Doc, `modulo-pdv/design-modulo-pdv.md`, seção 4).
- `pdv_stores` (as lojas que o tenant atende), mais o mapeamento conexão para loja, pela decisão D1.

**Regras herdadas da doutrina do CRM:**
- RLS em toda tabela, com `organization_id` (o tenant), a loja validada contra as lojas do tenant, e teste de isolamento entre dois tenants.
- A criação do pedido aceita `Idempotency-Key`, grava auditoria e exige `requireRole` com papel mínimo de atendente.
- O envio ao ERP não acontece na requisição: o pedido confirmado emite um evento, e um worker o envia, com retentativa e aviso na Central quando esgotar.
- O CPF segue cifrado, com hash para busca; endereço e pedido entram na anonimização LGPD.

**Envio ao ERP:** o worker chama o MCP externo registrado na instalação. A restrição de escrita remota vale só para o turno de conversa da IA, então um worker não é bloqueado por ela. O que precisa de verificação é a **latência**: o dreno do `event_log` roda por cron, e o PRD exige envio em até 60 segundos.

**Telas** (Next.js, App Router): `app/app/pdv/` com layout que dá `notFound()` quando o módulo está desligado, e uma porta em `NAV_CATALOG`.

---

## 5. Fases

| Fase | Entrega | Depende de | Tamanho (estimativa) |
| --- | --- | --- | --- |
| 0 | Decisões D1 a D5 registradas em ADR; contrato do ERP para cliente, endereço, CEP, loja, taxa e pedido | Dono do projeto; equipe do ERP | Pequeno, mas bloqueia tudo |
| 1 | Esqueleto do módulo: provisionadora, flag, texto no catálogo de recursos, porta, layout com `notFound`, gate de tools, e lojas do tenant com a aba Lojas na configuração e o mapeamento conexão para loja, com RLS | Fase 0 (D1 e D3) | Pequeno a médio |
| 2 | Cliente e endereços: busca, cadastro, edição de nome, CPF e nascimento, CRUD de endereços, CEP e loja pelo ERP | Fase 1; contrato do ERP | Médio a grande |
| 3 | Cardápio e carrinho: busca de produtos pelo ERP, configurador de pizza, carrinho no servidor | Contrato de cardápio | Grande |
| 4 | Pedido rascunho, confirmação, worker de envio ao ERP, idempotência, aviso na Central | Fases 1 e 3; kind novo de aviso (migration, texto, política) | Grande |
| 5 | Histórico do cliente e repetir último pedido | Fase 4 | Pequeno |
| 6 | Assistente do atendente: ponto de IA com ações estruturadas, painel de conversa, validação das ações contra o ERP, orçamento e rastro | Fases 2 a 4 | Grande |
| 7 | Piloto na loja piloto, com QA guiado, avaliação com frases reais dos atendentes e prova pela tela em ambiente fresco | Fases 2 a 6 | Médio |

### Trilha do ERP e homologação (decidido em 2026-11-16)

O módulo **nasce consultando o ERP de verdade**; não haverá ERP de mentira. Como o ERP ainda não tem ambiente de homologação, ele é criado em paralelo, e cada fase do CRM depende da fatia do ERP que ela consome.

**Tarefa de abertura (E0), na fase 0:**
- Ambiente de homologação do ERP, separado da produção (instância ou banco próprio e credencial própria).
- Dados de exemplo **fictícios**: as lojas CAS, RPA, RPV, RPR e RPI, alguns clientes com vários endereços (inclusive um sem endereço e um com endereço fora de qualquer área), CEPs de teste e um cardápio com tamanhos, adicionais e meio a meio. Os dados do protótipo servem de ponto de partida. Nenhum dado real de cliente entra na homologação (LGPD).
- Um comando para repor os dados de exemplo ao estado inicial.
- Servidor MCP autenticado com a primeira ferramenta, `listar_lojas`.
- No CRM, o endereço e a credencial do ERP são configuração por ambiente.
- **Acesso (decidido em 2026-11-16):** a homologação roda na rede local, em HTTP. O CRM recusa HTTP em produção e hosts privados, e não há exceção configurável. Por isso um **túnel HTTPS** (tarefa do dono do projeto, fora do repositório do ERP) publica a homologação num nome público. Só dados fictícios, só o servidor MCP exposto, chave por tenant. Uma exceção controlada no guard do CRM fica como plano B, e seria mudança de núcleo.

**Regra de ordem:** uma tarefa do CRM só começa quando a ferramenta do ERP que ela usa está em homologação e uma resposta real dela foi salva como amostra.

**Handoffs:** como o ERP fica em outro repositório, cada fatia sai como um documento de handoff autossuficiente em `handoff-erp/` (processo, modelo e índice no `README.md` da pasta) e volta como devolutiva com amostras reais.

| Fase do CRM | Fatia do ERP antes dela |
| --- | --- |
| 0.4 e 1 | E0 com `listar_lojas` |
| 2.2 e 2.3 | `buscar_cliente`, `obter_cliente` |
| 2.4 | `consultar_cep`, `loja_do_endereco`, `salvar_endereco`, `remover_endereco`, `definir_endereco_principal` |
| 2.5 | `cadastrar_cliente`, `atualizar_cliente` |
| 3.1 | `consultar_cardapio`, `consultar_disponibilidade` |
| 3.2 | `calcular_total` |
| 4.1 a 4.4 | `criar_pedido`, `consultar_pedido`, `cancelar_pedido` |
| 5.1 | `consultar_historico_do_cliente` |

**Testes:** a suíte automática do CRM não depende do ERP no ar. Testes unitários e de contrato usam **amostras gravadas das respostas reais** da homologação; testes de integração e a prova pela tela rodam contra a homologação.

Fora desta sequência, mas ligados ao PRD pai: o painel do carrinho no inbox (FR-013) exige um id novo no catálogo da lateral e um bloco novo na lateral; o detector de carrinho abandonado (FR-012) não existe e é trabalho próprio.

---

## 6. Riscos específicos da migração

1. **Fork e merge.** O código do módulo fica só no fork da rede. Cada migration nova disputa numeração com o upstream, e a doutrina do CRM cobra a "tripla" (migration, apêndice no baseline, linha `-- manifest:`) e a checagem de colisão. Planejar a numeração a cada merge.
2. **Pedido de uma loja registrado em outro tenant.** O call center registra pedido para lojas de outros tenants, e o pedido fica só no tenant do call center, sem cópia (decidido em 2026-11-16). Afeta o painel por loja (FR-005). Mitigação: gravar no ERP a origem e o tenant de origem e tirar os números por loja do ERP.
3. **Contrato do ERP incompleto.** O ERP é domínio do dono do projeto e ajustável, então o risco é de esforço e de ordem de entrega, não de dependência externa. O PDV amplia a lista de ferramentas (cliente, endereço, CEP, loja, taxa); o levantamento está em `contrato-mcp-erp.md`.
4. **Latência do worker.** Menor do que eu havia escrito: o `worker` do compose de produção drena o `event_log` em 2 s com fila e até 10 s parado (`lib/event-log/drain-loop.ts`, `EVENT_LOG_WORKER_DRAINS`), e o cron de 1 minuto é só rede de segurança. O envio em até 60 segundos é viável sem mudar a infraestrutura; falta medir com o handler real.
5. **Definition of Done do CRM.** Mudança de schema e de UI exige prova pela tela em ambiente fresco e teste `pnpm test:db`. O protótipo não substitui essa prova.
6. **Latência do cálculo de preço.** O ERP calcula tudo, inclusive o meio a meio, então o configurador de pizza chama o ERP a cada mudança. Mitigação: uma chamada por item, com espera curta antes de chamar (debounce) e cache curto por combinação.
7. **Custo e erro do assistente.** O custo de IA cresce com o uso e uma interpretação errada gera pedido errado. Mitigação: teto de orçamento sem isenção, destaque do que mudou e validação contra o ERP antes de aplicar.
8. **Mão de obra em duas pontas.** A equipe constrói a API do ERP, o MCP e o módulo; a ordem das fases protege o piloto de depender de tudo ao mesmo tempo.

---

## 7. Próximo passo: módulo PDV e MCP do ERP

O trabalho começa por duas frentes que andam juntas: o módulo PDV no CRM e o MCP do ERP. Antes de escrever código, três coisas precisam estar fechadas.

**Bloqueios (nesta ordem):**
1. **Contrato do MCP do ERP e homologação:** levantar as ferramentas, formatos e erros, e criar o ambiente de homologação do ERP (tarefa E0). O rascunho está em [contrato-mcp-erp.md](contrato-mcp-erp.md); falta você responder o que o ERP já tem (seção 5) e ajustar o que não tiver.
2. **ADR de tenants e lojas (D1):** a decisão está tomada; falta desenhar o mapeamento conexão para loja, a aba Lojas (campos, quem edita, origem da lista) e o destino do pedido que o call center registra para loja de outro tenant.
3. **Pendências do PRD do FR-010:** pagamento, meio a meio e adicionais no ERP, quem confirma o envio, e o que fazer quando a loja calculada fica fora do escopo.

**Quando o contrato e o ADR de tenants e lojas estiverem fechados, a primeira fatia entregável é:** fase 1 (esqueleto do módulo, desligado por padrão) mais as ferramentas de leitura do MCP (listar lojas, buscar cliente, consultar cardápio). Isso permite abrir o PDV e identificar um cliente e consultar produtos de verdade antes de qualquer escrita. A criação de pedido e o worker vêm na fatia seguinte.

**Registros a criar:** ADR de tenants e lojas, ADR de cliente (fonte e sincronização), ADR de pedido (tabelas de módulo) e o PRD do FR-002, que a fase 4 consome.

---

## 8. Contrato do MCP do ERP

O levantamento das ferramentas saiu daqui para o documento próprio [contrato-mcp-erp.md](contrato-mcp-erp.md), que traz quem usa o MCP, as regras gerais, o catálogo por grupo (lojas, cardápio e preço, entrega e CEP, cliente, endereços, pedido), a rastreabilidade por requisito e as perguntas ao ERP.

A primeira fatia a implementar é a de leitura: `listar_lojas`, `buscar_cliente`, `obter_cliente`, `consultar_cep` e `consultar_cardapio`.

**O que o CRM já faz (lido, sem execução):** o servidor MCP é registrado por tenant, as funções de chamada não dependem de turno de conversa, o tempo limite é definido por chamada, e o endereço precisa ser HTTPS público (hosts privados são recusados). **Falta medir** a latência, porque cada chamada abre uma conexão nova (prova 0.4). Detalhe na seção 6 do contrato.
