# ADR-004: Camada única para o ERP, começando por MCP

Status: Proposto, **condicionado à prova 0.4** (ainda não executada)
Data: 2026-11-16
Origem da decisão: o MCP como mecanismo do ERP é decisão do PRD pai. A camada única e a condição são proposta do Design Doc.

## 1. Contexto

- O PRD pai diz que o CRM consulta e opera o ERP por um servidor MCP. O dono do projeto constrói tanto a API quanto o MCP do ERP, que ainda não existem, e a homologação será criada em paralelo.
- A IA de conversa (WhatsApp, app-chat) já usa servidor MCP externo por um mecanismo existente no CRM, com identidade do contato nos cabeçalhos e leitura e escrita declaradas.
- O PDV e o worker de envio são o **servidor do CRM** falando com o ERP, sem modelo no meio. Para eles, MCP e API são equivalentes funcionalmente.
- O que foi lido no CRM (`lib/mcp/servidor-externo/` e `docs/features/servidor-mcp-externo.md`): o registro é **por organização (tenant)**, com **um** servidor por organização (endereço em `settings`, chave Bearer cifrada em colunas próprias), gravado só pelo dono da instalação; o transporte é **Streamable HTTP**, pelo SDK oficial, com um handshake novo a cada chamada (sem reuso de sessão); o tempo limite padrão é de 15 segundos e **pode ser definido por chamada**; as funções de chamada (`chamarFerramentaRemota`, `listarFerramentasDoServidor`) recebem o servidor e a ferramenta e **não dependem de um turno de conversa**; a saída passa por proteção anti-SSRF que **exige HTTPS em produção e recusa hosts privados** (localhost, 10., 172.16 a 31., 192.168., 169.254., IPv6 literal e nomes que resolvam para esses endereços); um erro da ferramenta (`isError`) vira exceção com o texto do servidor. **Não foi verificado por execução** o comportamento fora de um turno, nem a latência real.
- Metas: busca de cliente e produto em até 3 segundos no p95, preço do item em até 1 segundo no p95, envio do pedido em até 60 segundos.

## 2. Decisão

Vamos acessar o ERP por uma **camada única `lib/pdv/erp`**, com funções tipadas por ferramenta do contrato e o transporte escondido, **começando por MCP para a IA e para o PDV**, e só mudaremos o PDV e o worker para a API do ERP se a prova 0.4 reprovar.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | **MCP em tudo, atrás de uma camada única** | Um contrato, uma credencial, uma integração para testar; coerente com o PRD | O cliente MCP do CRM foi lido só no uso pelo agente; latência e timeout por provar | **Escolhida, sujeita à prova 0.4** |
| 2 | MCP só para a IA; API do ERP para o PDV e o worker | Chamada mais direta e tipada | Duas superfícies para manter iguais, no ERP e no CRM | Plano B, se a prova 0.4 reprovar |
| 3 | Só API do ERP, sem MCP | Uma superfície só | A IA de conversa precisa de MCP no CRM; contraria o PRD pai | Rejeitada |

## 4. Consequências

**Positivas**
- Trocar de transporte custa pouco: só muda o interior da camada.
- Os testes unitários e de contrato usam amostras gravadas das respostas reais, sem depender do ERP no ar.

**Negativas e trade-offs**
- A decisão fica **em aberto** até a prova 0.4. Se ela reprovar, este ADR é substituído por outro.
- O registro é por organização: o dono da instalação cadastra o servidor do ERP em **cada tenant** (mesmo endereço, **chave própria**), três cadastros no começo (Campinas, Rio Preto, Call Center) e um a cada tenant novo. O ERP identifica o tenant pela chave.
- Um handshake novo a cada chamada soma um round-trip ao custo de cada leitura, e o próprio código deixa a otimização para depois de medir.

**Obrigações criadas**
- Executar a prova 0.4: chamar o cliente MCP de uma rota e de um worker, medir a latência (incluindo o handshake por chamada) e confirmar o tempo limite adequado ao `criar_pedido`, que se define por chamada.
- Confirmar, no ERP, que cada chave de tenant é reconhecida e identifica o tenant de origem em toda ferramenta.
- Publicar o ERP em um endereço **HTTPS público** (sem usuário, senha, querystring nem fragmento): o CRM recusa hosts privados e HTTP em produção. Para a homologação, que roda na rede local em HTTP, a decisão do dono do projeto (2026-11-16) é um **túnel HTTPS**; uma exceção controlada no CRM, que é mudança de núcleo, fica como plano B.
- Definir tempos limite por ferramenta, e erros tipados e estáveis.
