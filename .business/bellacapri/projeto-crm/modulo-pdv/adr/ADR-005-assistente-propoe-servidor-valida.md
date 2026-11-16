# ADR-005: O assistente propõe ações, o servidor valida e aplica

Status: Aceito
Data: 2026-11-16
Aceito em: 2026-11-16, pelo dono do projeto, sem alterações no texto
Origem da decisão: a inclusão do assistente no escopo foi decidida pelo dono do projeto. O desenho (ações propostas, sem acesso do modelo ao ERP) é proposta do Design Doc.

## 1. Contexto

- O protótipo do PDV tem um chat em que o atendente fala livremente (inclusive por voz) e o assistente preenche cliente, tipo, loja, endereço, itens e pagamento, listando o que falta. Hoje é um parser de regras simulado, sem IA de verdade.
- O dono do projeto decidiu que o assistente fica **dentro** do módulo PDV.
- Pelo que foi lido no CRM:
  - o runtime de atendimento por turno de contato limita as escritas ao contato da conversa e recusa o que não está numa lista fechada (`escrita_sem_escopo_do_turno`); uma ferramenta de pedido seria recusada, e mudar isso é alteração de núcleo;
  - existe um precedente de IA que conversa com a equipe, "Conversar com o caso", em `lib/agent-engine/`, sem ferramentas ("a IA aqui lê e não age"), com dados do cliente em bloco cercado, só o primeiro nome do contato e orçamento sem isenção.
- Os dados que chegam ao prompt incluem texto livre de terceiros (nome do cliente, observações, nomes de produto), que pode conter instrução maliciosa.
- O cardápio do ERP chega já precificado e calculado; o CRM nunca calcula preço.

## 2. Decisão

Vamos implementar o assistente como um **ponto de IA que devolve ações propostas em formato fechado**, que o **servidor valida contra o ERP e aplica**, sem dar ao modelo acesso ao ERP e sem permitir que ele confirme, envie ou cancele o pedido.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | Usar o runtime de atendimento por turno, com ferramentas do ERP | Reaproveita o motor de agentes | Escritas limitadas ao contato do turno; o modelo teria acesso ao ERP; exige mudar o núcleo | Rejeitada |
| 2 | Ponto de IA com ferramentas de leitura do ERP (o modelo consulta cardápio e clientes) | O modelo resolve ambiguidades sozinho | O modelo passa a falar com o ERP; mais chamadas, mais custo e mais superfície de ataque | Rejeitada |
| 3 | **Ponto de IA que propõe ações; o servidor valida e aplica** | O modelo nunca toca o ERP; a validação é determinística; segue o precedente do CRM | O cardápio da loja precisa entrar no prompt; o servidor executa as buscas que o modelo pede | **Escolhida** |

## 4. Consequências

**Positivas**
- Menor superfície de ataque: um texto malicioso só consegue propor ações de uma lista fechada, e cada uma passa pela mesma validação do modo manual.
- O assistente indisponível ou sem orçamento não impede o PDV: o modo manual continua.
- Rastro claro: cada item guarda se entrou manualmente ou pelo assistente.

**Negativas e trade-offs**
- **Custo de IA** proporcional ao uso dos atendentes; o ponto não é isento de orçamento.
- **Cardápio no prompt:** exige buscar e guardar em cache o cardápio de cada loja.
- **Risco residual de interpretação errada** (sabor, tamanho, quantidade): mitigado por destaque do que mudou, resumo antes de confirmar e validação contra o ERP, mas não eliminado.

**Obrigações criadas**
- Esquema fechado das ações (Zod) e lista do que o modelo **não** pode propor (confirmar, enviar, cancelar).
- Dados do cliente em bloco cercado, só o primeiro nome e o necessário; CPF, telefone e e-mail não vão ao modelo.
- Orçamento de IA com teto próprio e medição por atendente.
- Avaliação com frases reais dos atendentes antes do piloto.
- Verificar como se registra um ponto de IA novo no CRM e se o orçamento exige ajuste (não conferido no código).
