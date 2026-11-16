# Casos de uso — Consulta de produtos no PDV

Escopo: **consultar produtos** em um PDV e adicioná-los ao carrinho da venda. Fechamento
da venda, pagamento, detalhes do produto, cadastro e estoque ficam fora deste documento. Os dados vêm do ERP via MCP; a API do ERP decide
quais produtos exibir. O que ainda não foi definido está marcado como `[A DEFINIR]`.

## UC01 — Buscar produto

**Atores**
- Primário: Atendente
- Secundário: ERP (acessado via MCP)

**Objetivo**
Permitir que o atendente encontre produtos digitando qualquer termo (nome, código,
ingrediente etc.) e veja os resultados em cards com foto, nome, descrição e preço.

**Pré-condições**
- Atendente autenticado no PDV.
- PDV com acesso ao ERP via MCP.

**Pós-condições**
- Cards dos produtos retornados pelo ERP exibidos, ou aviso de que nada foi encontrado.
- Nenhum dado de produto é alterado.

**Fluxo principal**
1. O Atendente abre a consulta de produtos.
2. O Atendente digita um termo de busca livre (nome, código, ingrediente ou outro dado do produto).
3. O sistema envia o termo ao ERP via MCP.
4. O sistema exibe, em cards paginados, todos os produtos que o ERP retornar. Cada card mostra foto, nome, descrição e preço.
5. O Atendente identifica o produto procurado.

**Fluxos alternativos e de exceção**
- 2a. Termo vazio: o sistema não pesquisa e orienta o atendente a digitar algo.
- 4a. O ERP não retorna nenhum produto: o sistema informa e mantém o termo para ajuste.
- 4b. Resultados em mais de uma página: o Atendente navega entre as páginas.
- 4c. Produto sem foto: o card exibe um marcador de imagem no lugar da foto.
- 3a. ERP indisponível ou erro na consulta: o sistema informa a falha e permite tentar de novo.
- 5a. O Atendente quer adicionar o produto à venda: segue UC02.

## UC02 — Adicionar produto ao carrinho

**Atores**
- Primário: Atendente

**Objetivo**
Permitir que o atendente coloque um produto encontrado na consulta no carrinho da venda,
informando a quantidade, sem precisar buscá-lo de novo.

**Pré-condições**
- Produto exibido nos resultados da busca (UC01).
- Não é preciso ter uma venda aberta antes.

**Pós-condições**
- Produto incluído no carrinho com a quantidade informada.

**Fluxo principal**
1. O Atendente aciona "Adicionar ao carrinho" no card do produto.
2. O Atendente informa a quantidade.
3. O sistema inclui o produto no carrinho e confirma a inclusão.
4. O Atendente escolhe continuar consultando (volta ao UC01) ou fechar a venda (fluxo fora deste escopo).

**Fluxos alternativos e de exceção**
- 2a. Quantidade vazia ou zero: o sistema não adiciona e pede uma quantidade válida.
- 2b. Quantidade com casas decimais: o sistema não aceita; a quantidade é sempre um número inteiro.
- 3a. Produto que já está no carrinho: o sistema soma a quantidade informada à que já existe na linha do produto.
- 3b. Falha ao incluir o produto no carrinho: o sistema informa e mantém o atendente na consulta.

## Relacionamentos

- UC02 `<<extend>>` UC01 — adicionar ao carrinho é uma ação opcional a partir do card do produto.
- Fechar a venda é o destino possível depois do UC02, mas fica fora deste escopo (não é um caso de uso aqui).

## Diagrama

Ver [diagrama-casos-de-uso.mmd](diagrama-casos-de-uso.mmd).

## Decisões registradas

- Ator: Atendente. Consulta exige login.
- Origem dos dados: ERP via MCP.
- Busca livre por qualquer dado do produto (nome, código, ingrediente…).
- Sem leitor de código de barras.
- Resultados em cards (foto, nome, descrição, preço), com paginação.
- Exibe tudo o que a API retornar (regra de exibição é do ERP).
- Sem preços diferenciados.
- Detalhes do produto: fora do escopo.
- Adicionar ao carrinho não exige venda aberta; o atendente informa a quantidade (inteira).
- Produto repetido no carrinho: soma à quantidade existente.
- Depois de adicionar, o atendente pode continuar consultando ou fechar a venda.

## Pendências `[A DEFINIR]`

Nenhuma.
