# Casos de uso — Identificar cliente no PDV

Escopo: o atendente **identifica o cliente** antes de montar um pedido, consulta e mantém a
ficha dele e gerencia os endereços. Montagem do pedido, pagamento e entrega ficam fora deste
documento. O que ainda não foi definido está marcado como `[A DEFINIR]`.

**Ficha do cliente:** Nome, CEP, UF, cidade, bairro, endereço com número, complemento, CPF,
e-mail e data de nascimento. O cliente pode ter mais de um endereço.

## UC01 — Identificar cliente

**Atores**
- Primário: Atendente
- Secundário: ERP (acessado via MCP), que guarda os clientes

**Objetivo**
Permitir que o atendente encontre o cliente por telefone, nome ou CPF e o selecione para o
pedido, vendo a ficha e os endereços dele.

**Pré-condições**
- Atendente autenticado no PDV.

**Pós-condições**
- Cliente selecionado e vinculado ao pedido em andamento.
- Nenhum dado do cliente é alterado.

**Fluxo principal**
1. O Atendente abre a identificação do cliente.
2. O Atendente informa um telefone, um nome ou um CPF.
3. O sistema busca o cliente.
4. O sistema exibe a ficha do cliente encontrado, com todos os endereços.
5. O Atendente confirma que é o cliente certo e o seleciona para o pedido.

**Fluxos alternativos e de exceção**
- 2a. Termo vazio: o sistema não pesquisa e orienta o atendente a informar telefone, nome ou CPF.
- 2b. Telefone ou CPF em formato inválido: o sistema aponta o erro e não pesquisa. O CPF tem o dígito verificador conferido.
- 3a. Mais de um cliente encontrado (comum na busca por nome): o sistema lista os candidatos, mostrando nome e endereço, e o Atendente escolhe um.
- 3b. Nenhum cliente encontrado: o sistema informa e oferece cadastrar um cliente novo (UC02).
- 3c. Sistema de clientes indisponível ou erro na busca: o sistema informa a falha e permite tentar de novo.
- 5a. Pedido para entrega e cliente sem endereço: o sistema exige incluir um endereço (UC03) antes de seguir. Para pedido de balcão, o endereço não é exigido.
- 5b. O Atendente quer alterar ou incluir um endereço: segue UC03.
- 5c. O Atendente quer corrigir Nome, CPF ou data de nascimento: o sistema permite editar apenas esses três dados da ficha. Telefone e e-mail não são editados nesta tela.

## UC02 — Cadastrar cliente novo

**Atores**
- Primário: Atendente

**Objetivo**
Permitir que o atendente crie a ficha de um cliente que não existe, com o primeiro endereço,
e o selecione para o pedido sem perder a venda.

**Pré-condições**
- Busca do UC01 sem resultado, ou escolha explícita do Atendente de cadastrar.

**Pós-condições**
- Cliente criado com os dados da ficha. O endereço só é obrigatório para pedido de entrega.
- Cliente selecionado para o pedido.

**Fluxo principal**
1. O Atendente aciona "Cadastrar cliente".
2. O sistema exibe o formulário com os campos da ficha, já preenchendo o que foi digitado na busca (telefone, nome ou CPF).
3. O Atendente preenche os dados pessoais (nome, telefone ou e-mail, CPF, data de nascimento) e, quando houver, o endereço (CEP, UF, cidade, bairro, endereço com número, complemento).
4. O Atendente salva.
5. O sistema cria o cliente e o seleciona para o pedido.

**Fluxos alternativos e de exceção**
- 3a. Obrigatórios no cadastro: Nome e (Telefone ou E-mail). CPF, data de nascimento e o restante da ficha são opcionais. O endereço é obrigatório só para pedido de entrega, não para balcão.
- 3c. CEP informado: o sistema consulta a API de CEP fornecida pelo ERP e preenche UF, cidade e bairro. Os campos preenchidos continuam editáveis.
- 3d. CEP não encontrado ou falha na consulta de CEP: o sistema avisa e o Atendente digita todos os campos à mão.
- 4a. CPF já cadastrado: o sistema avisa e oferece abrir a ficha existente em vez de duplicar.
- 4b. Telefone já cadastrado em outra ficha: o sistema bloqueia o cadastro e oferece abrir a ficha existente.
- 4c. Dado inválido (CPF, e-mail, data, CEP): o sistema aponta o campo e não salva.
- 4d. Falha ao salvar: o sistema informa, mantém o que foi digitado e permite tentar de novo.

## UC03 — Gerenciar endereços do cliente

**Atores**
- Primário: Atendente

**Objetivo**
Permitir que o atendente veja os endereços do cliente identificado, altere um existente ou
adicione um novo, e escolha qual usar no pedido.

**Pré-condições**
- Cliente identificado (UC01) ou recém-cadastrado (UC02).

**Pós-condições**
- Endereço alterado ou incluído e vinculado ao cliente.
- Endereço escolhido disponível para o pedido.

**Fluxo principal**
1. O Atendente vê a lista de endereços do cliente.
2. O Atendente escolhe alterar um endereço ou adicionar um novo.
3. O sistema exibe o formulário (CEP, UF, cidade, bairro, endereço com número, complemento), preenchido no caso de alteração.
4. O Atendente edita e salva.
5. O sistema grava o endereço e atualiza a lista.
6. O Atendente escolhe o endereço do pedido. A escolha é obrigatória para entrega e dispensada no balcão.

**Fluxos alternativos e de exceção**
- 1a. Cliente sem nenhum endereço: o sistema informa e leva direto à inclusão de um novo.
- 3a. CEP informado: o sistema consulta a API de CEP fornecida pelo ERP e preenche UF, cidade e bairro. Os campos preenchidos continuam editáveis.
- 3b. CEP não encontrado ou falha na consulta de CEP: o sistema avisa e o Atendente digita todos os campos à mão.
- 4a. Dado inválido (CEP, UF, campos obrigatórios vazios): o sistema aponta o campo e não salva.
- 4b. Falha ao salvar: o sistema informa, mantém o que foi digitado e permite tentar de novo.
- 5a. Alterar um endereço que já foi usado em pedidos anteriores: os pedidos antigos mantêm o endereço original; só valem para pedidos novos.
- 2b. O Atendente remove um endereço: o sistema pede confirmação e remove o endereço de forma definitiva. Pedidos antigos mantêm o endereço original. Se o endereço removido era o principal e restam outros, o Atendente escolhe o novo principal na própria confirmação.
- 6a. Em pedido de entrega, o ERP calcula automaticamente a loja que entrega em cada endereço, e a tela mostra essa loja no endereço. Se nenhuma loja entrega naquele endereço, a tela mostra "Nenhuma loja entrega neste endereço" (o endereço pode ser salvo; seguir ou não com o pedido é decisão do fluxo do pedido, fora deste escopo).
- 6b. Endereço principal: o cliente tem um endereço marcado como principal, que vem pré-selecionado no pedido. O atendente pode trocar qual é o principal. O primeiro endereço cadastrado vira o principal automaticamente.

## Relacionamentos

- UC02 `<<extend>>` UC01 — cadastrar é o caminho opcional quando a busca não acha o cliente.
- UC03 `<<extend>>` UC01 — gerenciar endereços é opcional a partir da ficha do cliente identificado.
- UC03 `<<include>>` na conclusão do UC02 — o primeiro endereço é informado no cadastro (o formulário de endereço é o mesmo componente).

## Diagrama

Ver [diagrama-casos-de-uso.mmd](diagrama-casos-de-uso.mmd).

## Decisões registradas

- Ator: Atendente. Identificar o cliente é obrigatório antes de fazer o pedido.
- Identificação por telefone, nome ou CPF.
- Ficha: Nome, CEP, UF, cidade, bairro, endereço com número, complemento, CPF, e-mail e data de nascimento.
- O cliente pode ter mais de um endereço; os endereços podem ser alterados ou adicionados.
- Os clientes ficam no ERP, acessado via MCP.
- Cadastro de cliente novo (UC02) está no escopo.
- Dados pessoais editáveis pelo atendente: apenas Nome, CPF e data de nascimento.
- Obrigatórios no cadastro: Nome e (Telefone ou E-mail).
- A tela de endereços permite remover (definitivo), marcar endereço principal e mostra a loja que entrega, calculada pelo ERP; o primeiro endereço vira o principal.
- Alterar um endereço não muda pedidos antigos, que mantêm o endereço original.
- CEP preenche UF, cidade e bairro, via API fornecida pelo ERP.
- Telefone repetido em outra ficha bloqueia o cadastro (assim como CPF repetido).
- A lista de candidatos da busca por nome mostra nome e endereço.
- Endereço obrigatório para entrega; não exigido no balcão (confirmado: é entrega, não retirada).
- Telefone e e-mail não são editáveis pelo atendente.
- CPF tem o dígito verificador conferido.
- Campos preenchidos pelo CEP continuam editáveis; CEP não encontrado leva à digitação manual.

## Pendências `[A DEFINIR]`

Nenhuma.
