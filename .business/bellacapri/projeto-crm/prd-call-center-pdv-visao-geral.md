### PRD: DeskcommCRM Call center com IA e ponto de venda para a rede Bella Capri (visão geral)

Versão: 0.7 (rascunho)
Data: 2026-11-16
Responsável: A definir

---

### Resumo

A Bella Capri, rede de pizzarias, já opera um call center com 17 atendentes e um software atual de baixa qualidade. O custo principal da operação é a folha de atendentes. Este programa transforma o DeskcommCRM em um sistema de call center com ponto de venda, em que a IA atende primeiro e o humano assume quando necessário, o ERP da rede é acessado por MCP e o cliente pode pedir por WhatsApp, app-chat, telefone e balcão. Telefone e balcão são atendidos por humano, que registra o pedido no módulo PDV. O app da rede envia os eventos do cliente ao funil, e a IA recupera os carrinhos não finalizados e tenta fechar a venda. A ênfase é vender mais, com redução de custo de atendimento e padronização da rede. Este documento é a visão geral. Cada requisito funcional terá o seu PRD detalhado.

Documentos relacionados
- [prd-fr-010-pdv-balcao-e-telefone.md](prd-fr-010-pdv-balcao-e-telefone.md): PRD filho do FR-010, incluindo o assistente do atendente
- [plano-migracao-pdv-para-deskcommcrm.md](plano-migracao-pdv-para-deskcommcrm.md): como o módulo PDV entra no DeskcommCRM, decisões e fases
- [contrato-mcp-erp.md](contrato-mcp-erp.md): levantamento das ferramentas que o MCP do ERP precisa oferecer
- `docs/interface/`: casos de uso e prompts das telas (identificar cliente, consultar produto)
- Protótipo do PDV no Lovable: https://github.com/andregoncalesocteto/cart-craft-counter

---

### Contexto e problema

Público-alvo
- Clientes da Bella Capri que pedem por WhatsApp, app-chat, telefone ou balcão
- Os 17 atendentes do call center
- Gestão da rede e franqueadora
- Lojas da rede

Cenários de uso chave
- O cliente pede pizza pelo WhatsApp da sua loja ou pelo app-chat e a IA conduz o pedido até o ERP
- O cliente monta o carrinho no app e não finaliza; a IA recupera o carrinho e tenta fechar a venda
- O cliente liga e o atendente registra o pedido no módulo PDV
- O cliente chega ao balcão e o atendente monta o pedido já com o histórico dele
- O ERP fica fora do ar e o pedido é guardado como rascunho, com passagem para um humano
- O cliente pede uma pessoa e o atendente recebe a conversa com contexto e o carrinho

Onde essa feature será implantada
- No DeskcommCRM, sistema existente, como módulo opcional desligado por padrão, com código somente no fork da rede. Cada tenant do CRM representa uma unidade operacional e atende um conjunto de lojas. Exemplo: o tenant Campinas atende a loja CAS; o tenant Rio Preto atende as lojas RPA, RPV, RPR e RPI; o tenant do Call Center atende todas as lojas. Cada tenant tem as suas conexões, os seus agentes e a sua configuração. A loja é dado do módulo PDV dentro de cada tenant. O CRM não cruza tenants; o ERP é a camada comum.

Problemas priorizados
- Custo de atendimento concentrado em pessoas: 17 atendentes, cerca de 12 pedidos por atendente por dia e cerca de 204 pedidos por dia no total (prioridade alta, hipótese a confirmar)
- Software atual do call center de baixa qualidade (prioridade alta)
- Ausência de canais de chat e WhatsApp no call center atual (prioridade média)

---

### Objetivos e métricas

| Objetivo | Métrica | Meta (hipótese) |
| --- | --- | --- |
| Reduzir custo de atendimento | Pedidos digitais (WhatsApp, app-chat e app) concluídos pela IA sem humano. Telefone e balcão ficam fora do cálculo | 70% (valor definido quando a voz fazia parte; rever com os dados do piloto) |
| Vender mais | Pedidos por dia no total | +50% (cerca de 204 para 306) |
| Vender mais | Ticket médio | +10% |
| Vender mais | Carrinhos não finalizados recuperados pela IA | A definir com os dados do piloto |
| Padronizar a rede | Pedidos com divergência entre o preço cobrado e o preço do ERP | 0 |

---

### Escopo

Incluso
- Pedido por WhatsApp e app-chat, com a IA atendendo primeiro e o humano assumindo quando necessário
- Pedido por telefone e balcão, registrado manualmente pelo atendente no módulo PDV, com um assistente de IA que propõe ações ao atendente
- Eventos do app no funil, carrinho do cliente e recuperação do carrinho pela IA
- Integração com o ERP via MCP: consultar cardápio, preço, disponibilidade e entrega, e criar, consultar e cancelar pedido
- Pedido rascunho no CRM, com envio idempotente ao ERP
- Link de pagamento gerado pelo ERP e repassado ao cliente
- Aviso na Central para a passagem da IA para o humano
- Sugestão de itens e combos para elevar o ticket médio

Fora de escopo
- Emissão de nota fiscal
- Roteirização e controle de entrega
- Troca da infraestrutura de telefonia atual
- Atendimento de ligações pelo CRM: IA de voz, ponte de áudio e transferência de ligação (antigos FR-008 e FR-009). A ligação continua na telefonia atual, fora do CRM, sem transcrição nem gravação
- Hipótese: substituir o ERP, campanhas e disparo ativo de marketing em massa (a única mensagem ativa do escopo é a recuperação de carrinho do FR-012, só para quem já iniciou um carrinho), e pagamento processado dentro do CRM

---

### Requisitos funcionais

#### FR-001 Integração com o ERP via MCP
O CRM consulta e opera o ERP da rede por um servidor MCP, sempre informando a loja do pedido.

**Fluxo principal**
- A IA chama uma ferramenta de leitura (cardápio, preço, disponibilidade ou entrega) informando a loja e a identidade do cliente
- O ERP responde e a IA usa a resposta na conversa
- No envio, o pedido segue ao ERP com chave de idempotência

**Fluxos alternativos e exceções**
- O cliente pede em uma loja mas mora na área de outra: o ERP sinaliza e a IA ou o atendente orienta o cliente
- ERP fora do ar: o pedido vira rascunho (ver FR-002)

**Erros previstos**
- Loja inválida ou não informada
- Item indisponível
- Endereço fora da área de entrega
- Tempo esgotado na resposta do ERP

**Operações que o PDV (FR-010) exige do ERP, além das acima**
- Buscar cliente por telefone, nome ou CPF; cadastrar cliente; atualizar nome, CPF e data de nascimento
- Listar, criar, alterar e remover endereços do cliente e marcar o principal
- Consultar CEP
- Informar a loja que entrega em um endereço e a taxa de entrega
- Listar as lojas da rede

**Prioridade:** alta

---

#### FR-002 Pedido no CRM
O pedido é uma entidade do CRM, com estados, que é enviada ao ERP de forma idempotente e acompanha o link de pagamento.

**Fluxo principal**
- A IA ou o atendente monta o pedido rascunho com itens, endereço, loja e canal de origem
- O cliente confirma o resumo na conversa
- Um worker envia o pedido ao ERP em até 60 segundos e registra o resultado
- O CRM repassa ao cliente o link de pagamento gerado pelo ERP

**Fluxos alternativos e exceções**
- ERP fora do ar: o pedido permanece rascunho, o cliente é avisado e um humano recebe a passagem
- Cliente cancela antes da confirmação: o rascunho é descartado
- Cancelamento após o envio: segue pela ferramenta de cancelamento do ERP

**Erros previstos**
- Pedido duplicado por reenvio
- Recusa do pedido pelo ERP
- Divergência de preço entre CRM e ERP

**Prioridade:** alta

---

#### FR-003 Atendimento de pedido pela IA no WhatsApp
A IA conduz o cliente do primeiro contato até o pedido confirmado no WhatsApp da loja.

**Fluxo principal**
- O cliente escreve para o número da loja e a loja é definida pelo canal de entrada
- A IA consulta cardápio, preço e entrega no ERP
- A IA monta o pedido, repete o resumo e pede a confirmação
- O pedido segue o fluxo do FR-002

**Fluxos alternativos e exceções**
- O cliente pede uma pessoa ou o caso foge do escopo: passagem para humano (FR-004)
- Cliente em contato fora do horário humano: retorno agendado ou recado

**Erros previstos**
- Mensagem sem conteúdo útil (áudio ou foto sem tratamento)
- Item esgotado

**Prioridade:** alta

---

#### FR-004 Passagem da IA para o humano
Nos canais de texto (WhatsApp e app-chat), o humano assume com o contexto da conversa, e a passagem nunca deixa o cliente sem próximo passo.

**Fluxo principal**
- A IA identifica o gatilho (pedido do cliente, falha de ERP ou caso fora do escopo)
- O CRM avisa o atendente disponível pela Central
- O atendente recebe o resumo, os itens do pedido, o carrinho do cliente e o motivo (ver FR-013)
- O atendente conclui o atendimento e o registro fica no pedido

**Fluxos alternativos e exceções**
- Ninguém disponível (hoje o atendimento humano da piloto é das 18h às 23h): retorno agendado ou recado registrado
- Atendente devolve a conversa para a IA

**Erros previstos**
- Aviso não entregue
- Atendente sem acesso à conversa da loja (o atendente vê as conversas do seu tenant; o call center tem as suas próprias conexões)

**Prioridade:** alta

---

#### FR-005 Painel de medição das metas
Painel que mostra, por loja, os números que provam as metas do programa.

**Fluxo principal**
- O CRM calcula, por loja, o percentual de pedidos digitais concluídos pela IA, os pedidos por dia, o ticket médio, as divergências de preço e os carrinhos recuperados
- O gestor abre o painel e compara períodos

**Fluxos alternativos e exceções**
- Visão consolidada da rede: o CRM não cruza tenants, então a visão da rede sai do ERP ou de relatório externo (decisão pendente). Pedidos que o call center registra para uma loja de outro tenant ficam no tenant do call center

**Erros previstos**
- Dado incompleto de uma loja
- Pedido sem canal de origem registrado

**Prioridade:** alta

---

#### FR-006 Sugestão de itens e combos
A IA sugere bebida, sobremesa e combos durante o pedido, para elevar o ticket médio.

**Fluxo principal**
- A IA identifica itens complementares no cardápio da loja
- A IA faz a sugestão antes da confirmação
- O cliente aceita ou recusa e o resultado é registrado

**Fluxos alternativos e exceções**
- Cliente recusa: a IA não insiste

**Erros previstos**
- Sugestão de item indisponível

**Prioridade:** média

---

#### FR-007 Canal app-chat
O app de chat da rede passa a ser um canal de atendimento, com o mesmo fluxo de pedido.

**Fluxo principal**
- O cliente escreve pelo app
- O CRM recebe a mensagem por webhook assinado e identifica o cliente pelo identificador do app
- O fluxo segue como no WhatsApp
- O cliente também pode montar e finalizar o pedido dentro do app (ver FR-011)

**Fluxos alternativos e exceções**
- Cliente sem telefone: o ERP identifica o cliente por e-mail ou identificador do app

**Erros previstos**
- Assinatura inválida
- Falha na entrega da resposta ao app

**Prioridade:** média

---

#### FR-008 Atendimento por telefone com IA de voz
**Fora do escopo deste programa** (decisão de 2026-11-16). Não há IA de voz nem tronco SIP. A ligação é atendida pelo atendente na telefonia atual da rede, fora do CRM, e o pedido é registrado manualmente no módulo PDV (ver FR-010). O número FR-008 fica reservado para não renumerar os demais requisitos.

---

#### FR-009 Ponte de áudio para o humano assumir a ligação
**Fora do escopo deste programa** (decisão de 2026-11-16), junto com o FR-008. Não há ponte de áudio nem transferência de ligação. O número FR-009 fica reservado.

---

#### FR-010 Pedido manual no PDV (balcão e telefone)
O atendente registra no módulo PDV o pedido do cliente que está no balcão ou que ligou, usando o histórico do CRM, e envia ao ERP.

**Fluxo principal**
- No telefone, o atendente atende a ligação na telefonia atual, fora do CRM; no balcão, atende o cliente presencial
- O atendente identifica o cliente por telefone, nome ou CPF e vê o histórico e a última compra
- O atendente monta o pedido a partir do cardápio da loja, e o CRM grava a origem (telefone ou balcão)
- O pedido segue o fluxo do FR-002, e pagamento e nota ficam no caixa do ERP

**Fluxos alternativos e exceções**
- Cliente novo: cadastro com Nome e (telefone ou e-mail) obrigatórios; o endereço é obrigatório só em pedido de entrega
- Pedido de entrega: o ERP calcula a loja que entrega no endereço
- Recompra: sugestão do último pedido

**Erros previstos**
- ERP fora do ar no PDV
- Item indisponível
- CPF ou telefone já cadastrado em outra ficha
- CEP não encontrado (o atendente digita o endereço)

**Assistente do atendente:** o PDV inclui um assistente de IA que recebe a fala ou o texto do atendente e propõe ações sobre o pedido (identificar cliente, tipo, loja, endereço, itens). O PDV valida cada ação contra o ERP, e quem confirma o pedido é sempre o atendente. Detalhe no PRD filho, requisito FR-010.8.

**PRD detalhado:** [prd-fr-010-pdv-balcao-e-telefone.md](prd-fr-010-pdv-balcao-e-telefone.md)

**Telas:** casos de uso e prompts em `docs/interface/identificar-cliente` e `docs/interface/consultar-produto`.

**Prioridade:** média

---

#### FR-011 Eventos do app no funil e carrinho do cliente
O app da rede envia ao CRM os eventos do cliente, que ficam no funil, e o CRM mantém o carrinho atual de cada cliente.

**Fluxo principal**
- O app envia o evento (item adicionado, carrinho aberto, checkout iniciado, pedido finalizado) por webhook assinado, com o identificador do cliente e a loja
- O CRM identifica o cliente (como no FR-007), grava o evento na linha do tempo do funil e atualiza o carrinho
- O pedido finalizado no app encerra o carrinho como concluído. Hipótese: o app envia o pedido ao ERP pelo caminho que já usa, e o CRM recebe só o evento

**Fluxos alternativos e exceções**
- Cliente não identificado: o evento é guardado sem vínculo e ligado ao cliente quando ele se identificar (hipótese)
- Evento repetido ou fora de ordem: não duplica o registro

**Erros previstos**
- Assinatura inválida
- Evento sem loja ou sem cliente
- Item do carrinho que o ERP não reconhece mais

**Prioridade:** alta

---

#### FR-012 Recuperação de carrinho e pedidos não finalizados pela IA
A IA retoma carrinhos e conversas de pedido interrompidos e tenta fechar a venda.

**Fluxo principal**
- O CRM detecta o carrinho ou a conversa de pedido sem finalização depois de um tempo sem eventos (tempo configurável)
- A IA recupera o carrinho e o histórico da conversa e confere no ERP a disponibilidade e o preço atuais
- A IA contata o cliente pelo canal em que ele já conversa (WhatsApp ou app-chat), lembra o carrinho e envia o link do app para finalizar
- O resultado (recuperado, recusado ou sem resposta) fica registrado no funil

**Fluxos alternativos e exceções**
- Cliente em opt-out ou bloqueado: a IA não contata
- Fora da janela de envio do canal: a IA aguarda a próxima janela
- Item indisponível ou preço alterado: a IA informa e sugere alternativa, com o preço do ERP
- Cliente pede uma pessoa: passagem para humano (FR-004)
- Cliente não responde: a IA para após o limite de tentativas (a definir) e não insiste
- Cliente já finalizou por outro canal: a IA não contata

**Erros previstos**
- Carrinho desatualizado em relação ao ERP
- Envio da mensagem falha

**Prioridade:** alta

---

#### FR-013 Carrinho no inbox e fechamento do pedido pelo atendente
No transbordo, o atendente vê o carrinho do cliente no inbox e finaliza o pedido dentro da conversa.

**Fluxo principal**
- O atendente recebe a conversa pela passagem do FR-004
- O inbox mostra o carrinho do cliente: itens, endereço, loja e valores
- O atendente ajusta o pedido com o cliente e o finaliza na conversa
- O pedido segue o fluxo do FR-002

**Fluxos alternativos e exceções**
- Cliente sem carrinho: o atendente monta o pedido na conversa
- Preço ou item mudou: o atendente vê o valor atual do ERP
- Cliente já finalizou no app: o inbox mostra o pedido concluído

**Erros previstos**
- Carrinho não carrega
- ERP fora do ar: o pedido permanece rascunho (FR-002)

**Prioridade:** alta

---

### Requisitos não funcionais

Performance
- Resposta da IA ao cliente em até 10 segundos no p95 (hipótese)
- Envio do pedido ao ERP em no máximo 30 a 60 segundos após a confirmação, o que impede depender só de cron de 1 minuto

Disponibilidade
- 99,9% de disponibilidade, 24 horas por dia, para o CRM (hipótese). ERP, app da rede e provedor de IA ficam fora dessa garantia

Segurança e autorização
- Hipótese: autenticação, permissão por papel, chave do ERP guardada cifrada, identidade do cliente fixada pelo CRM e auditoria de toda alteração de pedido

Observabilidade
- Rastro completo por pedido: ferramentas chamadas, dados enviados, resposta do ERP, motivo de passagem para humano e custo de IA

Confiabilidade e integridade de dados
- Envio idempotente ao ERP, sem duplicar pedido
- Com o ERP fora do ar, o pedido vira rascunho e a passagem é para um humano

Compatibilidade e portabilidade
- Hipótese: integração por MCP padrão, módulo opcional desligado por padrão e código mantido no fork da rede

Compliance
- Anonimização da LGPD e retenção configurável para conversas, carrinhos e eventos do app. Não há gravação nem transcrição de ligação, porque a telefonia fica fora do CRM

Acessibilidade no frontend consumidor
- Não discutida na entrevista. Hipótese: a tela de atendimento e o app-chat seguem as práticas de acessibilidade do CRM

---

### Arquitetura e abordagem

Abordagem
- Módulo opcional dentro do DeskcommCRM, desligado por padrão, com código somente no fork da rede. Um tenant do CRM por unidade operacional (cada um atende um conjunto de lojas) e um tenant do Call Center que atende todas; a loja é dado do módulo em cada tenant. A IA consulta o ERP por leitura via MCP, grava um pedido rascunho no CRM e um worker rápido o envia ao ERP com idempotência. Comunicação síncrona para consultar o ERP durante a conversa e assíncrona para o envio do pedido e o aviso ao humano

Componentes
- Agentes de IA de atendimento (texto)
- Receptor de eventos do app e carrinho do cliente
- Rotina de recuperação de carrinho pela IA
- Módulo PDV (balcão e telefone)
- Cliente MCP do CRM chamando o MCP do ERP
- Entidade pedido (rascunho, confirmado, enviado, cancelado)
- Worker de envio ao ERP, com consulta à fila a cada poucos segundos ou acionado por evento
- Central de avisos e Radar
- Painel de metas

Integrações
- MCP do ERP, construído pela equipe do projeto, junto com a API do ERP
- WhatsApp, um número por loja
- App-chat e eventos do app, por webhook assinado

### Decisões e trade-offs

#### Decisão: Pedido rascunho no CRM, enviado ao ERP por worker idempotente, em vez de a IA escrever direto no ERP
- **Justificativa:** o CRM recusa escrita remota dentro da conversa, e o worker evita efeito externo no meio do diálogo
- **Trade-off:** exige criar a entidade pedido e o worker, com mais código

#### Decisão: ERP como fonte única de preço, estoque e taxa
- **Justificativa:** evita duplicar dados e divergência de preço entre canais
- **Trade-off:** o atendimento depende da disponibilidade do ERP

#### Decisão: Código somente no fork da rede
- **Justificativa:** autonomia e velocidade
- **Trade-off:** conflito de migration a cada merge do upstream e manutenção própria

#### Decisão: Telefone atendido por humano, fora do CRM, com registro manual no PDV
- **Justificativa:** dispensa tronco SIP, IA de voz e ponte de áudio, e reaproveita o PDV do balcão
- **Trade-off:** as ligações não entram na meta de pedidos concluídos pela IA e continuam exigindo atendentes

#### Decisão: O cliente finaliza o pedido dentro do app, e a IA recupera o carrinho a partir dos eventos
- **Justificativa:** a venda se conclui onde o cliente já está, e o funil ganha o comportamento real do cliente
- **Trade-off:** depende de o app enviar eventos confiáveis, e a recuperação é mensagem ativa, que exige opt-out, janela de envio e limite de tentativas

#### Decisão: A loja do pedido é definida pelo número ou canal de entrada
- **Justificativa:** cardápio e preço mudam por loja, e cada loja tem o seu canal. No PDV, em pedido de entrega, o ERP calcula a loja pelo endereço
- **Trade-off:** exige um número de WhatsApp por loja

#### Decisão: O assistente de IA do atendente entra no módulo PDV
- **Justificativa:** acelera o registro do pedido de telefone e de balcão, que são a maior parte do trabalho humano que sobra
- **Trade-off:** custo de IA e risco de interpretação errada; por isso o assistente só propõe ações, o PDV valida contra o ERP e o atendente confirma

#### Decisão: Tenants por unidade operacional, cada um com as lojas que atende, mais o tenant do Call Center (2026-11-16)
- **Contexto:** a hipótese inicial era um tenant por loja; depois se avaliou uma organização única. A configuração real da rede é por unidade operacional: Campinas atende a loja CAS, Rio Preto atende RPA, RPV, RPR e RPI, e o Call Center atende todas as lojas
- **Decisão:** cada tenant tem as suas conexões, agentes e configuração, e uma lista das lojas que atende (a loja é dado do módulo PDV). Todos os operadores do tenant atuam em todas as lojas do tenant (o balcão de Rio Preto vê RPA, RPV, RPR e RPI); não há permissão por loja dentro do tenant. O CRM não cruza tenants, e o ERP é a camada comum (cadastro de cliente, histórico, pedidos). A lista de lojas do tenant é mantida na aba Lojas da configuração do tenant
- **Justificativa:** respeita o isolamento por tenant que o CRM já tem, não exige acesso entre organizações e deixa cada unidade com as suas conexões e agentes
- **Trade-off:** o pedido que o call center registra para uma loja de outro tenant fica no tenant do call center, e o tenant da loja não o vê no CRM; o painel por loja e a visão da rede precisam vir do ERP ou de relatório. O mesmo cliente tem um contato espelho em cada tenant que o atendeu
---

### Dependências

#### Técnica: API do ERP e MCP
O ERP não tem API. O dono do projeto constrói a API e o MCP, e o ERP é ajustável ao que o CRM precisa (levantamento em `contrato-mcp-erp.md`), com cardápio e preço por loja, criação de pedido idempotente, consulta, cancelamento e geração do link de pagamento. Nenhum canal funciona sem isso. O PDV soma as operações de cliente, endereço, CEP, loja e taxa (ver FR-001).

#### Técnica: Uma conexão de WhatsApp por loja
Cada loja precisa do seu número de WhatsApp.

#### Técnica: Eventos e finalização de pedido no app
O app da rede precisa enviar ao CRM os eventos do cliente (carrinho, checkout, pedido finalizado) por webhook assinado e finalizar o pedido dentro dele. O contrato dos eventos ainda não existe e precisa ser definido com a equipe do app.

#### Externa: Orçamento do provedor de IA
Hipótese: orçamento dimensionado para cerca de 300 pedidos por dia.

---

### Riscos e mitigação

#### API do ERP atrasa ou não fica pronta a tempo
- **Probabilidade:** alta
- **Impacto:** nenhum canal consulta o ERP ou cria pedido
- **Mitigação:**
  - Construir a API primeiro, em fatias pequenas
  - Priorizar consulta de cardápio e criação de pedido
- **Plano de contingência:** operar só com consulta de cardápio e pedido manual

#### O app não envia eventos confiáveis do carrinho
- **Probabilidade:** média
- **Impacto:** a IA não recupera carrinhos e o funil fica incompleto
- **Mitigação:**
  - Definir o contrato dos eventos cedo, com a equipe do app
  - Eventos idempotentes e assinados
- **Plano de contingência:** recuperar só a partir das conversas, sem carrinho

#### A recuperação de carrinho incomoda o cliente ou derruba o número de WhatsApp
- **Probabilidade:** média
- **Impacto:** reclamação, bloqueio do número, queda de confiança
- **Mitigação:**
  - Contatar só quem já iniciou um carrinho ou conversou
  - Respeitar opt-out, janela de envio e limite de tentativas
- **Plano de contingência:** desligar a recuperação por loja

#### A meta de +50% de pedidos não vem do atendimento
- **Probabilidade:** alta
- **Impacto:** meta não cumprida
- **Mitigação:**
  - Separar a meta de atendimento da de demanda
  - Medir o efeito dos novos canais isoladamente
- **Plano de contingência:** rever a meta com os dados da piloto

#### Dependências externas derrubam a disponibilidade abaixo de 99,9%
- **Probabilidade:** média
- **Impacto:** pedidos perdidos
- **Mitigação:**
  - Pedido rascunho com fila
  - Monitorar ERP, app e provedor de IA
- **Plano de contingência:** passagem para humano

#### Falta de humano fora das 18h às 23h
- **Probabilidade:** alta
- **Impacto:** cliente sem resposta quando a IA não resolve
- **Mitigação:**
  - Retorno agendado
  - Aviso na Central
- **Plano de contingência:** a IA registra o recado

#### Pedido errado ou duplicado pela IA
- **Probabilidade:** média
- **Impacto:** prejuízo e queda de confiança
- **Mitigação:**
  - Confirmação do resumo pelo cliente
  - Idempotência no envio ao ERP
- **Plano de contingência:** cancelamento rápido pelo humano

#### Pedido de uma loja registrado em outro tenant
- **Probabilidade:** alta
- **Impacto:** o tenant da loja não vê no CRM o pedido que o call center registrou para ela; o painel por loja (FR-005) fica incompleto
- **Mitigação:**
  - Gravar no ERP a origem do pedido e o tenant de origem, e tirar os números por loja do ERP
  - Sem cópia do pedido no tenant da loja (decidido em 2026-11-16): a visão por loja sai do ERP
- **Plano de contingência:** relatório consolidado externo

#### O mesmo cliente em vários tenants
- **Probabilidade:** média
- **Impacto:** contato duplicado, histórico dividido e pedido de LGPD que precisa ser cumprido em cada tenant
- **Mitigação:** o ERP como cadastro mestre, com o identificador do ERP guardado em cada contato espelho
- **Plano de contingência:** rotina de conferência entre tenants
---

### Critérios de aceitação
Checklist objetivo que define se a feature está pronta.

- A API do ERP consulta cardápio, preço, disponibilidade e entrega por loja e cria, consulta e cancela pedido. Reenviar o mesmo pedido com a mesma chave não cria um segundo pedido
- Um pedido confirmado pelo cliente no WhatsApp chega ao ERP em até 60 segundos
- A IA responde ao cliente em até 10 segundos no p95
- Com o ERP fora do ar, o pedido fica como rascunho, o cliente é avisado e um humano recebe a passagem
- Toda passagem para humano mostra ao atendente o resumo da conversa, os itens do pedido e o motivo
- Todo pedido guarda o canal de origem, a loja e o rastro completo: ferramentas chamadas, dados enviados, resposta do ERP, motivo de passagem e custo de IA
- Os eventos do app aparecem na linha do tempo do funil do cliente, e o evento repetido não duplica o registro
- A IA recupera o carrinho de um cliente que não finalizou e o contata pelo canal em que ele já conversa; cliente em opt-out ou fora da janela nunca é contatado
- No transbordo, o atendente vê o carrinho do cliente no inbox e finaliza o pedido na conversa
- O atendente registra o pedido de telefone e de balcão no PDV, com a origem gravada, e ele segue ao ERP
- Um painel mostra, por loja, o percentual de pedidos concluídos pela IA, os pedidos por dia e o ticket médio
- Nenhum pedido registra preço diferente do informado pelo ERP
- Um operador só registra pedido para as lojas do seu tenant; o tenant do Call Center atende todas as lojas; a recusa vale no servidor, mesmo que a requisição traga outra loja
- A meta de 70% de pedidos digitais concluídos pela IA é validada com dados reais da loja piloto antes de virar compromisso para a rede
- Cada requisito de FR-001 a FR-013, exceto FR-008 e FR-009 (fora de escopo), tem um PRD filho que referencia este

---

### Testes e validação

Tipos de teste obrigatórios
- Testes unitários para as regras de pedido e idempotência
- Testes de integração do contrato com o ERP
- Testes de segurança e de isolamento entre lojas
- Testes de carga com o volume de pico, cerca de 300 pedidos por dia concentrados à noite
- QA manual guiado por roteiro, com cenários executados por uma pessoa no sistema real

Estratégia de validação
- Primeiro o QA guiado por roteiro e os testes automatizados nos pontos críticos. Depois um piloto supervisionado na loja piloto, em que a IA monta o pedido e um humano confirma cada um, até a taxa de erro cair. Só então a IA atende sozinha
