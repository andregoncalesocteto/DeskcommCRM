Casos de uso: UC02

# Context
Tela de cadastro de cliente do PDV, usada pelo atendente (já logado) quando a busca não encontra o cliente. Ele preenche os dados pessoais e, quando houver, o endereço, salva e volta para a identificação com o cliente já selecionado para o pedido.
Esta tela vem depois da tela "Identificar cliente" já existente no projeto: reaproveite o componente "Formulário de endereço" dela e siga o estilo definido no Knowledge do projeto.

# Task
Layout (desktop / tela de PDV na horizontal):
- "Cabeçalho": faixa no topo com o título "Cadastrar cliente" à esquerda, um aviso do tipo do pedido ("Pedido de entrega: o endereço é obrigatório" ou "Pedido de balcão: o endereço é opcional") ao centro e "Atendente: Marina Souza" à direita. O tipo do pedido vem da tela de identificação; para testar, deixe um seletor "Entrega / Balcão" igual ao dela no cabeçalho.
- "Dados pessoais": cartão com o formulário dos dados do cliente.
- "Endereço": cartão abaixo de "Dados pessoais", com o componente "Formulário de endereço".
- "Barra de ações": rodapé fixo com os botões "Cancelar" e "Salvar cliente".

Componentes:
- Em "Dados pessoais": campos "Nome*", "Telefone" (máscara "(00) 00000-0000"), "E-mail", "CPF" (máscara "000.000.000-00") e "Data de nascimento" (máscara "00/00/0000"). Texto de ajuda logo abaixo de Telefone e E-mail: "Informe ao menos o telefone ou o e-mail".
- Em "Endereço": título "Endereço" com o selo "Obrigatório" (entrega) ou "Opcional" (balcão) e o componente "Formulário de endereço" (CEP*, UF*, Cidade*, Bairro*, "Endereço com número*" e Complemento). Ao completar os 8 dígitos do CEP, o sistema busca e preenche UF, cidade e bairro, que continuam editáveis. Em balcão, o endereço pode ficar vazio.
- Em "Barra de ações": "Cancelar" (volta para a identificação) e "Salvar cliente" (botão de destaque).

Comportamento:
- Ao abrir a tela vindo de uma busca sem resultado, o campo correspondente já vem preenchido com o que foi digitado (telefone, nome ou CPF). Para a prévia, abra a tela com o Telefone já preenchido com "(19) 99000-1234".
- Obrigatórios: Nome e (Telefone ou E-mail). CPF e data de nascimento são opcionais. Endereço obrigatório em entrega; em balcão pode ficar totalmente vazio, mas se o atendente começar a preenchê-lo, os campos obrigatórios do endereço passam a valer.
- Ao salvar com sucesso, mostrar "Cliente cadastrado e selecionado para o pedido". O endereço salvo vira o principal automaticamente.
- Ao salvar com CPF ou telefone que já pertence a outro cliente, bloquear o cadastro e oferecer abrir a ficha existente.

Dados de exemplo (fictícios):
- Cadastro que deve funcionar: Nome "Carlos Eduardo Ferreira", Telefone "(19) 99555-4321", E-mail "carlos.ferreira@email.com", CPF "111.444.777-35", nascimento "22/07/1990".
- Duplicidade (deve bloquear): o CPF "529.982.247-25" e o telefone "(19) 99876-5432" já pertencem à cliente Maria Oliveira.
- Endereço de teste: CEP 13060-000 → Rua das Acácias, Jardim Primavera, Campinas/SP, com número "310" e complemento "Casa dos fundos".
- CEP 99999-999 simula "não encontrado".
- Um nome bem longo para testar o campo: "Maria de Fátima Albuquerque Nascimento Souza dos Santos".

Estados:
- Campos obrigatórios vazios → "Preencha este campo" abaixo do campo. Nome vazio → "Informe o nome".
- Sem telefone e sem e-mail → "Informe ao menos o telefone ou o e-mail" nos dois campos.
- CPF inválido (incluindo dígito verificador errado) → "CPF inválido". E-mail inválido → "E-mail inválido". Data inválida ou futura → "Data inválida". CEP incompleto → "Informe o CEP com 8 dígitos".
- Em entrega, endereço vazio → os campos de endereço mostram "Preencha este campo" e o cadastro não salva.
- CEP não encontrado ou falha na consulta → "CEP não encontrado. Preencha o endereço manualmente." e todos os campos ficam liberados. Buscando CEP → UF, cidade e bairro mostram carregando.
- CPF já cadastrado → aviso no topo "Já existe um cliente com este CPF." com o botão "Abrir ficha existente".
- Telefone já cadastrado → aviso no topo "Já existe um cliente com este telefone." com o botão "Abrir ficha existente".
- Salvando: botão "Salvar cliente" desabilitado com indicador de carregamento.
- Falha ao salvar → aviso no topo "Não foi possível cadastrar o cliente. Tente de novo." mantendo tudo o que foi digitado.

# Constraints
- NÃO criar login, menu lateral nem outras telas além desta. "Cancelar", "Abrir ficha existente" e o retorno após salvar apontam para a tela "Identificar cliente" que já existe no projeto.
- NÃO recriar o "Formulário de endereço": reutilize o componente existente.
- NÃO exigir CPF, data de nascimento nem endereço em pedido de balcão.
- NÃO conectar banco de dados, Supabase nem API agora; usar apenas os dados de exemplo. Verificação de duplicidade e consulta de CEP podem funcionar localmente sobre os dados de exemplo.
