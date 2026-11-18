# ADR-009: Construir o resto do módulo contra um mock do ERP e derivar o contrato dele

Status: Aceito
Data: 2026-11-18
Aceito em: 2026-11-18, pelo dono do projeto
Altera: a decisão do plano de migração de 2026-11-16, "o módulo nasce consultando o ERP de verdade; não haverá ERP de mentira", e a não-meta do PRD das fases 1 e 2 ("um servidor de ERP de teste dentro do repositório"). Não altera o ADR-004: o transporte segue sendo o servidor MCP externo da organização.
Origem da decisão: o dono do projeto, ao planejar as fases 3 a 7: "prefiro seguir com a parte do CRM primeiro e ter tudo definido (telas, fluxos, etc) para depois resolvermos a parte do ERP; podemos criar um mock".

## 1. Contexto

- As fases 3 a 7 (cardápio e carrinho, pedido, envio, histórico, assistente) dependem das ferramentas E2 a E7 do ERP, e cada fatia só pode começar depois de entregue e homologada. Era a fila do ERP que ditava o ritmo do CRM.
- O E1 mostrou o custo de escrever o contrato antes de ver o ERP: o ERP real não tinha endereço principal, devolvia `loja_entrega` sempre nula e retornou 17 clientes por telefone, contra no máximo 1 no contrato.
- O CRM já fala com o ERP por um servidor MCP externo cadastrado por organização, com `fetch` injetável nos testes.
- O CRM recusa HTTP e hosts privados em produção, e o app local roda nesse modo.

## 2. Decisão

Vamos **definir e construir o restante do módulo contra um mock do ERP, um servidor MCP que fala o mesmo protocolo**, e só depois escrever os handoffs do ERP, **derivando o contrato do que o mock faz**.

Regras:

- O mock é um servidor MCP (Streamable HTTP, `Authorization: Bearer`) no repositório, **fora do código do produto**: ninguém em `app/`, `lib/`, `components/` ou `hooks/` o importa. Cobre as ferramentas E2 a E7 com dados fictícios e um comando para repor o estado inicial.
- O mock injeta falhas à escolha: lentidão, 401, 429 `limite_excedido`, `erro_interno` e resposta de erro `isError`.
- Os testes automáticos usam o mesmo mock **sem rede**, pelo `fetch` injetável. Na stack local ele é cadastrado como o servidor do ERP de uma organização de teste, com nome HTTPS público no túnel do dono do projeto.
- O CRM **não tem modo mock**: o código que fala com o ERP é o mesmo para o mock e para o real. Trocar é mudar o endereço e a chave do servidor da organização.
- O contrato v0.4 é escrito a partir do mock; o handoff de cada fatia diz "faça igual ao mock" e traz os testes do mock como critério de aceite.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | ERP real primeiro, uma fatia de cada vez (plano de 16/11) | O contrato nasce do ERP real | O CRM espera a fila do ERP; telas e fluxos só são definidos fatia a fatia | Rejeitada |
| 2 | Mock só dentro dos testes, sem servidor | Mais simples, sem túnel | Não dá para ver as telas funcionando na stack local nem exercitar o transporte real | Rejeitada |
| 3 | **Servidor MCP de mock mais testes sem rede (escolhida)** | Telas e fluxos completos já; o transporte real é exercitado; o ERP recebe um contrato executável | Um servidor a manter; risco de o mock divergir do ERP real | Aceita |
| 4 | Modo mock dentro do CRM, ligado por configuração | Sem servidor extra | Código de mentira no produto, ao lado do real, em uma instalação que vai para produção | Rejeitada |

## 4. Consequências

- **Positivas:** o CRM não espera o ERP; toda tela e fluxo pode ser definido, construído e provado agora; o ERP recebe um contrato que já funciona e testes que o validam.
- **Negativas:** o mock é uma segunda implementação do contrato, e o ERP real pode divergir dele. É o mesmo risco do E1, só que agora detectável por teste.
- **Obrigações:** uma cerca que reprova import do mock pelo código do produto; a homologação contra o ERP real passa a ser a **última** etapa de cada fatia, com a mesma suíte do mock rodando contra o ERP; o ADR-004 segue valendo; o que o ERP real devolver de diferente vira divergência registrada, como no E1.
