Estilo do projeto (vale para todas as telas do PDV):
- Paleta: fundo claro neutro (branco nas superfícies, cinza bem claro no fundo da página). Uma única cor de destaque, azul, usada só nos botões de ação principal ("Buscar", "Adicionar", "Fechar venda") e no foco dos campos. Vermelho apenas para mensagens de erro e validação. Nada de gradientes.
- Tipografia: fonte sem serifa (Inter). Texto base de 16 px; nada menor que 14 px. Preços sempre em negrito e com destaque visual no card.
- Densidade e espaçamento: confortável, pensado para tela de toque no PDV. Botões e áreas clicáveis com no mínimo 44 px de altura. Cards com cantos levemente arredondados e sombra discreta.
- Tom dos textos: direto e cordial, em português do Brasil, sem gírias. Mensagens curtas, dizendo o que aconteceu e o que fazer.
- Valores monetários sempre no formato "R$ 0,00" (vírgula decimal, ponto de milhar).
- Sempre: toda lista ou área de resultados tem estado vazio, carregando (skeleton) e erro com ação para tentar de novo. Botões desabilitados ficam visivelmente desabilitados.
- NUNCA: criar telas, login, menus, filtros ou integrações que não foram pedidos no prompt da tela. Não conectar banco de dados, Supabase ou APIs; usar só os dados de exemplo do prompt.
