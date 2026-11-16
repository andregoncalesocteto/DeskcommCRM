Casos de uso: UC01, UC02

# Context
Tela de consulta de produtos do PDV, usada pelo atendente (já logado) durante o
atendimento. Ele busca um produto por qualquer termo (nome, código, ingrediente), vê os
resultados em cards e adiciona o produto ao carrinho informando a quantidade. Depois pode
continuar consultando ou fechar a venda.
Siga o estilo definido no Knowledge do projeto.

# Task
Layout (desktop / tela de PDV na horizontal):
- "Cabeçalho": faixa no topo com o título "Consulta de produtos" à esquerda e o nome do atendente logado à direita ("Atendente: Marina Souza").
- "Barra de busca": logo abaixo do cabeçalho, ocupando a largura da área de resultados.
- "Resultados": área principal à esquerda, com a grade de cards e a paginação embaixo.
- "Carrinho": painel fixo à direita, sempre visível, com os itens adicionados e o botão de fechar a venda.
- "Modal de quantidade": abre sobre a tela ao adicionar um produto.

Componentes:
- Em "Barra de busca": campo de texto com placeholder "Busque por nome, código ou ingrediente" e botão "Buscar". Enter no campo também busca.
- Em "Resultados":
  - Linha acima da grade: "12 produtos encontrados para "frango"" (contagem e termo atuais).
  - Grade de cards de produto. Cada card mostra: foto do produto, nome, descrição (no máximo 3 linhas, cortada com "…"), preço em reais (ex.: "R$ 18,90") e o botão "Adicionar ao carrinho".
  - Paginação: botões "Anterior" e "Próxima" e o indicador "Página 1 de 3". "Anterior" desabilitado na primeira página e "Próxima" na última.
- Em "Modal de quantidade":
  - Título com o nome do produto e o preço unitário.
  - Campo "Quantidade" só com números inteiros, começando em 1, com botões "−" e "+" ao lado ("−" não desce abaixo de 1).
  - Botões "Cancelar" e "Adicionar".
- Em "Carrinho":
  - Título "Carrinho" com o número de itens (ex.: "Carrinho (3)").
  - Lista de linhas: nome do produto, quantidade ("2 ×"), preço unitário e subtotal da linha (preço × quantidade).
  - Total do carrinho (soma dos subtotais).
  - Botão "Fechar venda" no rodapé do painel.

Comportamento:
- Ao confirmar no modal, o produto entra no carrinho com a quantidade informada, o modal fecha e aparece o aviso "Produto adicionado ao carrinho". O atendente continua na consulta, com a busca e a página atuais preservadas.
- Se o produto já estiver no carrinho, somar a quantidade à linha existente (não criar outra linha).

Dados de exemplo (fictícios, 3 páginas de resultados):
- X-Frango Grelhado — "Pão brioche, filé de frango grelhado, queijo prato, alface e tomate." — R$ 24,90
- Coxinha de Frango com Catupiry — "Massa de batata recheada com frango desfiado e catupiry." — R$ 8,50
- Salada Caesar com Frango — "Alface americana, frango em tiras, croutons, parmesão e molho caesar." — R$ 29,00
- Torta de Frango com Palmito Fatia Média Assada no Forno a Lenha — "Massa amanteigada caseira recheada com frango desfiado temperado com ervas finas, palmito pupunha em cubos, milho verde, ervilha, azeitona verde fatiada, requeijão cremoso e queijo muçarela gratinado por cima, servida em fatia individual." — R$ 16,75 (texto longo para testar o corte de nome e descrição)
- Wrap de Frango Defumado — "Tortilha integral com frango defumado, cream cheese e rúcula." — R$ 21,40 (sem foto)
- Carrinho inicial com 2 linhas: "Coxinha de Frango com Catupiry — 2 × R$ 8,50 = R$ 17,00" e "Suco de Laranja 500 ml — 1 × R$ 9,00 = R$ 9,00"; total R$ 26,00.

Estados:
- Antes da primeira busca: área de resultados com o texto "Digite um termo para buscar produtos".
- Busca com campo vazio: não buscar; mostrar abaixo do campo "Digite algo para buscar".
- Carregando: cards em esqueleto (skeleton) na grade e botão "Buscar" desabilitado.
- Nenhum resultado: "Nenhum produto encontrado para "xyz". Tente outro termo." O termo continua no campo.
- Erro na consulta: "Não foi possível consultar os produtos agora." com o botão "Tentar de novo", que repete a última busca.
- Produto sem foto: no lugar da foto, um marcador neutro com ícone de imagem.
- Quantidade inválida (vazia ou zero): o botão "Adicionar" fica desabilitado e aparece "Informe uma quantidade maior que zero". Casas decimais não são aceitas no campo.
- Falha ao adicionar ao carrinho: o modal continua aberto com a mensagem "Não foi possível adicionar o produto. Tente de novo."
- Carrinho vazio: texto "Nenhum produto no carrinho" e botão "Fechar venda" desabilitado.

# Constraints
- NÃO criar login, menu lateral nem outras telas além desta.
- NÃO criar tela de detalhes do produto; o card não é clicável, só o botão "Adicionar ao carrinho".
- NÃO criar a tela de fechamento da venda nem de pagamento. "Fechar venda" ainda não navega para lugar nenhum.
- NÃO conectar banco de dados, Supabase nem API agora; usar apenas os dados de exemplo. A busca pode filtrar os dados de exemplo localmente por nome, descrição ou código.
- NÃO adicionar filtros, ordenação, categorias, leitor de código de barras, descontos nem preços diferenciados.
