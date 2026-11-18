# PRD: Módulo PDV, tela do pedido (porte do protótipo) contra um mock do ERP

Versão: 0.1 (rascunho)
Data: 2026-11-18
Formato: PRD do Ralph (histórias pequenas, em ordem estrita, sem dependência para frente)
Branch da execução: `ralph/modulo-pdv-tela-do-pedido`

Documentos de origem
- **Especificação do protótipo** (a fonte da verdade das telas): [especificacao-prototipo.md](../docs/interface/prototipo/especificacao-prototipo.md), extraída do repositório https://github.com/andregoncalesocteto/cart-craft-counter (app: https://cart-craft-counter.lovable.app)
- [design-modulo-pdv.md](design-modulo-pdv.md) e os [ADRs](adr/README.md) 001 a 009 (o 004 segue proposto)
- [PRD das fases 1 e 2](prd-modulo-pdv-fases-1-e-2.md) e o [PRD do FR-010](../prd-fr-010-pdv-balcao-e-telefone.md)
- [contrato-mcp-erp-formatos.md](../contrato-mcp-erp-formatos.md) (E0 e E1 hoje; a versão 0.4 nasce da história US-009) e os [handoffs do ERP](../handoff-erp/README.md)
- Rascunhos de casos de uso em `docs/interface/` (valem só onde a especificação do protótipo é omissa)

---

## 1. Introdução / visão geral

O dono do projeto decidiu (2026-11-18) que o CRM é construído **primeiro**, com todas as telas e fluxos, e que o ERP é resolvido depois. Este PRD entrega a **tela do pedido do PDV, igual à do protótipo**, funcionando de ponta a ponta contra um **mock do ERP** (um servidor MCP que fala o mesmo protocolo do real, ADR-009). Tudo que é cardápio, preço, taxa, total, cliente, endereço e loja vem do ERP; o PDV não calcula nada.

Ao final, um atendente de um tenant com o módulo ligado e o servidor do ERP (o mock) cadastrado: identifica o cliente no carrinho, monta o pedido (pizza meio a meio com adicionais, bebidas, busca), escolhe Balcão ou Entrega e a loja, registra o pagamento, confirma, vê o pedido ser aceito ou recusado pelo ERP, consulta os pedidos do dia e pode pedir tudo isso em linguagem natural a um assistente simulado.

## 2. Pré-requisitos (fora do PRD)

- A `main` do fork deve conter o trabalho do vínculo do contato (branch `feat/pdv-vincular-cliente-por-botao`: ADR-007, ADR-008 e a migration 9422). O Ralph parte da `main` atualizada (doutrina de higiene de branches).
- O mock é provado **sem rede**. Para vê-lo na stack local, o dono do projeto expõe `tools/erp-mock` num nome HTTPS público (o CRM recusa HTTP e hosts privados em produção) e o cadastra como servidor do ERP de uma organização de teste. O Ralph não faz isso.
- `NODE_OPTIONS=--max-old-space-size=8192` para o typecheck e `CONFERENCIA_KIT_RELEASE=v1.63.0` para o `pnpm test:db` neste clone (ver `progress.txt`).

## 3. Objetivos

- Reproduzir as telas e os fluxos do protótipo no CRM, com os mesmos rótulos, estados e mensagens.
- Provar cada tela contra um mock do ERP que o ERP real possa depois igualar (contrato v0.4 e suíte de contrato).
- Nenhum cálculo de valor no CRM: preço, taxa, total e tempo vêm do ERP.
- O pedido confirmado é gravado uma vez e enviado ao ERP uma vez (idempotência de ponta a ponta).
- Nenhum dado pessoal em log, auditoria, URL, storage ou contexto do assistente.

## 4. Escopo e não-metas

**Dentro:** o mock do ERP e o contrato v0.4; a camada do ERP e as APIs de endereço, cadastro, cardápio, busca, cálculo, pedido e pedidos do dia; as tabelas do pedido e o envio pelo `event_log`; a tela `/app/pdv` (três colunas), a ficha completa e o cadastro em tela própria; o assistente simulado, com voz.

**Fora (backlog, decisão do dono do projeto de seguir "igual ao protótipo"):**
- Histórico do pedido por cliente e "Repetir último pedido" (o protótipo só tem "Pedidos do dia").
- Cancelamento de pedido, painel de uso e custo do assistente, desfazer do assistente, teto de orçamento de IA.
- Origem do pedido (telefone ou balcão): o protótipo não a tem.
- Aviso na Central para pedido parado ou recusado, teto de tentativas com alerta, teste de carga.
- IA de verdade (o assistente desta rodada é o parser do protótipo; a interface é desenhada para trocá-lo).
- Rascunho persistente no servidor (o protótipo guarda o rascunho na memória do navegador).
- Pagamento além de registrar a forma e o troco; link de pagamento; pedido agendado; cupom; desconto.
- Regras reais de preço e taxa (o mock usa a regra de exemplo do protótipo, marcada como tal), handoffs ao ERP e homologação contra o ERP real.

## 5. Decisões desta rodada e correções do protótipo

**Decisões (2026-11-18, dono do projeto):** o protótipo é a especificação ("fazer igual"); o tipo do pedido se chama **"Entrega"** em todas as telas (o protótipo mostrava "Delivery" no PDV); o padrão é Balcão e a forma de pagamento padrão é Pix; o pagamento só registra a intenção; o atendente confirma com um clique; loja de entrega fora do tenant é recusada com aviso; tudo vem do ERP; o mock é um servidor MCP no repositório (ADR-009); o rascunho vive na memória do navegador.

**O protótipo erra em quatro pontos, que o porte corrige:**
1. O cartão do cliente mostra "Sem endereço para entrega" enquanto a loja usa o endereço principal: as duas regras concordam.
2. CPF digitado no cadastro rápido vai para o campo Telefone: vai para CPF.
3. As telas de erro e de rota inexistente estão em inglês: ficam em português.
4. O "Novo pedido" do chat só limpa a conversa: o botão do chat passa a se chamar "Limpar conversa".

Também diferem por necessidade do ERP real: os estados de carregando e erro da busca de cliente e do assistente (o protótipo é síncrono), a busca de telefone e CPF exata (a do protótipo é "contém"), o contexto do assistente sem dado pessoal, e "O que falta?" passa a incluir o pagamento.

## 6. Contrato v0.4 proposto (resumo; o texto exato nasce do mock, US-009)

Dinheiro em centavos (`_cents`) com `moeda: "BRL"`; sucesso em `structuredContent`; erro como `isError` com texto JSON `{ codigo, mensagem, detalhes? }`.

| Ferramenta | Entrada (resumo) | Saída (resumo) |
| --- | --- | --- |
| `consultar_cep` | `cep` | UF, cidade, bairro, logradouro; erro `cep_nao_encontrado` |
| `loja_do_endereco` | `cep` | a loja que entrega ou `null` |
| `salvar_endereco` | `cliente_id`, `endereco_id?`, campos do endereço | o endereço com `loja_entrega` |
| `definir_endereco_principal` | `cliente_id`, `endereco_id` | ok |
| `remover_endereco` | `cliente_id`, `endereco_id`, `novo_principal_id?` | ok; erro `novo_principal_obrigatorio` |
| `cadastrar_cliente` | nome, telefone?, e-mail?, cpf?, nascimento?, endereço? | o cliente; erros `cpf_duplicado`, `telefone_duplicado` (com `cliente_id`) |
| `atualizar_cliente` | `cliente_id`, nome, cpf?, nascimento? | o cliente |
| `consultar_cardapio` | `loja_codigo?` | produtos (tamanhos, ingredientes, `disponivel`, `foto_url`) e adicionais |
| `buscar_produtos` | `termo`, `loja_codigo?`, `pagina?`, `por_pagina?` | produtos, `total`, `pagina`, `paginas` |
| `consultar_disponibilidade` | `loja_codigo`, `produto_ids[]` | `disponivel` por produto |
| `calcular_total` | `loja_codigo`, `tipo`, `cep?`, `itens[]` | preço por item, subtotal, taxa, total, tempo estimado |
| `criar_pedido` | `chave_idempotencia`, loja, tipo, `cliente_id`, endereço?, itens, pagamento | o pedido (`numero`, `estado`); mesma chave, mesmo pedido |
| `consultar_pedido` | `numero` | o pedido |

Já existem e seguem como estão: `listar_lojas`, `buscar_cliente`, `obter_cliente` (formato real, com as divergências 5 e 6 da devolutiva E0/E1).

## 7. Mapa: tela da especificação para história

| Tela ou fluxo | Seção da especificação | Histórias |
| --- | --- | --- |
| Estrutura, topbar, três colunas | §1.1 | US-022 |
| Montar pedido: abas e cartões | §2.1 | US-024 |
| Configurador de pizza | §2.1 | US-025 |
| Bebida, sobremesa, botões rápidos | §2.1 | US-026 |
| Busca de produtos e janela de quantidade | §2.2 | US-027 |
| Carrinho | §2.3 | US-028 |
| Identificação rápida do cliente | §2.4 | US-029 |
| Endereço de entrega no carrinho | §2.4 | US-030 |
| Cadastro em janela | §2.4 e §2.6 | US-031 |
| Tipo do pedido e loja | §2.7 e §2.8 | US-032 |
| Pagamento e troco | §2.9 | US-033 |
| Fechamento | §2.10 | US-034 |
| Pedido confirmado e novo pedido | §2.11 e §2.12 | US-035 |
| Pedidos do dia | §2.13 | US-036 |
| Assistente (painel, parser, ações, voz) | §2.14 e §6 | US-037 a US-040 |
| Ficha: dados, endereços, selecionar | §2.5 | US-041 a US-043 |
| Cadastro em tela própria | §1.3 e §2.6 | US-043 |

## 8. Histórias de usuário

### Bloco A. Mock do ERP (servidor MCP)

#### US-001: Mock do ERP: esqueleto do servidor, autenticação e lojas

**Description:** Como desenvolvedor, quero um servidor MCP de mock do ERP que fale o mesmo protocolo do real, para construir e provar as telas sem esperar o ERP. (ADR-009)

**Acceptance Criteria:**
- [ ] Pacote em `tools/erp-mock/` (fora de `app/`, `lib/`, `components/`, `hooks/` e `workers/`), com a função `criarMock(opcoes)` que devolve `{ fetch, reiniciar, estado }`: o mesmo mock serve ao HTTP real e aos testes sem rede
- [ ] Servidor Streamable HTTP em `/mcp` com `Authorization: Bearer` (chave por variável `ERP_MOCK_CHAVE`); sem chave ou chave errada responde HTTP 401 com `WWW-Authenticate: Bearer` e o JSON `{ codigo: "nao_autorizado", mensagem }`, como o ERP real; script `pnpm erp-mock` (porta por `ERP_MOCK_PORTA`, padrão 5299)
- [ ] Ferramenta `listar_lojas` com o formato REAL (`contrato-mcp-erp-formatos.md`): sucesso em `structuredContent`, erro como `isError` com texto JSON `{ codigo, mensagem }`; lojas fictícias Bella Capri Centro, Cambuí e Taquaral, com `codigo` e `sigla`
- [ ] `reiniciar()` e o comando `pnpm erp-mock:reiniciar` devolvem os dados ao estado inicial
- [ ] Cerca em teste: nenhum arquivo de `app/`, `lib/`, `components/`, `hooks/` ou `workers/` importa `tools/erp-mock`
- [ ] Teste contra o mock em memória (sem rede), pela função de `fetch` que o mock exporta: `listar_lojas`, o 401 e o `initialize`/`tools/list` do protocolo
- [ ] `tools/erp-mock/README.md` explica como subir o mock, cadastrá-lo como servidor MCP de uma organização de teste (precisa de endereço HTTPS público: túnel do dono do projeto) e que ele NÃO é o ERP
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-002: Mock do ERP: busca e ficha de cliente

**Description:** Como desenvolvedor, quero no mock a busca e a ficha de cliente com o formato real do ERP e dados fictícios que reproduzam os casos difíceis.

**Acceptance Criteria:**
- [ ] Ferramentas `buscar_cliente` e `obter_cliente` com o formato REAL observado em homologação (`contrato-mcp-erp-formatos.md` e as divergências 5 e 6 da devolutiva E0/E1: sem `endereco_principal` na lista, endereço sem `principal`, ids numéricos como strings); `buscar_cliente` aceita `modo` telefone, nome ou cpf, `termo` e `limite`; telefone e CPF devolvem as fichas que casam exatamente; `obter_cliente` respeita `campos_sensiveis`
- [ ] Dados fictícios: os clientes do protótipo (`especificacao-prototipo.md` §5.3: Maria Oliveira, Maria de Fátima, Mariana Lopes, João Pereira Lima) e um caso de duas fichas com o mesmo telefone, uma completa e outra só com nome e telefone
- [ ] Erros: `termo_invalido` (com `detalhes.campo`: nome com menos de 2 caracteres, telefone com menos de 10 dígitos, CPF inválido) e `nao_encontrado`; nenhum cliente achado NÃO é erro
- [ ] Teste contra o mock em memória (sem rede), pela função de `fetch` que o mock exporta: cada modo de busca, `campos_sensiveis`, as duas fichas do mesmo telefone, cada erro
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-003: Mock do ERP: falhas injetáveis

**Description:** Como desenvolvedor, quero provocar falhas no mock sob demanda para ver os estados de erro e de espera das telas.

**Acceptance Criteria:**
- [ ] `POST /__controle` (só no servidor HTTP do mock e na API de `criarMock`) aceita `{ falha, ferramenta?, vezes? }` com `falha` em `lento` (atraso configurável), `nao_autorizado`, `limite_excedido`, `erro_interno`, `indisponivel` ou `nenhuma`; `ferramenta` restringe a uma ferramenta; `vezes` limita quantas chamadas falham
- [ ] `lento`, `limite_excedido` (429, com `codigo: "limite_excedido"`), `erro_interno` e `nao_autorizado` reproduzem o que o CRM já trata em `lib/pdv/erp/resposta.ts`; `indisponivel` derruba a conexão
- [ ] O estado das falhas é zerado por `reiniciar()`
- [ ] Teste contra o mock em memória (sem rede), pela função de `fetch` que o mock exporta: cada falha, o filtro por ferramenta e `vezes`
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-004: Mock do ERP: CEP, loja de entrega e endereços

**Description:** Como desenvolvedor, quero no mock as ferramentas de endereço e de loja de entrega, com a regra de exemplo do protótipo, para as telas de endereço funcionarem.

**Acceptance Criteria:**
- [ ] Ferramentas `consultar_cep { cep }` (UF, cidade, bairro e logradouro; erro `cep_nao_encontrado`) e `loja_do_endereco { cep }` (a loja que entrega ou `null` quando nenhuma entrega), com a tabela e a regra do protótipo (`especificacao-prototipo.md` §3.6 e §5.4: 13060000, 13010000, 13025001, 13026000 e 13825000 sem loja; CEP que começa por `130` cai em Centro; o resto sem loja)
- [ ] `salvar_endereco { cliente_id, endereco_id?, cep, uf, cidade, bairro, endereco, complemento? }` cria ou altera; o primeiro endereço do cliente vira principal; devolve o endereço com `loja_entrega` calculada
- [ ] `definir_endereco_principal { cliente_id, endereco_id }` (um só principal) e `remover_endereco { cliente_id, endereco_id, novo_principal_id? }` (remover o principal com outros exige `novo_principal_id`; sem ele, erro `novo_principal_obrigatorio`)
- [ ] `obter_cliente` passa a devolver `loja_entrega` calculada pelo CEP em cada endereço, e `principal` quando houver endereço principal
- [ ] Falha de gravação reproduzível: rua ou complemento contendo `#falha` devolve `erro_interno` (mesmo gatilho do protótipo)
- [ ] Teste contra o mock em memória (sem rede), pela função de `fetch` que o mock exporta: cada ferramenta, o principal único, a remoção com e sem `novo_principal_id`, a regra de CEP e o gatilho `#falha`
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-005: Mock do ERP: cadastro e edição de cliente

**Description:** Como desenvolvedor, quero no mock as ferramentas de cadastrar e editar cliente, com as validações e a duplicidade do protótipo.

**Acceptance Criteria:**
- [ ] `cadastrar_cliente { nome, telefone?, email?, cpf?, data_nascimento?, endereco? }`: exige nome e ao menos telefone ou e-mail; valida CPF (11 dígitos, dígitos verificadores, não aceita todos iguais), data (calendário real, ano >= 1900, não futura), e-mail e telefone com DDD (`especificacao-prototipo.md` §3.5); o endereço, quando vier, vira o principal
- [ ] Duplicidade: CPF repetido devolve erro `cpf_duplicado` e telefone repetido `telefone_duplicado`, ambos com `detalhes.cliente_id` da ficha existente; o CPF tem prioridade sobre o telefone; e-mail e nome não são conferidos
- [ ] Erro de validação devolve `termo_invalido` com `detalhes.campo` (nome, contato, cpf, data_nascimento, email, telefone)
- [ ] `atualizar_cliente { cliente_id, nome, cpf?, data_nascimento? }`: telefone e e-mail não mudam; valida CPF e data; `nao_encontrado` para id inexistente
- [ ] O gatilho `#falha` no nome devolve `erro_interno`
- [ ] Teste contra o mock em memória (sem rede), pela função de `fetch` que o mock exporta: sucesso, cada validação, cada duplicidade e o gatilho
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-006: Mock do ERP: cardápio, busca de produtos e disponibilidade

**Description:** Como desenvolvedor, quero no mock o cardápio completo do protótipo, a busca de produtos e a disponibilidade, para as telas de montar pedido funcionarem.

**Acceptance Criteria:**
- [ ] Dados: o catálogo do protótipo inteiro (`especificacao-prototipo.md` §5.1: 29 produtos, sendo 8 pizzas, 5 bebidas, 3 sobremesas e 13 lanches, com `codigo` (101 + posição), tamanhos e preços em centavos, ingredientes, adicionais e se tem foto) e os 7 adicionais; foto como URL (ou `null` para o produto sem foto); preço sempre em `_cents` com `moeda: "BRL"`
- [ ] `consultar_cardapio { loja_codigo? }` devolve produtos (`id`, `codigo`, `nome`, `categoria`, `descricao`, `foto_url`, `tamanhos[{ chave, rotulo, preco_cents }]`, `ingredientes[]`, `disponivel`) e `adicionais[{ id, nome, preco_cents }]`
- [ ] `buscar_produtos { termo, loja_codigo?, pagina?, por_pagina? }`: busca por nome, descrição, código e ingrediente, sem acento, 'contém'; termo vazio devolve lista vazia; 6 por página por padrão; devolve `total`, `pagina` e `paginas`; 'frango' rende mais de 12 itens e 3 páginas, como no protótipo
- [ ] `consultar_disponibilidade { loja_codigo, produto_ids[] }` devolve `disponivel` por produto; o mock tem ao menos um produto indisponível numa das lojas, para provar o bloqueio
- [ ] Teste contra o mock em memória (sem rede), pela função de `fetch` que o mock exporta: o catálogo, a busca (nome, código, ingrediente, acento, paginação) e a disponibilidade
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-007: Mock do ERP: cálculo de preço, taxa e total

**Description:** Como desenvolvedor, quero no mock o cálculo do valor dos itens e do pedido, com a regra de exemplo do protótipo, para o PDV nunca calcular preço.

**Acceptance Criteria:**
- [ ] `calcular_total { loja_codigo, tipo, cep?, itens[] }` com `tipo` `balcao` ou `entrega` e cada item `{ produto_id, tamanho, segundo_sabor_id?, adicionais[{ id, quantidade }], ingredientes_removidos[], quantidade }`; devolve `itens[{ preco_unitario_cents, subtotal_cents }]`, `subtotal_cents`, `taxa_entrega_cents`, `total_cents`, `tempo_estimado_min` (ou `null`) e `moeda`
- [ ] Regra de EXEMPLO do mock (documentada como tal; o ERP real definirá a sua, `especificacao-prototipo.md` §3.1 e §3.2): preço do tamanho; meio a meio cobra o MAIOR dos dois sabores no tamanho; adicionais somam `preço × quantidade` sobre a pizza inteira; remover ingrediente não muda o preço; taxa de entrega R$ 8,00 só em entrega
- [ ] Erros: `produto_indisponivel` (com `detalhes.produto_id`), `tamanho_invalido`, `segundo_sabor_invalido` (só pizza, no máximo dois sabores) e `loja_invalida`
- [ ] Exemplos do protótipo viram casos de teste: G calabresa 50; G meio a meio calabresa e portuguesa 56; G meio a meio portuguesa com bacon×2 72; G meio a meio portuguesa com bacon e sem cebola, ×2 = 128; mesma pizza em GG ×2 = 152; entrega soma 8,00
- [ ] Teste contra o mock em memória (sem rede), pela função de `fetch` que o mock exporta: cada regra e cada erro
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-008: Mock do ERP: criar e consultar pedido, com idempotência

**Description:** Como desenvolvedor, quero no mock a criação de pedido com chave de idempotência, para provar o envio sem duplicar.

**Acceptance Criteria:**
- [ ] `criar_pedido { chave_idempotencia, loja_codigo, tipo, cliente_id, endereco?, itens[], pagamento: { forma, troco_para_cents? } }` valida cliente, loja, itens e disponibilidade, calcula o total como `calcular_total` e devolve `{ pedido: { numero, estado: "aceito", total_cents, ... } }` com `numero` sequencial de 4 dígitos
- [ ] A mesma `chave_idempotencia` devolve o MESMO pedido, sem criar outro; a mesma chave com conteúdo diferente devolve o erro `chave_em_uso`
- [ ] Recusas reproduzíveis: `produto_indisponivel`, `endereco_fora_da_area`, e uma recusa de negócio forçável (`pedido_recusado` com `mensagem`), por `POST /__controle` (`falha: "recusar_pedido"`)
- [ ] `consultar_pedido { numero }` devolve o pedido ou `nao_encontrado`
- [ ] Forma de pagamento: `dinheiro`, `pix`, `cartao_credito` ou `cartao_debito`; `troco_para_cents` só com dinheiro e maior ou igual ao total
- [ ] Teste contra o mock em memória (sem rede), pela função de `fetch` que o mock exporta: criar, repetir a chave, chave com outro conteúdo, cada recusa e consultar
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-009: Contrato v0.4 e testes de contrato executáveis

**Description:** Como mantenedor, quero o contrato das novas ferramentas escrito a partir do mock e uma suíte que o valide contra qualquer servidor, para entregá-lo ao ERP como critério de aceite. (ADR-009)

**Acceptance Criteria:**
- [ ] Seção nova em `.business/bellacapri/projeto-crm/contrato-mcp-erp-formatos.md` (versão 0.4) com entrada e saída exatas de `consultar_cep`, `loja_do_endereco`, `salvar_endereco`, `definir_endereco_principal`, `remover_endereco`, `cadastrar_cliente`, `atualizar_cliente`, `consultar_cardapio`, `buscar_produtos`, `consultar_disponibilidade`, `calcular_total`, `criar_pedido` e `consultar_pedido`, com os códigos de erro e um exemplo de cada, gerados a partir do que o mock devolve
- [ ] Cada regra de cálculo do mock aparece marcada como "regra de exemplo, a definir com o ERP"
- [ ] Suíte `tests/erp-contrato/` com as mesmas asserções do mock, parametrizada por `ERP_CONTRATO_URL` e `ERP_CONTRATO_CHAVE`: sem as variáveis roda contra o mock em memória; com elas roda contra qualquer servidor (o ERP real, por um humano); registrada para não rodar no CI quando apontada para a rede
- [ ] O índice de `handoff-erp/README.md` ganha a linha 'a escrever depois das telas' para E2 a E7, apontando para o contrato v0.4 e para a suíte; nenhum handoff é escrito agora
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

### Bloco B. Camada do ERP no CRM

#### US-010: Camada do ERP: endereços, CEP e loja de entrega

**Description:** Como desenvolvedor, quero as funções tipadas do CRM para as ferramentas de endereço, CEP e loja de entrega.

**Acceptance Criteria:**
- [ ] `lib/pdv/erp/endereco.ts` exporta `consultarCep`, `lojaDoEndereco`, `salvarEndereco`, `definirEnderecoPrincipal` e `removerEndereco`, todas recebendo o `organizationId` do chamador autenticado, no mesmo molde de `lib/pdv/erp/cliente.ts` (tempo limite por chamada em constante exportada: 15000 ms nas leituras)
- [ ] Esquemas Zod em `tipos.ts` para cada resposta, tolerantes ao que o ERP real omite (campo ausente e `null` significam o mesmo onde o contrato diz); `ErpPdvError` com os códigos novos (`cep_nao_encontrado`, `novo_principal_obrigatorio`)
- [ ] fixtures em `tests/fixtures/pdv-erp/` gravadas das respostas do mock (nunca escritas à mão)
- [ ] Testes com o `fetch` injetado: cada função chama a ferramenta certa com os argumentos certos e cada erro do ERP vira o `ErpPdvError` esperado; resposta fora do esquema vira `resposta_invalida`
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-011: Camada do ERP: cadastro e edição de cliente

**Description:** Como desenvolvedor, quero as funções tipadas para cadastrar e editar cliente no ERP.

**Acceptance Criteria:**
- [ ] `lib/pdv/erp/cliente.ts` ganha `cadastrarCliente` e `atualizarCliente`; escrita não tem repetição automática de chamada e usa tempo limite próprio em constante exportada
- [ ] `ErpPdvError` ganha `cpf_duplicado` e `telefone_duplicado`, com o `cliente_id` da ficha existente em `detalhes`, e `termo_invalido` com `detalhes.campo`
- [ ] fixtures em `tests/fixtures/pdv-erp/` gravadas das respostas do mock (nunca escritas à mão)
- [ ] Testes com o `fetch` injetado: sucesso, cada duplicidade e cada validação
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-012: Camada do ERP: cardápio, busca e disponibilidade

**Description:** Como desenvolvedor, quero as funções tipadas para ler o cardápio, buscar produtos e consultar a disponibilidade.

**Acceptance Criteria:**
- [ ] `lib/pdv/erp/cardapio.ts` exporta `consultarCardapio`, `buscarProdutos` e `consultarDisponibilidade` (preço em centavos, `moeda` BRL; foto como URL ou `null`)
- [ ] Esquemas Zod: produto com `tamanhos`, `ingredientes`, `disponivel` e `foto_url` anulável; busca com `total`, `pagina` e `paginas`
- [ ] fixtures em `tests/fixtures/pdv-erp/` gravadas das respostas do mock (nunca escritas à mão)
- [ ] Testes com o `fetch` injetado: cada função e a paginação
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-013: Camada do ERP: calcular total e criar pedido

**Description:** Como desenvolvedor, quero as funções tipadas de cálculo e de criação de pedido, com a chave de idempotência.

**Acceptance Criteria:**
- [ ] `lib/pdv/erp/pedido.ts` exporta `calcularTotal`, `criarPedido` e `consultarPedido`; o PDV NUNCA calcula preço, taxa nem total: só repassa o que o ERP devolve
- [ ] `criarPedido` exige `chaveIdempotencia` (UUID) e a repassa ao ERP; tempo limite próprio e sem repetição automática dentro da função (a repetição é do worker, com a MESMA chave)
- [ ] `ErpPdvError` ganha `produto_indisponivel`, `endereco_fora_da_area`, `pedido_recusado` (com a `mensagem` do ERP em `detalhes`), `chave_em_uso`, `tamanho_invalido`, `segundo_sabor_invalido` e `loja_invalida`
- [ ] fixtures em `tests/fixtures/pdv-erp/` gravadas das respostas do mock (nunca escritas à mão)
- [ ] Testes com o `fetch` injetado: cálculo (itens, taxa, total), criação, repetir a chave devolve o mesmo pedido, cada recusa
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

### Bloco C. APIs do PDV

#### US-014: API de endereços do cliente, CEP e loja de entrega

**Description:** Como atendente, quero que o CRM exponha as operações de endereço do cliente, a consulta de CEP e a loja de entrega, para as telas usarem.

**Acceptance Criteria:**
- [ ] `GET /api/v1/pdv/cep/{cep}` (UF, cidade, bairro, logradouro; 404 `cep_nao_encontrado`), `GET /api/v1/pdv/lojas/entrega?cep=` (a loja que entrega ou `null`)
- [ ] `POST /api/v1/pdv/clientes/{erp_id}/enderecos`, `PATCH .../enderecos/{id}`, `DELETE .../enderecos/{id}` (com `novo_principal_id` quando remover o principal) e `POST .../enderecos/{id}/principal`; Zod em todo corpo (CEP com 8 dígitos, campos obrigatórios, UF de 2 letras); `Idempotency-Key` aceito nos `POST`
- [ ] Toda rota resolve o tenant da sessão e filtra `organization_id`; nada de tenant no corpo; o papel mínimo é `agent`; as mutações levam `requireSupportWrite(` antes do efeito e auditam sem dado pessoal; o módulo desligado responde 404
- [ ] Erro do ERP segue a tabela de status das rotas atuais (`erp_nao_configurado` 409, indisponível 502, tempo esgotado 504); falha ao salvar mantém o corpo da resposta sem dado pessoal
- [ ] Auditoria `pdv.customer.address_changed` (ação nova em `lib/audit/actions.ts`) sem CEP, endereço nem nome
- [ ] Testes de rota (feliz, validação, papel, módulo desligado, isolamento entre dois tenants, ERP fora do ar), e ausência de endereço em log
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-015: API de cadastro e edição de cliente

**Description:** Como atendente, quero cadastrar um cliente novo e editar nome, CPF e nascimento pelo CRM.

**Acceptance Criteria:**
- [ ] `POST /api/v1/pdv/clientes` (cadastro) e `PATCH /api/v1/pdv/clientes/{erp_id}` (nome, CPF, nascimento); Zod: nome obrigatório, telefone ou e-mail, CPF com dígito verificador, data real e não futura, endereço opcional com os campos do endereço
- [ ] Duplicidade devolve 409 com `cpf_duplicado` ou `telefone_duplicado` e o `cliente_id` existente (para a tela oferecer abrir a ficha existente); validação devolve 422 com o campo
- [ ] O cliente cadastrado NÃO cria contato nem vínculo no CRM (ADR-007): quem vincula é o atendente, pelo botão da ficha
- [ ] Toda rota resolve o tenant da sessão e filtra `organization_id`; nada de tenant no corpo; o papel mínimo é `agent`; as mutações levam `requireSupportWrite(` antes do efeito e auditam sem dado pessoal; o módulo desligado responde 404
- [ ] Auditoria `pdv.customer.created` e `pdv.customer.edited` (ações novas) sem dado pessoal, só o id do ERP
- [ ] Testes de rota: cadastro, cada duplicidade, validações, edição, papel, módulo desligado, isolamento, `#falha` do mock vira erro de gravação
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-016: API do cardápio e da busca de produtos

**Description:** Como atendente, quero que o CRM entregue o cardápio da loja e a busca de produtos, com preço e disponibilidade do ERP.

**Acceptance Criteria:**
- [ ] `GET /api/v1/pdv/cardapio?loja=` (produtos por categoria, adicionais) e `GET /api/v1/pdv/produtos?termo=&pagina=` (6 por página, `total`, `pagina`, `paginas`); a loja vem do pedido e é validada contra as lojas do tenant
- [ ] Papel mínimo `agent`; módulo desligado 404; limite de taxa por usuário com `Retry-After`; o termo de busca NUNCA vai a log, Sentry nem auditoria
- [ ] Erros do ERP seguem a tabela das rotas atuais
- [ ] Testes de rota: cardápio, busca (acento, página, vazio), loja que não é do tenant, papel, módulo desligado, isolamento, ERP fora do ar
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-017: API de cálculo do pedido

**Description:** Como atendente, quero que o CRM peça ao ERP o valor dos itens e do pedido a cada mudança.

**Acceptance Criteria:**
- [ ] `POST /api/v1/pdv/calculo` recebe loja, tipo, CEP (entrega) e itens, valida com Zod e devolve exatamente o que o ERP calculou (preço por item, subtotal, taxa, total, tempo estimado); o CRM não soma, não arredonda nem aplica regra de preço
- [ ] Item indisponível ou inválido devolve 422 com o código do ERP e o `produto_id`
- [ ] Papel mínimo `agent`; módulo desligado 404; limite de taxa por usuário (o configurador chama a cada mudança: o teto cobre esse uso)
- [ ] Testes de rota: pizza meio a meio com adicionais, entrega com taxa, balcão sem taxa, item indisponível, papel, módulo desligado, isolamento, ERP fora do ar; teste prova que a rota repassa o total do ERP sem recalcular (o mock devolve um total 'estranho' e a resposta o preserva)
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

### Bloco D. Pedido: dados e envio ao ERP

#### US-018: Tabelas do pedido

**Description:** Como mantenedor, preciso das tabelas do pedido do PDV, criadas pela provisionadora do módulo, para gravar o pedido confirmado e os itens. (ADR-003)

**Acceptance Criteria:**
- [ ] Migration versionada `<timestamp>_<NNNN>_<slug>.sql` com `-- manifest:` e o mesmo conteúdo como apêndice idempotente no `supabase/baseline.sql`, ANTES do bloco `VARREDURA anon`; `NNNN` conferido com `pnpm checar:colisao-de-migration` e contra a `main` do produto (a série deste fork já usa 9044, 9045 e 9422)
- [ ] `fn_pdv_provisionar()` passa a criar `pdv_orders` (id, `organization_id` FK cascade, `store_id` FK `pdv_stores`, `numero_erp` anulável, `estado` com CHECK em `confirmado`, `enviado`, `aceito`, `recusado`, `tipo` em `balcao` ou `entrega`, `erp_customer_id`, `contact_id` anulável FK `contacts` on delete set null, `cliente_nome`, endereço de entrega copiado em colunas (ADR-002: cópia no pedido), `pagamento_forma` com CHECK, `troco_para_cents`, `subtotal_cents`, `taxa_entrega_cents`, `total_cents`, `moeda`, `idempotency_key` UUID único por organização, `motivo_recusa`, `criado_por`, `created_at`, `enviado_em`) e as tabelas filhas da composição normalizada do ADR-003 (itens e opções de cada item, com `entered_by` `manual` ou `assistente`)
- [ ] RLS com `tenant_isolation_<tabela>_all` em todas; únicos e índices necessários (por organização e `created_at` para 'Pedidos do dia'); todo `create` com `if not exists`
- [ ] As três listas de invariantes (grants, LGPD, `PROVA_DE_MODULO`) e `moldeDeProvisionadora` atualizados; a seção de LGPD é declarada em `modulo_secoes_lgpd` porque o pedido guarda nome e endereço (anonimizar o contato não apaga o pedido, e o motivo fica escrito)
- [ ] Teste de invariante: as tabelas não existem antes de instalar o módulo e existem depois; isolamento entre duas organizações; reprovisionar não perde dados
- [ ] `pnpm test:db` passa (instalação nova e atualização com dados), com `CONFERENCIA_KIT_RELEASE` se o clone não tiver release
- [ ] Lint passes
- [ ] Typecheck passes

#### US-019: API para confirmar o pedido

**Description:** Como atendente, quero confirmar o pedido com um clique, para ele ser gravado uma única vez e ir ao ERP.

**Acceptance Criteria:**
- [ ] `POST /api/v1/pdv/pedidos` recebe loja, tipo, cliente (id do ERP), endereço (entrega), itens, pagamento e troco, com `Idempotency-Key` OBRIGATÓRIA; valida com Zod e as regras do `validateCheckout` do protótipo (`especificacao-prototipo.md` §3.3, mensagens exatas, na mesma ordem)
- [ ] Antes de gravar, pede o total ao ERP (`calcular_total`); o total gravado é o do ERP, e se o total que a tela mostrava for diferente a rota devolve 409 `total_divergente` com o total novo, sem gravar
- [ ] Grava o pedido com `estado = confirmado`, os itens (com a origem manual ou assistente) e emite o evento em `event_log` na mesma transação (o trigger NÃO faz HTTP); clique duplo ou reenvio com a mesma chave devolve o mesmo pedido, sem criar outro
- [ ] Loja de entrega calculada que não pertence ao tenant do atendente: recusa com 422 e mensagem clara, sem gravar (decisão de 2026-11-18)
- [ ] Toda rota resolve o tenant da sessão e filtra `organization_id`; nada de tenant no corpo; o papel mínimo é `agent`; as mutações levam `requireSupportWrite(` antes do efeito e auditam sem dado pessoal; o módulo desligado responde 404
- [ ] Auditoria `pdv.order.confirmed` (ação nova) sem dado pessoal
- [ ] Testes de rota: feliz, cada validação, chave repetida, chave com outro conteúdo, divergência de total, loja fora do tenant, papel, módulo desligado, isolamento entre dois tenants
- [ ] Teste de banco ou de integração: o pedido e o evento nascem na mesma transação (falha em um não deixa o outro)
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-020: Worker: enviar o pedido ao ERP

**Description:** Como sistema, quero enviar o pedido confirmado ao ERP uma única vez, com a mesma chave de idempotência, e registrar o resultado. (ADR-006)

**Acceptance Criteria:**
- [ ] Handler do `event_log` para o evento do pedido confirmado, no padrão dos handlers existentes (conferir `lib/events/` e `workers/`), que chama `criarPedido` com a `idempotency_key` do pedido e grava `estado`, `numero_erp` e `enviado_em`
- [ ] Resposta de aceite: `estado = aceito` e o número do ERP; recusa de negócio (`pedido_recusado`, `produto_indisponivel`, `endereco_fora_da_area`): `estado = recusado` e `motivo_recusa` com a mensagem do ERP; auditoria `pdv.order.sent` ou `pdv.order.rejected` (ações novas)
- [ ] Falha de transporte (ERP fora do ar, tempo esgotado): o evento volta para nova tentativa com a MESMA chave pelo mecanismo de tentativas do `event_log` e o pedido segue `confirmado`; nada de nova tentativa por conta própria dentro do handler
- [ ] Idempotência provada: processar o mesmo evento duas vezes não cria dois pedidos no mock (a segunda devolve o mesmo número)
- [ ] Fora desta rodada (próximo PRD): aviso na Central para pedido parado ou recusado, teto de tentativas com alerta e teste de carga
- [ ] Testes unitários do handler com o mock em memória: aceite, recusa, falha de transporte seguida de sucesso, dois processamentos; isolamento: o handler resolve a organização do evento, nunca do payload do cliente
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-021: API dos pedidos do dia e do pedido

**Description:** Como atendente, quero ver os pedidos de hoje e o resultado de cada um.

**Acceptance Criteria:**
- [ ] `GET /api/v1/pdv/pedidos?dia=hoje` devolve, do mais recente ao mais antigo, os pedidos do tenant cujo dia civil no fuso `America/Sao_Paulo` é hoje (sem limite nem paginação, como o protótipo), com número (ERP ou provisório), cliente, tipo, loja, pagamento, endereço e telefone só na entrega, itens, taxa, troco e total
- [ ] `GET /api/v1/pdv/pedidos/{id}` devolve um pedido com o estado (`confirmado`, `enviado`, `aceito`, `recusado`) e o motivo da recusa
- [ ] Endereço e telefone aparecem só para quem tem o papel mínimo `agent` do tenant; nada de dado pessoal em log
- [ ] Testes: dia no fuso de São Paulo (pedido às 23h30 do dia anterior não entra), ordem, isolamento entre tenants, papel, módulo desligado
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

### Bloco E. Telas do PDV (porte do protótipo)

#### US-022: Página do PDV: estrutura de três colunas e navegação

**Description:** Como atendente, quero a tela principal do PDV com o assistente, a montagem e o pedido atual lado a lado.

**Acceptance Criteria:**
- [ ] Rota `/app/pdv` dentro do layout do módulo (`notFound` com o módulo desligado), com porta declarada em `lib/navigation/catalogo.ts` (ou justificada na allowlist de `navegacao-completude`), título 'Forno • Novo pedido | PDV Pizzaria' conforme o protótipo ajustado à marca do CRM
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §1.1 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: topbar (marca, 'Balcão aberto' acima de 1100 px, botões 'Clientes' e 'Pedidos do dia', rótulo do atendente com o nome do usuário logado), três colunas nas proporções do protótipo, uma coluna a 760 px ou menos (assistente, montar, carrinho, nessa ordem)
- [ ] A coluna da direita alterna entre carrinho, fechamento, sucesso e pedidos do dia; as duas primeiras ficam travadas (`inert`) fora do carrinho
- [ ] Colunas ainda vazias nesta história exibem o estado vazio do protótipo; as demais histórias as preenchem
- [ ] O atendente vem da sessão (nome do usuário), nunca fixo como no protótipo
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-estrutura.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-023: Estado da sessão do pedido

**Description:** Como desenvolvedor, quero o estado do pedido em montagem num só lugar, para as colunas conversarem.

**Acceptance Criteria:**
- [ ] Módulo `lib/pdv/sessao.ts` (puro, testável) com `useSyncExternalStore` ou equivalente: itens do carrinho (com `origem` manual ou assistente), cliente selecionado (id do ERP, endereço), tipo (`balcao` padrão, `entrega`), loja do balcão, pagamento (Pix padrão) e troco, vista da coluna da direita, aviso corrente
- [ ] Operações puras: adicionar com soma só para produto simples sem personalização, salvar item (linha nova), remover, alterar quantidade, limpar itens (mantém cliente, tipo, loja e pagamento), novo pedido (zera tudo, volta a Balcão e Pix, mantém 'Pedidos do dia'), conforme `especificacao-prototipo.md` §2.3, §2.9 e §2.12
- [ ] O rascunho vive só na memória do navegador, como o protótipo (decisão desta rodada); trocar de rota dentro do PDV preserva o estado; recarregar a página o perde
- [ ] Nenhum dado pessoal em `localStorage`, `sessionStorage` nem URL
- [ ] Testes unitários das operações puras, inclusive 'pizza idêntica NÃO soma' e 'produto simples soma'
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-024: Coluna Montar pedido: abas e cartões do cardápio

**Description:** Como atendente, quero ver o cardápio da loja por abas e escolher um produto.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.1 (itens 1 a 3) (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: barra de busca no topo (a busca é a história de busca), abas Pizzas, Bebidas e Sobremesas (inicial: Pizzas), título da seção com 'N opções', grade de 2 colunas, cartão inteiro clicável que abre o configurador, 'A partir de' com o menor preço
- [ ] O cardápio vem do ERP pela API do cardápio; pizzas com foto (URL) ou marcador neutro; bebida e sobremesa com ícone
- [ ] Estados: carregando com esqueleto, erro com 'Tentar de novo', ERP não configurado com orientação ao dono da instalação, cardápio vazio
- [ ] Produto indisponível aparece desabilitado com o motivo e não abre o configurador
- [ ] A loja do cardápio é a do pedido (balcão: a escolhida; entrega: a do endereço); sem loja definida, o cardápio mostra o aviso do protótipo e usa a primeira loja ativa do tenant
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-cardapio.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-025: Configurador de pizza

**Description:** Como atendente, quero montar a pizza do jeito do cliente e ver o valor do item vindo do ERP.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.1 (itens 4 a 6) (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: 'Tamanho', 'Sabores' (1 sabor ou Meio a meio com 'Segundo sabor'), 'Ingredientes' (checkboxes; com meio a meio, por metade), 'Adicionais' (steppers), 'Observação · opcional'; sem campo de quantidade para pizza
- [ ] 'Valor do item' vem do ERP pela API de cálculo a cada mudança (com pequena espera para agrupar mudanças seguidas); o PDV não calcula; enquanto espera, mostra o estado de carregando e desabilita 'Adicionar ao carrinho'; erro do ERP mostra 'Tentar de novo'
- [ ] 'Adicionar ao carrinho' ou 'Salvar alterações' (ao editar); desabilitado quando meio a meio sem segundo sabor ou sem preço do ERP; sempre cria linha nova (pizza idêntica não soma); aviso 'Item adicionado ao pedido'
- [ ] Trocar de aba ou 'Voltar ao cardápio' descarta o rascunho sem confirmação (igual ao protótipo)
- [ ] Observação sem limite de caracteres no protótipo: o PDV limita em 300 e mostra o contador (`[A DEFINIR]` pelo dono; o teto protege o pedido enviado ao ERP)
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-configurador-pizza.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-026: Configurador de bebida e sobremesa e botões rápidos

**Description:** Como atendente, quero adicionar bebida e sobremesa rapidamente.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.1 (itens 2, 3 e 4, ramo 'se não for pizza') (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: botões de tamanho rápidos abaixo do cartão ('+ Lata', '+ 600ml', '+ 2L') que adicionam 1 unidade direto, com aviso '<nome> <tamanho> adicionado'; o cartão abre o configurador reduzido (Tamanho e Quantidade, mínimo 1)
- [ ] Preço vem do ERP; bebida e sobremesa não têm ingredientes, adicionais nem observação
- [ ] Produto com um só tamanho e categoria diferente de pizza é 'simples' (usa a janela de quantidade da busca)
- [ ] Produto indisponível não oferece os botões rápidos
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-bebida-sobremesa.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-027: Busca de produtos e janela de quantidade

**Description:** Como atendente, quero buscar um produto por nome, código ou ingrediente e adicioná-lo com a quantidade.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.2 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: campo 'Busque por nome, código ou ingrediente', 'Buscar'/Enter, 'Digite algo para buscar' com campo vazio, 'N produto(s) encontrado(s) para "termo"', cartões (foto ou 'Produto sem foto', descrição em 3 linhas, preço com 'A partir de'), cartão NÃO clicável, só 'Adicionar ao carrinho', paginação de 6 ('Anterior', 'Página X de Y', 'Próxima'), 'Limpar busca' volta às abas
- [ ] A busca usa a API de produtos do ERP; estados: carregando com 6 esqueletos e 'Buscar' desabilitado, 'Nenhum produto encontrado para "xyz". Tente outro termo.', erro 'Não foi possível consultar os produtos agora.' com 'Tentar de novo'
- [ ] Janela de quantidade para produto simples: nome, 'R$ x por unidade', '−'/'+', campo só com dígitos, 'Informe uma quantidade maior que zero' e 'Adicionar' desabilitado com vazio ou zero, Esc e fundo cancelam, Enter confirma; adicionar soma na linha existente do mesmo produto sem personalização; 'Produto adicionado ao carrinho'; busca e página permanecem; falha mantém a janela com 'Não foi possível adicionar o produto. Tente de novo.'
- [ ] Produto que não é simples (pizza, ou com mais de um tamanho) abre o configurador; o termo da busca nunca vai a URL, storage, log nem Sentry
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-busca-produto.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-028: Carrinho: itens, edição e totais

**Description:** Como atendente, quero conferir e ajustar os itens do pedido atual.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.3 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: cabeçalho 'Pedido atual' com 'N item no pedido'/'N itens no pedido' ou 'Seu pedido começa aqui' e o selo da soma das quantidades; cada item com descrição, 'N × R$ unit', 'Obs.:', stepper (mínimo 1), 'Editar' (abre o configurador no item), lixeira (remover imediato), selo de brilho nos itens do assistente
- [ ] 'Limpar pedido' pede confirmação inline ('Limpar todos os itens do pedido?', 'Cancelar', 'Sim, limpar'), zera só os itens e mostra 'Pedido limpo'
- [ ] Os valores (preço do item, subtotal, taxa, total e tempo estimado quando houver) vêm do ERP pela API de cálculo, recalculados a cada mudança; sem desconto nem cupom; enquanto calcula, mostra carregando; se o ERP falhar mantém o último total, marca 'valor desatualizado' e bloqueia 'Finalizar pedido'
- [ ] Item que ficou indisponível é destacado e bloqueia o fechamento até ser removido
- [ ] Carrinho vazio mostra 'Nenhum produto no carrinho'
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-carrinho.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-029: Identificação rápida do cliente no carrinho

**Description:** Como atendente, quero identificar o cliente direto no carrinho, sem sair da tela principal.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.4 (itens 1 a 4 e 9) (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: campo 'Cliente: telefone, nome ou CPF (F2)'; modo detectado sozinho (letra = nome; 11 dígitos que formam CPF válido = CPF; resto = telefone); lista suspensa (`role=listbox`) com até 6 resultados, nome em negrito e 'telefone · cpf · rua'; 'Nenhum cliente encontrado' e sempre 'Cadastrar novo cliente' no fim; setas, Enter e Esc; F2 foca o campo e desmarca o cliente
- [ ] A busca usa a API de busca de cliente que já existe (`GET /api/v1/pdv/clientes`), com a regra do ERP real (telefone e CPF exatos; nome 'contém'), NÃO a 'contém' do protótipo para telefone e CPF; o CPF e o telefone não vão a URL, storage, log nem Sentry; estados de carregando e erro com 'Tentar de novo' (o protótipo não os tem, o ERP real precisa)
- [ ] Selecionar grava o cliente na sessão e mostra o cartão (nome, telefone ou e-mail, 'Trocar cliente'); em Entrega seleciona o endereço principal (a ficha vem da API `GET /api/v1/pdv/clientes/{id}`)
- [ ] Correção do protótipo: o cartão do cliente e a regra de loja concordam sobre qual é o endereço (sem a divergência 'Sem endereço para entrega' com loja calculada pelo principal)
- [ ] 'Trocar cliente' e F2 voltam ao campo de busca
- [ ] O vínculo com o contato do CRM NÃO é criado ao selecionar (ADR-007 e ADR-008); o botão da ficha continua sendo o caminho
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-cliente-rapido.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-030: Endereço de entrega no carrinho

**Description:** Como atendente, quero escolher ou cadastrar o endereço de entrega no carrinho.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.4 (itens 5 e 6) (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: só em Entrega aparece a linha do endereço e o link 'Trocar endereço' (ou 'Adicionar' sem endereço) com a lista de endereços do cliente (principal marcado) e 'Novo endereço'
- [ ] 'Novo endereço' abre a janela 'Novo endereço' com o formulário de endereço (CEP com 8 dígitos consulta o ERP, 600 ms de espera com esqueleto, preenche UF, cidade, bairro e rua com vírgula; CEP não achado mostra 'CEP não encontrado. Preencha o endereço manualmente.'); 'Cancelar' e 'Salvar e usar'; valida e grava pela API de endereços; o primeiro endereço do cliente vira principal; falha mantém a janela aberta
- [ ] A loja e a taxa são recalculadas pelo ERP ao trocar o endereço
- [ ] Cliente sem endereço em Entrega: 'Sem endereço para entrega' (vermelho) e 'Adicionar'
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-endereco-carrinho.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-031: Cadastro de cliente em janela

**Description:** Como atendente, quero cadastrar um cliente que não existe sem sair do PDV.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.4 (itens 7 e 8) e §2.6 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: janela 'Cadastrar cliente' aberta por 'Cadastrar novo cliente' (e pelo assistente), com Nome*, Telefone, E-mail, CPF, Data de nascimento e, em Entrega, o endereço obrigatório (em Balcão só vale se começar a preencher); 'Cancelar' e 'Salvar e usar no pedido'
- [ ] Pré-preenchimento: com letra vai para Nome; com 11 dígitos formando CPF vai para CPF mascarado; senão Telefone (correção do protótipo, que mandava o CPF para o telefone)
- [ ] Validações e mensagens exatas do protótipo (`§3.5`): 'Informe o nome', 'Informe ao menos o telefone ou o e-mail', 'Informe o telefone com DDD', 'E-mail inválido', 'CPF inválido', 'Data inválida', 'Preencha este campo', 'Informe o CEP com 8 dígitos'
- [ ] Duplicidade (409 da API): alerta 'Já existe um cliente com este CPF.' ou 'com este telefone.' e botão 'Usar cliente existente' (seleciona a ficha existente); falha de gravação: 'Não foi possível cadastrar o cliente. Tente de novo.'
- [ ] Salvar seleciona o cliente novo (primeiro endereço como principal) e mostra 'Cliente cadastrado: <nome>'
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-cadastro-cliente.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-032: Tipo do pedido e loja

**Description:** Como atendente, quero escolher Balcão ou Entrega e ver a loja responsável pelo pedido.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.7 e §2.8 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD, com o nome 'Entrega' em TODAS as telas (decisão de 2026-11-18: o protótipo mostrava 'Delivery' no PDV); padrão Balcão; sem 'Retirada'; o mesmo valor serve ao PDV e às telas de cliente
- [ ] Balcão: seletor 'Loja do pedido' com 'Escolha a loja' e as lojas ATIVAS do tenant (`pdv_stores`), começa sem loja; se o tenant tem uma só, já vem definida; a escolha é guardada ao alternar para Entrega e voltar
- [ ] Entrega: texto com a loja que o ERP calcula para o endereço, selo 'Automática', recalculada ao trocar o endereço; sem cliente ou sem endereço 'Definida pelo endereço de entrega'; endereço fora da área 'Nenhuma loja entrega neste endereço' (vermelho); loja que não é do tenant: aviso de que o pedido não pode ser registrado aqui
- [ ] 'Finalizar pedido' fica desabilitado com título explicando: 'Pedido vazio', 'Identifique o cliente para finalizar', 'Defina a loja do pedido' (e o texto 'Identifique o cliente ... no campo acima (F2)')
- [ ] O tipo e a loja saem do estado da sessão e movem o cardápio e o cálculo
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-tipo-e-loja.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-033: Pagamento e troco no carrinho

**Description:** Como atendente, quero registrar a forma de pagamento pretendida e o troco.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.9 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: seletor 'Pagamento' com Dinheiro, Pix, Cartão de crédito e Cartão de débito, padrão Pix (nunca 'não escolhido'), e 'Troco R$' só para Dinheiro
- [ ] O PDV só registra a intenção: sem cobrança, sem link, sem divisão (decisão de 2026-11-18)
- [ ] O valor vai da sessão ao fechamento; a edição feita no fechamento volta à sessão (correção do protótipo, que a descartava ao voltar)
- [ ] Troco: aceita vírgula ou ponto e rejeita texto, com a regra do protótipo (`§3.3` item 6): valor finito e maior ou igual ao TOTAL COM A TAXA, senão 'O valor para troco deve ser igual ou maior que o total.'
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-pagamento.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-034: Fechamento do pedido

**Description:** Como atendente, quero conferir os dados e confirmar o pedido.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.10 e §3.3 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: vista 'Fechar pedido' com 'Nome do cliente *', 'Tipo do pedido' somente leitura ('Escolhido no carrinho') e 'Loja', em Entrega 'Endereço *' e 'Telefone *', 'Forma de pagamento', 'Troco para · opcional', 'Resumo do pedido' com os valores do ERP, 'Voltar' (sem perder itens) e 'Confirmar pedido'
- [ ] Validação do `validateCheckout` na mesma ordem e com as mesmas mensagens (cliente, nome, loja, itens, endereço e telefone em entrega, troco); editar um campo limpa o erro; as duas colunas da esquerda ficam travadas
- [ ] Cliente só com e-mail em Entrega pede o telefone no próprio fechamento (comportamento do protótipo, preservado)
- [ ] 'Confirmar pedido' chama a API de confirmar com uma `Idempotency-Key` gerada UMA vez por tentativa de fechamento (clique duplo e nova tentativa reusam a chave); `total_divergente` (409) mostra o total novo e exige nova confirmação; loja fora do tenant mostra a recusa
- [ ] Enquanto confirma, o botão mostra carregando e fica desabilitado
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-fechamento.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-035: Pedido confirmado e novo pedido

**Description:** Como atendente, quero ver o resultado do pedido e começar o próximo.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.11 e §2.12 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: vista 'Pedido confirmado' com `#` e o número (do ERP quando aceito; provisório enquanto na fila), nome, '<Tipo> · <Pagamento>', loja, endereço e telefone em Entrega, itens, taxa, troco ('devolver R$ Y'), 'Total final' e 'Novo pedido'
- [ ] Estado do envio visível: 'Enviando ao ERP' (confirmado ou enviado, com atualização automática por consulta periódica do pedido), 'Aceito pelo ERP' com o número, 'Recusado pelo ERP' com o motivo e orientação; recusa não apaga o pedido nem os itens
- [ ] 'Novo pedido' zera carrinho, configurador, busca, cliente, tipo (Balcão), loja e pagamento (Pix) e mantém 'Pedidos do dia'
- [ ] O botão 'Novo pedido' do chat só limpa a conversa e tem outro rótulo (correção do protótipo, que usava o mesmo rótulo para efeitos diferentes)
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-sucesso.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-036: Pedidos do dia

**Description:** Como atendente, quero ver os pedidos de hoje sem perder o pedido em andamento.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.13 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: botão 'Pedidos do dia' no topo, disponível em qualquer vista, que lembra de onde veio e oferece 'Voltar ao pedido'; título com 'N pedido(s)'; cartões do mais recente ao mais antigo com `#número · nome`, hora `HH:mm`, '<Tipo> · <Pagamento> · <Loja>', endereço e telefone só em Entrega, itens, 'Entrega: R$ x', 'Troco para R$ x' e 'Total'; vazio 'Nenhum pedido hoje'
- [ ] Os dados vêm da API de pedidos do dia (do tenant, no fuso de São Paulo); cada cartão mostra o estado do envio (aceito, enviando, recusado com o motivo); estados de carregando e erro com 'Tentar de novo'
- [ ] Os dois painéis da esquerda ficam travados enquanto a lista está aberta
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-pedidos-do-dia.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-037: Assistente: painel de conversa

**Description:** Como atendente, quero um painel de conversa para pedir em linguagem natural.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.14 (itens 1 a 3, 7) e §1.1 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: coluna 'Assistente' com subtítulo 'Simulação', vazio 'Olá! O que vamos pedir?', mensagem do usuário, 'digitando...' (`role=status`), resposta com texto e botões, respostas rápidas desabilitadas quando não são da última mensagem; Enter envia (e ignora Enter de composição IME); erro 'A resposta não chegou. Tente enviar novamente.'
- [ ] O assistente desta rodada é SIMULADO (o parser por frases do protótipo, sem IA); o painel é desenhado para trocar o parser por um provedor real sem mexer na tela (interface `Assistente.responder(mensagem, contexto)`)
- [ ] Privacidade (ADR-005): o contexto entregue ao parser NÃO contém CPF, telefone nem e-mail de cliente; contém o primeiro nome do cliente selecionado, o tipo, a loja, o endereço sem CEP, os itens do carrinho e os nomes do cardápio (correção do protótipo, que passava a ficha inteira); teste prova que a ficha completa nunca entra no contexto
- [ ] O painel fica travado fora do carrinho e cancela resposta em andamento
- [ ] Botão do cabeçalho 'Limpar conversa' (não 'Novo pedido')
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-assistente-painel.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-038: Assistente: o parser de frases

**Description:** Como desenvolvedor, quero o interpretador simulado das frases do atendente, como módulo puro e testado.

**Acceptance Criteria:**
- [ ] Módulo puro `lib/pdv/assistente/interpretar.ts`: dada uma frase e o contexto, devolve ações tipadas `identificar_cliente`, `opcoes_cliente`, `definir_tipo`, `definir_loja`, `definir_endereco`, `adicionar_item` (pizza, meio a meio, bebida, sobremesa, lanche, quantidade), `definir_pagamento` (com troco), `buscar`, `pendencias` e `cadastrar_cliente`, e as respostas e botões rápidos, conforme `especificacao-prototipo.md` §6 (intenções, extração, exemplos de frase e o que NÃO faz)
- [ ] Várias informações numa frase geram várias ações e um resumo do que mudou ('delivery pra Maria Oliveira, uma calabresa G e uma coca 2L no pix', com 'entrega' no lugar de 'delivery' como sinônimo aceito)
- [ ] As frases comprovadas por teste no protótipo (`§6.3`) viram casos de teste deste módulo, com os mesmos resultados; 'vai retirar' vira Balcão; 'troco para 100' vira troco de dinheiro
- [ ] A identificação de cliente é só uma AÇÃO ('identificar_cliente' com modo e termo): o parser nunca recebe lista de clientes
- [ ] O assistente nunca confirma o pedido nem o envia (não existe ação para isso)
- [ ] Tests pass (`pnpm test:unit`, sem filtro de caminho; o rodapé é comparado com a linha de base registrada no `progress.txt`)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-039: Assistente: aplicar as ações ao pedido

**Description:** Como atendente, quero que o que o assistente entendeu entre no pedido e eu veja o que mudou.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.14 (itens 3 a 5) e §6 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: as ações da jornada são aplicadas na sessão do pedido pelas MESMAS rotas e validações do modo manual (buscar cliente, cardápio, endereço, cálculo); item inválido ou indisponível não entra e o motivo aparece; só aplica na vista do carrinho (a busca é a exceção)
- [ ] Itens entram com `origem = assistente` (selo de brilho no carrinho) e as regiões alteradas (cliente, tipo, loja, pagamento) piscam por 2 s; aviso 'Pedido atualizado pelo assistente' e 'Item do assistente adicionado ao pedido'
- [ ] Cliente: um resultado seleciona; vários mostram botões com os nomes; nenhum mostra 'Cadastrar novo cliente' (abre a janela de cadastro); resposta de pergunta de tamanho continua a pizza (`p|m|g|gg` vira '<contexto>, tamanho <x>')
- [ ] 'O que falta?' (e 'fechar') lista o que impede finalizar (cliente, loja, itens, endereço, E TAMBÉM pagamento quando for dinheiro com troco inválido) com botões que levam à região (correção do protótipo, que não incluía pagamento); funciona também por um botão, sem digitar
- [ ] Busca por frase ('buscar frango', 'tem algo com catupiry?') atualiza a coluna Montar pedido e oferece 'Adicionar <produto>'
- [ ] Falha de qualquer rota do modo manual vira mensagem do assistente e não aplica nada
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-assistente-acoes.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-040: Assistente: voz

**Description:** Como atendente, quero ditar o pedido.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.14 (item 6) (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: botão de microfone só quando o navegador tem `SpeechRecognition` ou `webkitSpeechRecognition`; `pt-BR`; resultado parcial no campo de texto; NÃO envia sozinho; indicador 'Ouvindo...'; mensagens de erro exatas para permissão negada, nenhuma fala, outro erro e falha ao iniciar; a voz para ao enviar, ao travar o painel e ao limpar a conversa
- [ ] Sem suporte do navegador o botão não aparece e o painel funciona só com texto
- [ ] O áudio não é gravado nem enviado ao servidor do CRM: a transcrição é do navegador
- [ ] Testes de unidade do hook com reconhecimento simulado (como `speech-input.test.tsx` do protótipo); a validação com microfone físico fica para um humano e é registrada como não medida
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-tela-assistente-voz.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

### Bloco F. Tela de clientes e ficha (porte do protótipo)

#### US-041: Ficha: editar dados do cliente

**Description:** Como atendente, quero corrigir nome, CPF e nascimento do cliente pela ficha.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.5 (item 8) (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: botão 'Editar dados' no bloco 'Dados pessoais' abre 'Editar dados do cliente' ('Telefone e e-mail não podem ser alterados.') com Nome*, CPF e Data de nascimento; erros 'Informe o nome', 'CPF inválido', 'Data inválida'; 'Cancelar' e 'Salvar'; falha mantém a janela aberta
- [ ] Grava pela API de edição; depois de salvar a ficha mostra os dados novos; o botão 'Atualizar dados' do vínculo (ADR-008) continua a existir e é outra coisa (ERP para contato)
- [ ] CPF de edição duplicado no ERP aparece como erro do campo
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-ficha-editar-dados.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-042: Ficha: gerenciar endereços

**Description:** Como atendente, quero adicionar, alterar, remover e tornar principal um endereço na ficha.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.5 (itens 5 a 7 e 9) (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: 'Adicionar endereço' e, em cada cartão, 'Alterar', 'Remover' e 'Tornar principal' (só se não for principal; aplica na hora); modal de endereço com 'Campos com * são obrigatórios.', 'Cancelar' e 'Salvar endereço'; modal de remover com a descrição do protótipo e, ao remover o principal havendo outros, 'Novo endereço principal*' obrigatório
- [ ] O cartão mostra 'Loja de entrega: <loja>' (do ERP) ou 'Nenhuma loja entrega neste endereço' quando a loja é nula E o ERP já sabe (o texto neutro atual 'Loja de entrega ainda não definida' deixa de existir quando o mock calcula a loja)
- [ ] Primeiro endereço vira principal; falhas ao salvar e remover mantêm o modal aberto com a mensagem do protótipo
- [ ] Grava pelas APIs de endereço; a ficha se atualiza sem recarregar
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-ficha-enderecos-crud.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

#### US-043: Cadastro de cliente em tela própria e 'Selecionar cliente'

**Description:** Como atendente, quero a tela de cadastro completa e escolher o cliente da ficha para o pedido.

**Acceptance Criteria:**
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §1.3 e §2.6 (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: rota `/app/pdv/clientes/novo` com os cartões 'Dados pessoais' e 'Endereço' (selo 'Obrigatório' em Entrega e 'Opcional' em Balcão), rodapé fixo 'Cancelar' e 'Salvar cliente', pré-preenchimento por `modo` e `termo`, CEP que consulta o ERP, duplicidade com 'Abrir ficha existente'
- [ ] Salvar volta à ficha do cliente com o aviso 'Cliente cadastrado e selecionado para o pedido'
- [ ] Igual ao protótipo: `.business/bellacapri/projeto-crm/docs/interface/prototipo/especificacao-prototipo.md` §2.5 (itens 6 e 10) (regiões, rótulos, estados e mensagens exatos); onde o protótipo errou, vale a correção listada na seção 5 do PRD: em Entrega, rádio 'Usar neste pedido' em cada endereço (principal marcado) e, no rodapé, 'Selecionar cliente' bloqueado com 'Adicione um endereço para entrega' ou 'Escolha o endereço de entrega'; ao clicar grava o cliente na sessão e volta ao PDV
- [ ] O 'Tipo do pedido' do cabeçalho das telas de cliente é o MESMO valor do carrinho, com o nome 'Entrega' (e 'Balcão')
- [ ] Telas de erro e de rota inexistente do módulo em português (o protótipo as deixou em inglês)
- [ ] Spec Playwright dos estados em `tests/e2e/pdv-clientes-cadastro-e-selecao.spec.ts`, com as rotas `/api/v1/pdv/*` interceptadas, registrada numa `SPECS_PARTE_*` do `e2e.yml`, com screenshots em `evidence/modulo-pdv/` citados por um `.md` versionado (a cerca `evidencia-citada` passa); alturas dos alvos de toque medidas por `getBoundingClientRect` (>= 44 px)
- [ ] Textos novos em pt-BR com a entrada `es` em `lib/i18n/dicionario.ts`; nenhum texto de tela em inglês
- [ ] Lint passes
- [ ] Typecheck passes

### Bloco G. Prova e registro

#### US-044: Spec ponta a ponta contra o mock

**Description:** Como mantenedor, quero um caminho feliz do pedido inteiro contra o mock de verdade, para provar o conjunto.

**Acceptance Criteria:**
- [ ] Spec `tests/e2e/pdv-pedido-completo-mock.spec.ts`: login, módulo instalado, servidor do ERP cadastrado apontando para o mock, buscar cliente, vincular, montar pizza meio a meio com adicional, adicionar bebida pela busca, escolher Entrega e endereço, pagar em dinheiro com troco, fechar, confirmar e ver 'Aceito pelo ERP' com o número; e uma segunda rodada com recusa forçada vendo o motivo
- [ ] Registrada em `FORA_DO_CI` do `e2e.yml` com o motivo 'depende do mock do ERP por túnel HTTPS público'; só precisa estar escrita e registrada: a execução fica para um humano
- [ ] Roteiro manual em `.business/bellacapri/projeto-crm/modulo-pdv/roteiro-qa-pedido.md` com os mesmos passos e a lista do que o mock NÃO prova (regras reais de preço e taxa)
- [ ] Lint passes
- [ ] Typecheck passes

#### US-045: Registro da entrega

**Description:** Como mantenedor, quero a documentação e o registro de release da entrega.

**Acceptance Criteria:**
- [ ] Fragmento em `.changes/` com `impacto: capacidade_nova` descrevendo, na voz de quem usa, a tela do pedido do PDV, o assistente simulado e que o ERP é lido por um servidor MCP; `pnpm release:conferir` passa
- [ ] `docs/testing/user-journey-map.md` com as jornadas novas (montar pizza, buscar produto, identificar no carrinho, endereço, cadastro, fechar, pedidos do dia, assistente) e a prioridade de cada uma
- [ ] `docs/features/modulo-pdv.md` e o manual do módulo atualizados: o que existe, o mock, a regra 'o PDV não calcula', e o que ainda não existe (histórico por cliente, repetir último pedido, cancelamento, aviso na Central, IA real)
- [ ] O destino da mudança está declarado (núcleo, extensão, ambos ou infraestrutura), com a razão pela pergunta 'se nenhuma organização ativar isto, a operação comum continua inteira?'
- [ ] Living System Checklist respondido, nomeando os artefatos (consumidor do evento do pedido, tela, log)
- [ ] Variáveis de ambiente novas, se houver, em `.env.example` e `lib/env.ts`
- [ ] Lint passes
- [ ] Typecheck passes

## 9. Requisitos funcionais

- FR-1: O PDV nunca calcula preço, taxa, total nem tempo: exibe o que o ERP devolve.
- FR-2: A tela do pedido reproduz as regiões, os rótulos, os estados e as mensagens da especificação do protótipo, salvo as correções da seção 5.
- FR-3: Toda leitura e escrita do ERP passa por `lib/pdv/erp`, com o tenant da sessão, e nunca expõe a chave nem o endereço do servidor.
- FR-4: O pedido confirmado é gravado uma vez (idempotência por organização e chave) e enviado ao ERP uma vez, pelo `event_log`, com a mesma chave.
- FR-5: A confirmação só acontece por clique do atendente; nem o assistente nem nenhum automatismo confirma ou envia.
- FR-6: A loja do pedido é a escolhida (Balcão) ou a que o ERP calcula para o endereço (Entrega); loja de outro tenant é recusada com aviso.
- FR-7: O assistente desta rodada é simulado e não recebe CPF, telefone nem e-mail do cliente.
- FR-8: Toda rota resolve o tenant da sessão, filtra `organization_id`, exige papel mínimo `agent`, devolve 404 com o módulo desligado e audita as mutações sem dado pessoal.
- FR-9: Selecionar um cliente no carrinho não cria contato nem vínculo no CRM (ADR-007 e ADR-008).
- FR-10: O mock é isolado do código do produto e provado por uma suíte de contrato reaproveitável contra o ERP real.

## 10. Considerações técnicas

- **Doutrina do CRM (obrigatória):** `organization_id` e RLS em toda tabela; service role filtra organização manualmente; migration com a tripla (migration, apêndice idempotente no baseline antes da `VARREDURA anon`, `-- manifest:`); função nova em `public` revoga `PUBLIC` e `anon`; Zod em todo input externo; `requireRole` e `requireSupportWrite(` antes do efeito; auditoria de mutação (ações novas em `lib/audit/actions.ts`); sem `console.log`; `X-Request-Id`; dinheiro em `_cents`.
- **Numeração de migration:** a série deste fork usa 9044, 9045 e 9422; o produto chega a 9421 e a série 90NN dele também existe. Rodar `pnpm checar:colisao-de-migration` (que só enxerga o arquivo depois de commitado) e conferir a `main` do produto; o próximo número livre medido em 2026-11-18 foi 9423.
- **Provisionadora:** as tabelas novas nascem em `fn_pdv_provisionar()` (ADR-0002 do CRM), com `create or replace` e `if not exists`; cada tabela entra nas listas de invariantes descritas no `progress.txt`.
- **MCP do ERP:** Streamable HTTP, `Authorization: Bearer`, um handshake por chamada, tempo limite por chamada, endereço HTTPS público, registro por organização (ver `lib/pdv/erp/cliente.ts`).
- **Testes:** testes unitários com o mock em memória e o `fetch` injetado; especificações Playwright com as rotas `/api/v1/pdv/*` interceptadas, registradas numa `SPECS_PARTE_*` (a cerca `e2e-cobertura-completa` reprova spec órfã); a única spec contra o mock pela rede fica em `FORA_DO_CI` com o motivo escrito.
- **i18n:** todo texto novo tem a entrada `es` em `lib/i18n/dicionario.ts`; a cerca `passagem-motivo-em-portugues` reprova código de vocabulário do banco como literal em tela.
- **Evidência:** screenshots em `evidence/modulo-pdv/`, citados por um `.md` versionado (cerca `evidencia-citada`); alturas dos alvos de toque medidas por `getBoundingClientRect`.
- **Receita do e2e isolado:** no `progress.txt` (worktree fora de `/tmp`, `project_id` próprio, portas 5732x, `next start` na 3100).
- **Branch:** atualizar com a `main` antes de começar; o Ralph não fala com o ERP real nem com o mock pela rede.

## 11. Métricas de sucesso

- As 45 histórias com `passes: true`, e a suíte unitária com as mesmas falhas pré-existentes da linha de base (nenhuma nova).
- Um pedido completo percorre a tela contra o mock (spec de ponta a ponta escrita; execução por um humano).
- O contrato v0.4 e a suíte de contrato passam contra o mock e estão prontos para o ERP.

## 12. Perguntas abertas

- **Observação do item:** o protótipo não limita; o PDV limita a 300 caracteres (US-025). O dono confirma o limite?
- **Origem do pedido (telefone ou balcão):** fora desta rodada, porque o protótipo não a tem; o PRD do FR-010 pede que seja gravada.
- **Cancelamento do pedido:** quem pode e até que estado depende do ERP (pergunta 8 do contrato).
- **Quantos pedidos listar em "Pedidos do dia":** o protótipo não limita; a lista cresce com o dia.
- **Regras reais de preço, taxa e tempo:** a definir com o ERP depois das telas; o mock usa a regra de exemplo do protótipo.
