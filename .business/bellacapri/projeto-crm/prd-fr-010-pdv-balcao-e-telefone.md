### PRD: FR-010 Pedido manual no PDV (balcão e telefone)

Versão: 0.7 (rascunho)
Data: 2026-11-16
Responsável: A definir
PRD pai: [prd-call-center-pdv-visao-geral.md](prd-call-center-pdv-visao-geral.md) (v0.2), requisito FR-010
Protótipo de referência: https://github.com/andregoncalesocteto/cart-craft-counter (commit 452cfd9, feito no Lovable)
Interfaces: `docs/interface/identificar-cliente/` e `docs/interface/consultar-produto/`

---

### Resumo

O atendente registra no módulo PDV o pedido do cliente que está no balcão ou que ligou. Ele identifica o cliente, monta o carrinho a partir do cardápio da loja, define tipo (balcão ou entrega) e loja, confirma e envia o pedido ao ERP. A ligação é atendida na telefonia atual da rede, fora do CRM. O CRM guarda o pedido, a origem (telefone ou balcão) e o rastro do envio. Preço, taxa, estoque e área de entrega vêm do ERP; pagamento e nota ficam no caixa do ERP.

Este documento detalha o FR-010 e traz como insumo um protótipo de interface já construído. Onde o protótipo diverge do PRD pai, vale o PRD pai (seção "Divergências do protótipo").

---

### Contexto e problema

Público-alvo
- Atendentes do call center (17), que registram pedidos de telefone para qualquer loja da rede
- Atendentes de balcão nas lojas

Cenários de uso chave
- O cliente liga, o atendente o identifica pelo telefone, vê o histórico e registra o pedido de entrega
- O cliente chega ao balcão e o atendente monta o pedido com a última compra como sugestão
- O cliente é novo: o atendente o cadastra sem perder a venda
- O ERP está fora do ar: o pedido fica como rascunho e não se perde

Problemas priorizados
- O software atual do call center é de baixa qualidade (prioridade alta)
- Sem histórico do cliente à mão, o atendente refaz perguntas e o pedido demora (hipótese)

---

### Objetivos e métricas

| Objetivo | Métrica | Meta (hipótese) |
| --- | --- | --- |
| Padronizar a rede | Pedidos com preço diferente do ERP | 0 |
| Reduzir tempo de registro | Tempo do cliente identificado até o pedido enviado | A definir com o piloto |
| Vender mais | Ticket médio dos pedidos de PDV | +10%, em linha com o PRD pai |
| Qualidade do cadastro | Pedidos de entrega sem endereço válido | 0 |

---

### Escopo

Incluso
- Identificar cliente por telefone, nome ou CPF
- Cadastrar cliente novo e gerenciar os endereços dele
- Consultar produtos e montar o carrinho (tamanho, meio a meio, adicionais, ingredientes removidos, observação, quantidade)
- Escolher tipo (balcão ou entrega) e loja; gravar a origem (telefone ou balcão)
- Confirmar o pedido e enviá-lo ao ERP de forma idempotente, com rascunho se o ERP estiver fora do ar
- Histórico do cliente e sugestão do último pedido
- Assistente de IA do atendente dentro do PDV, que propõe ações sobre o pedido (decisão de 2026-11-16)
- Lojas atendidas pelo tenant: cada tenant atende um conjunto de lojas, e todos os operadores do tenant atuam em todas elas; o tenant do Call Center atende todas as lojas (decisão de 2026-11-16)

Fora de escopo
- Atendimento da ligação pelo CRM (IA de voz, ponte de áudio, transcrição), decidido no PRD pai
- Emissão de nota fiscal e processamento de pagamento (ficam no caixa do ERP)
- Roteirização e controle de entrega
- Cadastro de produtos e de preços (o ERP é a fonte)

---

### Requisitos funcionais

#### FR-010.1 Identificar cliente
O atendente encontra o cliente por telefone, nome ou CPF e o seleciona para o pedido.

**Fluxo principal**
- O atendente informa um telefone, um nome ou um CPF
- O CRM busca o cliente (no ERP, ver decisão)
- A ficha aparece com dados pessoais, endereços e histórico, e o atendente seleciona o cliente

**Fluxos alternativos e exceções**
- Vários clientes (busca por nome): lista com nome e endereço, o atendente escolhe um
- Nenhum cliente: oferece cadastrar (FR-010.2)
- Formato inválido: telefone sem DDD e CPF com dígito verificador errado não pesquisam
- Cliente obrigatório: sem cliente identificado, o pedido não finaliza

**Erros previstos**
- Falha na busca no ERP

**Prioridade:** alta

---

#### FR-010.2 Cadastrar cliente
O atendente cria a ficha do cliente que não existe e o seleciona para o pedido.

**Fluxo principal**
- O atendente preenche Nome e (telefone ou e-mail), mais CPF e data de nascimento se tiver
- O endereço é obrigatório em pedido de entrega e opcional no balcão
- O CRM salva e seleciona o cliente

**Fluxos alternativos e exceções**
- CPF ou telefone já cadastrado em outra ficha: bloqueia e oferece abrir a ficha existente
- Campos opcionais em branco no balcão: aceitos
- O atendente edita depois só Nome, CPF e data de nascimento; telefone e e-mail não são editáveis aqui

**Erros previstos**
- CPF, e-mail ou data inválidos
- Falha ao salvar

**Prioridade:** alta

---

#### FR-010.3 Gerenciar endereços do cliente
O cliente tem vários endereços; o atendente os altera, adiciona, remove e escolhe o do pedido.

**Fluxo principal**
- O atendente vê os endereços, com selo de principal e a loja que entrega em cada um
- Adiciona ou altera um endereço; o CEP preenche UF, cidade e bairro e os campos continuam editáveis
- Escolhe o endereço do pedido de entrega

**Fluxos alternativos e exceções**
- Primeiro endereço vira o principal; o atendente pode trocar o principal
- Remover é definitivo e pede confirmação; se era o principal, escolhe o novo
- CEP não encontrado: digitação manual
- Alterar endereço usado em pedido antigo não muda o pedido antigo
- Endereço sem loja entregadora: o ERP sinaliza e o endereço pode ser salvo, mas o pedido de entrega não segue

**Erros previstos**
- Consulta de CEP indisponível

**Prioridade:** alta

---

#### FR-010.4 Consultar produto e montar o carrinho
O atendente busca no cardápio da loja e monta o pedido.

**Fluxo principal**
- Busca livre por nome, código ou ingrediente, com resultados em cards paginados (foto, nome, descrição, preço)
- Produto simples entra pela janela de quantidade (número inteiro); pizza entra pelo configurador (tamanho, meio a meio, adicionais, ingredientes removidos, observação)
- O carrinho soma a quantidade quando o item é igual e mostra o total
- O preço de cada item, inclusive meio a meio e adicionais, e a taxa, o tempo e o total são calculados pelo ERP; o PDV não calcula preço. A foto vem como URL do CDN

**Fluxos alternativos e exceções**
- Item indisponível: não entra no carrinho
- Preço, disponibilidade e cardápio vêm do ERP para a loja do pedido
- Produto sem foto: marcador neutro

**Erros previstos**
- ERP fora do ar na consulta
- Preço mudou entre o carrinho e o envio: vale o do ERP e o atendente é avisado

**Prioridade:** alta

---

#### FR-010.5 Tipo do pedido e loja
O pedido é de balcão ou de entrega, e a loja é definida pela regra do tipo.

**Fluxo principal**
- Balcão: o atendente escolhe a loja entre as que o tenant atende; se o tenant atende uma só, ela já vem definida
- Entrega: o ERP calcula a loja que entrega no endereço escolhido
- A origem do pedido (telefone ou balcão) é gravada, separada do tipo

**Fluxos alternativos e exceções**
- Entrega sem endereço: não finaliza
- Endereço fora da área de todas as lojas: não finaliza e orienta trocar o endereço

**Erros previstos**
- Loja inválida ou não informada

**Prioridade:** alta

---

#### FR-010.6 Confirmar e enviar o pedido ao ERP
O pedido confirmado segue ao ERP uma única vez.

**Fluxo principal**
- O atendente confere o carrinho, o cliente, o tipo, a loja e o endereço, e confirma
- O CRM grava o pedido (rascunho, depois confirmado) e envia ao ERP em até 60 segundos, com chave de idempotência
- O resultado do ERP (aceito ou recusado) fica registrado, e o atendente vê o número do pedido

**Fluxos alternativos e exceções**
- ERP fora do ar: o pedido permanece como rascunho, o atendente é avisado e há reenvio
- Reenvio ou clique duplo: não cria um segundo pedido
- Recusa do ERP: o atendente vê o motivo e pode corrigir
- Taxa de entrega e total vêm do ERP; o PDV não tem valor fixo

**Erros previstos**
- Divergência de preço entre CRM e ERP
- Tempo esgotado na resposta do ERP

**Prioridade:** alta

---

#### FR-010.7 Histórico e recompra
O atendente vê o que o cliente costuma pedir e repete o último pedido.

**Fluxo principal**
- A ficha mostra os pedidos anteriores e a última compra
- "Repetir último pedido" monta o carrinho com os mesmos itens, conferidos contra o cardápio atual do ERP

**Fluxos alternativos e exceções**
- Item do último pedido indisponível ou com preço novo: o atendente é avisado item a item
- Cliente sem histórico: sem sugestão

**Erros previstos**
- Falha ao carregar o histórico

**Prioridade:** média

---

#### FR-010.8 Assistente do atendente
O atendente fala ou digita livremente e o assistente propõe ações sobre o pedido; quem confirma é sempre o atendente.

**Fluxo principal**
- O atendente descreve em linguagem natural, por texto ou por voz transcrita no navegador (ex.: "delivery para a Maria Oliveira, uma calabresa G e uma coca 2L")
- O assistente devolve ações estruturadas: identificar cliente, definir tipo, loja, endereço, adicionar ou remover item, e consultar pendências
- O PDV valida cada ação contra o ERP (cliente existe, item existe e está disponível, loja entrega no endereço, preço atual) e a aplica ao carrinho
- O atendente vê o que mudou, destacado, e confere antes de finalizar
- "O que falta?" lista o que impede a finalização, com botões para resolver

**Fluxos alternativos e exceções**
- Vários clientes possíveis: o assistente mostra as opções e o atendente escolhe
- Cliente não encontrado: oferece o cadastro
- Item ambíguo ou indisponível: o assistente pergunta ou sugere, sem inventar
- Ação recusada na validação: nada é aplicado e o atendente vê o motivo
- Assistente indisponível ou sem orçamento: o PDV segue funcionando só no modo manual

**Erros previstos**
- Falha do provedor de IA
- Limite de orçamento de IA atingido
- Interpretação errada de um sabor ou quantidade

**Regras**
- O assistente nunca confirma o pedido, nunca envia ao ERP e nunca grava por conta própria: só propõe, e a aplicação passa pelas mesmas validações do modo manual
- O CPF, o telefone e o e-mail do cliente não vão ao modelo; vai o primeiro nome e o que for necessário para montar o pedido
- Cada item guarda se entrou manualmente ou pelo assistente (como o protótipo faz)

**Prioridade:** média

---

#### FR-010.9 Lojas do tenant
Cada tenant atende um conjunto de lojas, e todos os operadores do tenant atuam em todas elas. Exemplos: o tenant Campinas atende a loja CAS; o tenant Rio Preto atende RPA, RPV, RPR e RPI, e o balcão de Rio Preto vê as quatro; o tenant do Call Center atende todas as lojas.

**Fluxo principal**
- O administrador do tenant mantém as lojas na aba **Lojas** da configuração do tenant, no mesmo grupo de Equipe e Agentes; a aba só aparece com o módulo PDV ligado
- Cada loja mostra o código (identificador do ERP, ex.: CAS, RPA), o nome, se está ativa e a conexão de WhatsApp vinculada a ela
- Ao abrir o PDV, o operador vê as lojas do tenant
- Em pedido de balcão, o operador escolhe a loja entre as do tenant; se o tenant atende uma só, ela já vem definida
- Em pedido de entrega, a loja é a que o ERP calcula pelo endereço, restrita às lojas que o tenant atende

**Fluxos alternativos e exceções**
- Loja que não pertence ao tenant: o servidor recusa, mesmo que a requisição a informe
- Loja desativada na aba: deixa de aparecer nas escolhas do PDV e não altera pedidos anteriores (hipótese)
- Cliente da rede: o ERP é o cadastro mestre, e cada tenant guarda o seu contato espelho do mesmo cliente
- Endereço de entrega cuja loja calculada pelo ERP não pertence ao tenant: [ver pendência 1]

**Tela:** a aba Lojas é tela do CRM (Next.js), não do protótipo do Lovable.

**Erros previstos**
- Tenant sem loja cadastrada
- Loja removida do tenant no meio de um pedido em andamento

**Prioridade:** alta

---

---

### Requisitos não funcionais

Performance
- Busca de cliente e de produto responde em até 3 segundos no p95 (hipótese)
- Resposta do assistente em até 10 segundos no p95 (hipótese, como no PRD pai)
- Preço do item no configurador de pizza em até 1 segundo no p95 (hipótese), já que o ERP calcula a cada mudança
- Envio do pedido ao ERP em no máximo 60 segundos após a confirmação

Disponibilidade
- O PDV abre e registra rascunho mesmo com o ERP fora do ar

Segurança e autorização
- Hipótese: papel mínimo de atendente (`agent`); o tenant e a lista de lojas resolvidos no servidor, e a loja da requisição validada contra as lojas do tenant mesmo em consultas com acesso privilegiado; orçamento de IA com teto para o assistente (sem isenção); CPF cifrado em repouso; auditoria de toda criação e alteração de pedido

Observabilidade
- Rastro por pedido: origem, loja, itens, dados enviados, resposta do ERP, tentativas e atendente

Confiabilidade e integridade de dados
- Envio idempotente ao ERP; preço do item gravado como informado pelo ERP no momento da confirmação

Compliance
- LGPD: CPF e data de nascimento seguem a anonimização e a retenção do CRM; pedido anonimiza com o cliente

Acessibilidade
- Telas de toque com alvos de no mínimo 44 px, rótulos visíveis e mensagens de erro junto ao campo (herdado do estilo das interfaces)

---

### Divergências do protótipo (o que corrigir antes de aproveitar)

| Ponto no protótipo | Regra do PRD | Ação |
| --- | --- | --- |
| Taxa de entrega fixa em R$ 8,00 | O ERP é a fonte única de taxa | Buscar a taxa no ERP |
| Pagamento (dinheiro, Pix, cartão, troco) coletado no PDV | Pagamento e nota ficam no caixa do ERP | Decidir se o PDV só registra a forma pretendida (pendência 2) |
| Só existe o tipo (Balcão ou Delivery) | A origem (telefone ou balcão) precisa ser gravada | Acrescentar a origem |
| Cardápio, clientes e CEP são dados de exemplo | Dados vêm do ERP | Trocar por chamadas via MCP |
| Cliente com um telefone | A unicidade de telefone e CPF bloqueia duplicata | Manter, mas validar no ERP e no CRM |
| Loja por lista fixa | Loja vem do ERP | Buscar do ERP |
| Preço calculado no cliente (meio a meio pelo maior valor, soma de adicionais) | O ERP calcula tudo | Remover a regra e chamar o ERP |
| Assistente do atendente por regras simuladas (parser de frases) | FR-010.8: o assistente entra | Trocar o parser por um ponto de IA que devolve ações estruturadas; manter o conjunto de ações e os testes de frases como especificação |

---

### Arquitetura e abordagem

Abordagem
- Módulo opcional do DeskcommCRM, desligado por padrão, com tabelas próprias, como definido no PRD pai e na ADR-0002 do CRM. O plano está em [plano-migracao-pdv-para-deskcommcrm.md](plano-migracao-pdv-para-deskcommcrm.md)
- Consulta ao ERP síncrona (cardápio, cliente, CEP, loja, taxa); envio do pedido assíncrono, com rascunho no CRM e worker idempotente

Componentes
- Telas do PDV (identificação, cadastro, consulta e carrinho, fechamento)
- Assistente do atendente (ponto de IA com ações estruturadas, painel de conversa e validação das ações)
- Entidade pedido com itens e opções
- Cliente e endereços
- Cliente MCP para o ERP e worker de envio
- Aviso na Central para pedido não enviado

Integrações
- MCP do ERP: buscar e cadastrar cliente, endereços, consultar CEP, cardápio, preço, disponibilidade, loja que entrega e taxa, criar, consultar e cancelar pedido. Levantamento completo em [contrato-mcp-erp.md](contrato-mcp-erp.md)

### Decisões e trade-offs

#### Decisão: Pedido rascunho no CRM, enviado ao ERP por worker idempotente
- **Justificativa:** herda do PRD pai; o rascunho sobrevive ao ERP fora do ar
- **Trade-off:** exige a entidade pedido e o worker

#### Decisão: A origem do pedido é um campo próprio, separado do tipo
- **Justificativa:** o tipo (balcão ou entrega) e o canal (telefone ou balcão) variam de forma independente, e as métricas precisam dos dois
- **Trade-off:** uma tela e uma coluna a mais

#### Decisão: O assistente do atendente entra no escopo do FR-010 (2026-11-16)
- **Contexto:** o protótipo traz um chat em que o atendente fala livremente (inclusive por voz) e o assistente preenche cliente, tipo, loja, endereço, itens e pagamento. O PRD pai não previa isso
- **Abordagem:** um ponto de IA novo no CRM, no estilo de "Conversar com o caso", que reaproveita a configuração de agente (persona, modelo, provedor, credencial, orçamento e rastro) e **devolve ações propostas em formato estruturado**. O PDV valida cada ação contra o ERP e a aplica; o atendente confere e confirma. O runtime de atendimento por turno de contato não é usado, porque limita escritas ao contato da conversa
- **Trade-off:** ganha velocidade de registro, mas exige custo de IA controlado, minimização de dados enviados ao modelo e testes do que o assistente pode propor

#### Decisão: Tenants por unidade operacional, com as lojas que cada um atende (2026-11-16)
- **Contexto:** a rede se organiza em unidades (Campinas, Rio Preto) e em um Call Center que atende todas as lojas, cada um com as suas conexões e agentes
- **Decisão:** um tenant do CRM por unidade e um para o Call Center; a loja é dado do módulo em cada tenant; todos os operadores do tenant atuam em todas as lojas dele. O CRM não cruza tenants, e o ERP é a camada comum
- **Trade-off:** o pedido do call center para uma loja de outro tenant fica no tenant do call center. O histórico do cliente e os números por loja precisam vir do ERP

#### Decisão pendente: onde mora o cliente (CRM, ERP ou os dois)
- **Contexto:** a decisão tomada nas interfaces foi que os clientes ficam no ERP via MCP. O CRM já tem contatos, que sustentam conversas, funil e LGPD
- **Hipótese de trabalho:** o ERP é o cadastro mestre; cada tenant guarda um contato espelho com o identificador do ERP, criado ou atualizado quando o cliente é selecionado. Como o CRM não cruza tenants, o ERP também é o que liga o mesmo cliente nos vários tenants e fornece o histórico completo
- **Trade-off:** duas cópias exigem regra de sincronização; usar só o ERP quebra conversas e funil

---

### Dependências

#### Técnica: API e MCP do ERP
Além de cardápio, preço e pedido do PRD pai, o PDV precisa de: buscar e cadastrar cliente, endereços (listar, criar, alterar, remover, principal), consulta de CEP, loja que entrega em um endereço e taxa de entrega.

#### Técnica: Estrutura de dados no CRM
O CRM não tem endereço de contato, variação de produto, pedido de PDV nem o conceito de loja dentro de uma organização. Ver o plano de migração.

#### Técnica: Lojas do tenant
O CRM não tem hoje o conceito de loja. O módulo precisa criar a entidade loja (as que o tenant atende) e validar a loja de toda requisição contra elas, com RLS por tenant e testes de isolamento entre tenants. Ver o plano de migração.
---

### Riscos e mitigação

#### O contrato do ERP para cliente e endereço atrasa
- **Probabilidade:** alta
- **Impacto:** o PDV não identifica nem cadastra cliente
- **Mitigação:** priorizar buscar cliente e criar pedido; cadastro e endereço em fatia seguinte
- **Plano de contingência:** usar o cadastro de contatos do CRM como cadastro local provisório

#### Duplicidade de cliente entre ERP e CRM
- **Probabilidade:** média
- **Impacto:** histórico dividido e pedidos no cliente errado
- **Mitigação:** chave do ERP guardada no contato; CPF e telefone como chaves de conferência
- **Plano de contingência:** rotina de unificação

#### O assistente interpreta errado e o atendente confirma sem conferir
- **Probabilidade:** média
- **Impacto:** pedido errado e prejuízo
- **Mitigação:** destaque visual do que mudou, resumo antes de finalizar e validação contra o ERP
- **Plano de contingência:** desligar o assistente por loja e seguir no modo manual

#### Custo de IA do assistente cresce com o uso
- **Probabilidade:** média
- **Impacto:** gasto acima do orçamento do provedor
- **Mitigação:** teto de orçamento sem isenção, medição por atendente
- **Plano de contingência:** limitar por turno ou desligar

#### Pedido de uma loja registrado em outro tenant
- **Probabilidade:** alta
- **Impacto:** o tenant da loja não vê no CRM o pedido que o call center registrou; o painel por loja fica incompleto
- **Mitigação:** gravar no ERP a origem e o tenant de origem do pedido, e tirar os números por loja do ERP
- **Plano de contingência:** relatório consolidado externo

---

### Critérios de aceitação

- O atendente identifica um cliente por telefone, nome ou CPF e vê a ficha com os endereços
- Telefone ou CPF repetido bloqueia o cadastro e oferece abrir a ficha existente
- Pedido de entrega só finaliza com endereço, e a loja é a que o ERP calcula para ele; pedido de balcão não exige endereço
- Toda criação de pedido guarda a origem (telefone ou balcão), a loja e o atendente
- Reenviar o mesmo pedido não cria um segundo pedido no ERP
- Com o ERP fora do ar, o pedido fica como rascunho e o atendente é avisado
- Nenhum pedido registra preço ou taxa diferente do informado pelo ERP
- Alterar ou remover um endereço não muda pedidos anteriores
- "Repetir último pedido" avisa item indisponível ou com preço novo
- O assistente propõe ações e nenhuma é aplicada sem passar pela validação contra o ERP; ele nunca confirma nem envia o pedido
- Dados pessoais do cliente (CPF, telefone, e-mail) não são enviados ao modelo
- Com o assistente indisponível ou sem orçamento, o PDV segue funcionando no modo manual
- Um teste de isolamento confirma que um atendente não vê pedidos nem clientes de outra organização
- Um operador só registra pedido para as lojas do seu tenant, e todos os operadores do tenant atuam em todas as lojas dele; o tenant do Call Center atende todas as lojas; a recusa de loja de outro tenant vale no servidor

---

### Testes e validação

- Testes unitários: validações de CPF, telefone e CEP, regras de endereço principal, regra de loja por tipo, idempotência do envio
- Testes de integração do contrato com o ERP
- Teste de isolamento entre organizações (obrigatório no CRM)
- Testes do assistente: cada ação isolada, frases combinadas, cliente ambíguo e não encontrado, item indisponível, tentativa de confirmar o pedido (deve ser recusada) e verificação de que nenhum dado pessoal vai ao modelo
- Avaliação com frases reais dos atendentes antes do piloto
- QA manual guiado por roteiro, por uma pessoa no sistema real; os casos de uso e o protótipo servem de base dos cenários
- Piloto na loja piloto, com atendente humano registrando e conferindo o pedido no ERP

---

### Pendências

1. **Loja calculada fora do tenant:** em pedido de entrega, o ERP calcula a loja pelo endereço. Se ela não pertence ao tenant do operador (por exemplo, um atendente de Campinas com endereço atendido por Rio Preto), recusa, ou o pedido segue para o tenant certo?
2. **Pagamento:** o PDV registra a forma de pagamento pretendida e o troco como informação ao ERP, ou não toca em pagamento?
3. **Cliente:** confirmar o ERP como cadastro mestre e o contato do CRM como espelho.
4. **Assistente do atendente:** definir qual agente (persona e modelo) ele usa, o teto de orçamento por loja ou por atendente, e se a voz é só a transcrição do navegador.
5. **Resolvida em 2026-11-16:** o ERP devolve cardápio, tamanhos, ingredientes, adicionais e preços calculados, inclusive o meio a meio. O PDV não calcula preço.
6. **Histórico entre tenants:** o histórico do cliente vem do ERP e mostra pedidos de qualquer loja? (O pedido que o call center registra para loja de outro tenant fica só no tenant do call center, sem cópia, decidido em 2026-11-16.)
7. **Quem confirma o envio ao ERP:** o atendente (assumido aqui) ou o envio é automático ao confirmar?
8. **Aba Lojas:** as lojas são cadastradas à mão ou escolhidas da lista do ERP (`listar_lojas`)? Quem pode editar: gerente ou administrador do tenant? Uma conexão de WhatsApp pode atender mais de uma loja?
