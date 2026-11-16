# Resumo do debate — call center e ponto de venda para a Bella Capri

> **Estado:** brainstorming. Nada foi implementado, commitado ou publicado.
> **Como ler:** "lido no código" significa que foi conferido por leitura de arquivos; nenhuma ligação, agente ou fluxo foi executado. Os tamanhos são estimativas.

## Ideia central

Transformar o DeskcommCRM num call center com ponto de venda para a rede Bella Capri (pizzarias). A IA atende primeiro, o humano assume quando necessário, e o ERP da rede é acessado por um MCP que será escrito por quem conduz o projeto. O cliente pode pedir por **telefone, WhatsApp e balcão**, e o app-chat entraria depois.

## O que existe hoje (lido no código)

- **Telefonia SIP:** módulo opcional, desligado por padrão, com tronco SIP, Asterisk e um worker de voz. Quem atende é sempre a IA. Os campos `routing_mode` e `fallback_user_id` são lidos do banco, mas nenhum código os usa. Não há ponte de áudio para humano, nem transferência.
- **Agente de voz:** tem só duas ferramentas (`encerrar_chamada` e `consultar_conhecimento`). Não consulta o ERP, não avisa a equipe e não agenda retorno. A ligação cria o contato, o lead e a transcrição (`voice_calls.transcript`), mas ninguém é avisado na hora.
- **Inbox:** `conversations.channel` aceita só WhatsApp, Instagram e Facebook. Uma conversa "de telefone" não cabe sem migration grande. O viável é gravar a transcrição como nota interna (`conversation_notes`) na conversa de WhatsApp do contato, mais um aviso na Central.
- **MCP externo:** o agente de WhatsApp já pode usar ferramentas de um MCP externo, com a opção `mcp_externo_no_atendimento` ligada no agente. O CRM injeta a identidade do contato nos cabeçalhos `X-Deskcomm-*`. Mas ferramentas de **escrita** remota são recusadas durante a conversa, então `criar_pedido` hoje seria bloqueado. O agente de voz não carrega o MCP externo.
- **Produtos:** a API de catálogo (criar, atualizar, excluir, importar planilha) só aceita sessão de navegador. Token `dsk_` e MCP de escrita de produtos não existem. Só há `crm_search_products`.
- **Radar:** só lista negócios abertos que esfriaram além da janela do estágio (24h por padrão). Um contato recém-entrado não aparece por essa regra.

## Decisões e recomendações

- **Fluxo hoje (só prompt e configuração):** a IA coleta o essencial, diz com honestidade que não transfere agora, promete só o que o CRM cumpre e encerra. A equipe retoma por CRM › Chamadas, funil e Radar.
- **Arquitetura do pedido:** um pedido só, com a `origem` (telefone, WhatsApp, balcão, app-chat) como atributo. O ERP continua dono de preço, estoque, taxa e fiscal. O CRM monta o carrinho e pergunta ao ERP.
- **Contrato do MCP do ERP:** ferramentas de **leitura** (`consultar_cardapio`, `consultar_disponibilidade`, `validar_entrega`, `calcular_total`, `consultar_pedido`) e de **escrita** (`criar_pedido`, `cancelar_pedido`), com `readOnlyHint` correto e chave de idempotência.
- **Quem cria o pedido:** recomendado o **pedido rascunho no CRM**, gravado pela IA (escrita interna, dentro do escopo atual). Depois um worker ou um humano o envia ao ERP. A escrita direta pela IA exige mudar o escopo do turno no núcleo e fica para depois.
- **Balcão:** tratar como modo de atendimento rápido dentro do CRM, e não como PDV completo, porque a loja provavelmente já tem caixa e fiscal no ERP.
- **App-chat:** entra no mesmo esquema, mas só existe como plano (`plano-canal-app-chat.md`). Exige ajustar o identificador do cliente (sem telefone) e pode ser o melhor lugar para confirmar o pedido.
- **Ordem sugerida:**
  1. Contrato do MCP e WhatsApp com a loja piloto.
  2. Pedido como entidade, com idempotência.
  3. Telefone: ferramentas do ERP na voz, aviso na Central, transcrição como nota.
  4. Ponte de áudio para humano.
  5. Balcão.

## Tamanhos estimados

- Ponte de áudio para humano: 2 a 3 semanas pelo caminho recomendado (áudio por AudioSocket). A prova real em tronco SIP é a parte mais cara.
- Transcrição como nota no inbox: pequeno a médio, uns poucos dias.
- PDV completo: grande. O ganho vem de começar estreito.

## Pendências

1. Quem aperta o botão que envia o pedido ao ERP: a IA depois do "pode confirmar?" do cliente, ou um humano.
2. Pagamento: na entrega, no balcão ou online.
3. A loja tem caixa e nota no ERP que continua sendo usado no balcão?
4. Preço e cardápio mudam por loja? (Briefing, itens 3.1 e 3.2.)
5. O app de chat é o mesmo do cardápio digital?
6. Para telefone: se ninguém atende, a IA assume ou o recado vai para caixa postal? Fora do horário humano, o retorno é agendado ou segue pelo WhatsApp?

## Documentos relacionados

- `briefing-bellacapri.md` — perguntas de implantação (blocos 3 a 6 alimentam os guardrails das ferramentas do MCP).
- `plano-canal-app-chat.md` — plano do canal app-chat.
- `pacote-bellacapri-rpa.md` — decisões já tomadas da loja piloto.
