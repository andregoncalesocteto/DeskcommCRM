Estilo do projeto (vale para todas as telas do PDV):
- Paleta: fundo claro neutro (branco nas superfícies, cinza bem claro no fundo da página). Uma única cor de destaque, azul, usada só nos botões de ação principal ("Buscar", "Selecionar cliente", "Salvar", "Adicionar") e no foco dos campos. Vermelho apenas para mensagens de erro, validação e ações destrutivas ("Remover"). Nada de gradientes.
- Tipografia: fonte sem serifa (Inter). Texto base de 16 px; nada menor que 14 px. Dados importantes (nome do cliente, loja de entrega) em negrito.
- Densidade e espaçamento: confortável, pensado para tela de toque no PDV. Botões e áreas clicáveis com no mínimo 44 px de altura. Cards e modais com cantos levemente arredondados e sombra discreta.
- Formulários: rótulo sempre visível acima do campo (nunca só placeholder). Campo obrigatório marcado com "*". Mensagem de erro em vermelho logo abaixo do campo com problema, dizendo o que corrigir. Campos com máscara quando houver formato (telefone, CPF, CEP, data).
- Tom dos textos: direto e cordial, em português do Brasil, sem gírias. Mensagens curtas, dizendo o que aconteceu e o que fazer.
- Sempre: toda lista ou área de resultados tem estado vazio, carregando (skeleton) e erro com ação para tentar de novo. Botões desabilitados ficam visivelmente desabilitados. Ação que apaga dados pede confirmação em um modal.
- NUNCA: criar telas, login, menus, filtros ou integrações que não foram pedidos no prompt da tela. Não conectar banco de dados, Supabase ou APIs; usar só os dados de exemplo do prompt.
