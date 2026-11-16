Casos de uso: UC01, UC03

# Context
Tela de identificação do cliente do PDV, usada pelo atendente (já logado) antes de montar um pedido. Ele busca o cliente por telefone, nome ou CPF, confere a ficha e os endereços, altera ou adiciona endereços e seleciona o cliente para o pedido.
Siga o estilo definido no Knowledge do projeto.

# Task
Layout (desktop / tela de PDV na horizontal):
- "Cabeçalho": faixa no topo com o título "Identificar cliente" à esquerda; no centro, o seletor "Tipo do pedido" com as opções "Entrega" (padrão) e "Balcão"; à direita, "Atendente: Marina Souza".
- "Barra de busca": abaixo do cabeçalho, na coluna esquerda.
- "Resultados": abaixo da barra de busca, na coluna esquerda, com a lista de clientes encontrados.
- "Ficha do cliente": coluna direita, ocupando a maior parte da largura, com os dados pessoais e a lista de endereços.
- "Modal de endereço": abre sobre a tela para adicionar ou alterar um endereço (contém o componente "Formulário de endereço").
- "Modal de dados do cliente": abre sobre a tela para editar nome, CPF e data de nascimento.
- "Modal de remoção": confirmação para remover um endereço.

Componentes:
- Em "Barra de busca":
  - Seletor com três opções: "Telefone", "Nome" e "CPF" (padrão "Telefone").
  - Campo de texto com máscara conforme a opção (telefone "(00) 00000-0000", CPF "000.000.000-00", nome livre) e placeholder "Digite o telefone", "Digite o nome" ou "Digite o CPF".
  - Botão "Buscar". Enter no campo também busca.
  - Link "Cadastrar cliente novo" abaixo do campo, que leva à tela de cadastro (ainda não existe; por enquanto não navega).
- Em "Resultados":
  - Linha acima da lista: "3 clientes encontrados para "maria"".
  - Lista de candidatos. Cada item mostra nome do cliente e o endereço principal (uma linha cortada com "…"). Clicar em um item abre a ficha dele na coluna direita.
- Em "Ficha do cliente":
  - Bloco "Dados pessoais": Nome, Telefone, E-mail, CPF e Data de nascimento, em formato de rótulo e valor. Botão "Editar dados" ao lado do título do bloco. Telefone e e-mail só aparecem para leitura, sem edição.
  - Bloco "Endereços": título "Endereços (3)" e botão "Adicionar endereço". Cada endereço é um card com: selo "Principal" quando for o principal; linha com o endereço e o número; complemento; bairro, cidade/UF e CEP; e a linha "Loja de entrega: <nome da loja>" ou "Nenhuma loja entrega neste endereço". Cada card tem os botões "Alterar", "Remover" e, nos que não são principais, "Tornar principal". Em pedido de entrega, o card tem um seletor de escolha ("Usar neste pedido"), com o principal já marcado.
  - Rodapé da ficha: botão "Selecionar cliente".
- Em "Modal de endereço": título "Adicionar endereço" ou "Alterar endereço". Componente "Formulário de endereço" com os campos, nesta ordem: "CEP*" (máscara "00000-000"), "UF*" (lista com as 27 UFs), "Cidade*", "Bairro*", "Endereço com número*" e "Complemento" (opcional). Botões "Cancelar" e "Salvar endereço". Ao completar os 8 dígitos do CEP, o sistema busca e preenche UF, cidade e bairro, que continuam editáveis.
- Em "Modal de dados do cliente": título "Editar dados do cliente", campos "Nome*", "CPF" e "Data de nascimento" (máscara "00/00/0000"), botões "Cancelar" e "Salvar".
- Em "Modal de remoção": texto "Remover o endereço "<endereço>"? Esta ação não pode ser desfeita. Os pedidos anteriores continuam com este endereço." e botões "Cancelar" e "Remover" (vermelho). Se o endereço é o principal e há outros, mostrar também o campo "Novo endereço principal*" com a lista dos outros endereços.

Comportamento:
- A busca por nome pode retornar vários clientes; por telefone ou CPF, retorna um só e já abre a ficha. Com um único resultado, abrir a ficha direto.
- "Selecionar cliente": mostra o aviso "Cliente selecionado para o pedido" e o cabeçalho passa a mostrar "Cliente: <nome>". Em pedido de **Entrega**, o botão só fica habilitado com um endereço marcado em "Usar neste pedido". Em **Balcão**, o endereço não é exigido.
- O primeiro endereço de um cliente vira o principal automaticamente. "Tornar principal" muda o selo de lugar na hora.
- Alterar um endereço não afeta pedidos antigos (eles guardam o endereço original).
- A loja de entrega de cada endereço aparece só quando o tipo do pedido é "Entrega" e vem do ERP; use os valores dos dados de exemplo.

Dados de exemplo (fictícios):
- Cliente Maria Oliveira — telefone (19) 99876-5432, e-mail maria.oliveira@email.com, CPF 529.982.247-25, nascimento 14/03/1988. Endereços:
  1. Principal — Rua das Acácias, 120 — complemento "Apto 32, bloco B" — Jardim Primavera, Campinas/SP — CEP 13060-000 — Loja de entrega: Bella Capri Cambuí.
  2. Avenida Brasil, 1500 — sem complemento — Centro, Campinas/SP — CEP 13010-000 — Loja de entrega: Bella Capri Centro.
  3. Estrada Municipal do Rio Pequeno, km 7, Sítio Recanto das Palmeiras, portão azul ao lado do mercado — Zona Rural, Holambra/SP — CEP 13825-000 — Nenhuma loja entrega neste endereço (texto longo para testar quebra de linha).
- Cliente Maria de Fátima Albuquerque Nascimento Souza dos Santos — telefone (19) 98123-4567, sem e-mail, sem CPF, sem data de nascimento, com 1 endereço: Rua Coronel Quirino, 880 — Cambuí, Campinas/SP — CEP 13025-001 — Loja de entrega: Bella Capri Cambuí (nome longo para testar o corte na lista).
- Cliente Mariana Lopes — telefone (19) 99701-2233 — endereço Rua Dr. Sampaio Ferraz, 45 — Bosque, Campinas/SP.
- Cliente João Pereira Lima — telefone (19) 99333-1100, e-mail joao.lima@email.com, sem endereços (para o estado "sem endereço").
- CEP 13060-000 encontra "Rua das Acácias", Jardim Primavera, Campinas, SP. CEP 99999-999 simula "não encontrado".

Estados:
- Antes da primeira busca: em "Resultados", "Digite um telefone, nome ou CPF para buscar o cliente". Em "Ficha do cliente", "Nenhum cliente selecionado".
- Busca com campo vazio: não buscar; mostrar abaixo do campo "Digite algo para buscar".
- Formato inválido: telefone incompleto → "Informe o telefone com DDD"; CPF inválido (incluindo dígito verificador errado) → "CPF inválido". Não buscar.
- Carregando: itens da lista e blocos da ficha em esqueleto (skeleton) e botão "Buscar" desabilitado.
- Nenhum cliente encontrado: "Nenhum cliente encontrado para "xyz"." com o botão "Cadastrar cliente novo". O termo continua no campo.
- Erro na busca: "Não foi possível buscar o cliente agora." com o botão "Tentar de novo", que repete a última busca.
- Cliente sem endereço: em "Endereços", "Este cliente ainda não tem endereço" e botão "Adicionar endereço". Em pedido de Entrega, "Selecionar cliente" fica desabilitado com o aviso "Adicione um endereço para entrega".
- Em pedido de Entrega, nenhum endereço marcado: "Selecionar cliente" desabilitado com o aviso "Escolha o endereço de entrega".
- Endereço sem loja entregadora: o card mostra "Nenhuma loja entrega neste endereço" em vermelho discreto; ele continua listado e pode ser salvo.
- Formulário de endereço: campos obrigatórios vazios → "Preencha este campo" no campo; CEP incompleto → "Informe o CEP com 8 dígitos"; CEP não encontrado ou falha na consulta → aviso "CEP não encontrado. Preencha o endereço manualmente." e todos os campos ficam liberados; buscando CEP → campos de UF, cidade e bairro mostram carregando.
- Modal de dados do cliente: nome vazio → "Informe o nome"; CPF inválido → "CPF inválido"; data inválida ou futura → "Data inválida".
- Falha ao salvar (endereço ou dados): o modal continua aberto, com o que foi digitado, e a mensagem "Não foi possível salvar. Tente de novo."
- Falha ao remover: o modal continua aberto com "Não foi possível remover o endereço. Tente de novo."

# Constraints
- NÃO criar login, menu lateral nem outras telas além desta. "Cadastrar cliente novo" e "Selecionar cliente" ainda não navegam para lugar nenhum.
- NÃO permitir editar telefone nem e-mail do cliente.
- NÃO criar desativação reversível de endereço: remover é definitivo, com confirmação.
- NÃO criar a montagem do pedido, o pagamento nem a escolha de loja pelo atendente (a loja de entrega é só exibida).
- NÃO conectar banco de dados, Supabase nem API agora; usar apenas os dados de exemplo. A busca e a consulta de CEP podem funcionar localmente sobre os dados de exemplo.
- Deixe o "Formulário de endereço" como um componente reutilizável com esse nome, pois a tela de cadastro vai usá-lo depois.
