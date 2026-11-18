# Especificação do protótipo Lovable "Forno • PDV Pizzaria" (cart-craft-counter)

Fonte: repositório https://github.com/andregoncalesocteto/cart-craft-counter (HEAD `452cfd9`, o mesmo commit citado no PRD FR-010), app em https://cart-craft-counter.lovable.app. Extraído por leitura do código em 2026-11-18; nada foi executado. **Esta é a especificação do que o produto deve fazer "igual"** (decisão do dono do projeto, 2026-11-18); onde ela difere dos casos de uso desta pasta, vale esta, salvo as exceções do ADR-009 (preço, taxa e total vêm do ERP).
Convenção das citações: `index.tsx` = `src/routes/index.tsx`; `customers.ts` = `src/lib/customers.ts`; idem `menu.ts`, `orders.ts`, `aiService.ts`, `customer-store.ts`, `session-store.ts`; componentes em `src/components/`; testes em `src/test/`. "NÃO ENCONTRADO" = procurado por `grep` e ausente.

Observação geral: o protótipo é 100% cliente, em memória, sem login, sem servidor, sem ERP. Tudo que parece "vindo do sistema" (cardápio, clientes, CEP, lojas, taxa) é constante no código. O README do repo diz "Implement exactly the screenshot and nothing else". O cabeçalho do `AGENTS.md` afirma "No persistence or server calls".

---

## 1. Mapa de rotas e telas

Rotas existentes (`routeTree.gen.ts`): `/`, `/clientes/` e `/clientes/novo`. Qualquer outra cai em `NotFoundComponent` de `__root.tsx` (texto em inglês: "404", "Page not found", "The page you're looking for doesn't exist or has been moved.", botão "Go home"). Erro de rota: `ErrorComponent` em inglês ("This page didn't load", "Something went wrong on our end. You can try refreshing or head back home.", botões "Try again" e "Go home"). Nenhuma das duas está traduzida: é template do Lovable, não decisão de produto.

`__root.tsx`: `<html lang="pt-BR">`, fonte Manrope (Google Fonts 400 a 800), título padrão "Forno • PDV Pizzaria", `QueryClientProvider` sem uso real. Paleta em `styles.css`: `--primary: oklch(0.577 0.215 27.325)` (vermelho), `--background: oklch(0.98 0.002 250)`; existe tema escuro nas variáveis.

### 1.1 `/` — PDV principal (`index.tsx`, função `Index`)
`<title>`: "Forno • Novo pedido | PDV Pizzaria".

Estrutura (ordem de cima para baixo e da esquerda para a direita):

1. **Topbar** (`header.topbar`): marca "forno." + subtítulo "PDV PIZZARIA" (ícone Pizza); à direita: indicador verde "Balcão aberto" (escondido abaixo de 1100 px: `styles.css` linha 319), botão "Clientes" (link para `/clientes`), botão "Pedidos do dia" (troca a coluna da direita para o histórico), "Atendente" (rótulo fixo com ícone; abaixo de 760 px só o ícone).
2. **Workspace** (`div.workspace`, CSS grid de 3 colunas): `28% 43% 29%`; `30% 40% 30%` a partir de 1550 px; `24% 45% 31%` até 1100 px; **uma coluna a 760 px ou menos** (coluna única: assistente → montar pedido → carrinho, nessa ordem, assistente com `min-height: 440px; height: 540px`; `.pos` deixa de ter altura fixa `100dvh`).
   - **Coluna 1 — Assistente** (`ChatPanel`), título "Assistente", subtítulo "Simulação".
   - **Coluna 2 — "Montar pedido"** (painel do cardápio / configurador / resultados de busca).
   - **Coluna 3 — uma de quatro vistas**, controlada por `view` (`'cart' | 'checkout' | 'success' | 'history'`): "Pedido atual" (carrinho), "Fechar pedido" (`CheckoutPanel`), "Pedido confirmado" (`SuccessPanel`), "Pedidos do dia" (`HistoryPanel`).
   - As colunas 1 e 2 ficam dentro de `div.order-workspace-inputs` com `inert` quando `view !== 'cart'` (opacidade .6): **ao fechar, ver sucesso ou histórico, o assistente e a montagem ficam travados** (e o chat cancela respostas em voo: `ChatPanel` efeito em `disabled`). `AGENTS.md`: "Freeze item entry while checkout, success or history is shown".
3. **Diálogo de quantidade** (`QuantityDialog`) como overlay quando `qtyProduct` está definido.

Regiões do carrinho (coluna 3, vista `cart`), em ordem:
1. Cabeçalho: ícone, "Pedido atual", subtítulo (`N item no pedido` / `N itens no pedido` / "Seu pedido começa aqui"), selo numérico com a soma das quantidades.
2. **Cliente** (`CustomerQuickPick`): campo de busca ou cartão do cliente selecionado.
3. **Tipo do pedido**: dois botões "Balcão" e "Delivery" (ícone de caminhão), `aria-pressed`.
4. **Loja**: seletor (Balcão) ou texto automático (Delivery) com selo "Automática".
5. **Pagamento**: `<select>` + campo "Troco R$" quando Dinheiro.
6. Lista de itens (rolável) ou vazio.
7. Rodapé: Subtotal; "Taxa de entrega" (só Delivery); "Total do pedido"; aviso de cliente; botão "Finalizar pedido"; "Limpar pedido" (ou confirmação inline); nota "Pedido em montagem" com cadeado.

Atalhos de teclado (todos verificados no código):
- **F2** (global na janela enquanto o carrinho está montado, `CustomerQuickPick`): se há cliente selecionado, **desmarca**; foca o campo de busca do cliente.
- No campo de cliente: seta para baixo/cima movem o item ativo, **Enter** seleciona o ativo (ou, sem resultado e com termo, abre o cadastro), **Esc** fecha a lista.
- No campo de busca de produtos: Enter envia (é `<form role="search">`).
- Diálogo de quantidade: **Esc** cancela (listener na janela), **Enter** no campo confirma; clicar no fundo escuro cancela.
- Chat: Enter envia (`<form>`); Enter durante composição IME é ignorado.
- Não há atalho para Finalizar, Confirmar nem para o menu.

### 1.2 `/clientes/` — "Identificar cliente" (`clientes.index.tsx`, `IdentifyCustomer`)
`<title>` "Identificar cliente | Forno PDV". Search params validados: `cliente` (id) e `cadastrado` (bool). (O plano `.lovable/plan/clientes-...md` fala em `tipo`, `termo`, `modo`; no código só `cliente` e `cadastrado` existem aqui. `modo` e `termo` ficam em `/clientes/novo`.)

- **Cabeçalho** (`CustomerHeader`): seta "Voltar ao PDV" (link para `/`), título "Identificar cliente", centro `KindSwitch` (rótulo "Tipo do pedido" + botões "Entrega" | "Balcão"), à direita "Cliente: <nome>" (quando há seleção) e "Atendente: **Marina Souza**" (fixo).
- **Grade** `lg:grid-cols-[minmax(300px,380px)_1fr]` (abaixo de `lg` empilha).
  - **Coluna esquerda**: cartão de busca (grupo "Buscar por" com abas Telefone / Nome / CPF; campo com máscara; botão "Buscar" com ícone de lupa; mensagem de erro de validação; link "Cadastrar cliente novo") e cartão de resultados.
  - **Coluna direita (ficha)**: "Dados pessoais" com "Editar dados"; "Endereços (N)" com "Adicionar endereço"; cartões de endereço; rodapé fixo da ficha com mensagem de bloqueio e "Selecionar cliente".
- Três diálogos: endereço, editar dados, remover endereço (ver seção 2).

### 1.3 `/clientes/novo` — "Cadastrar cliente" (`clientes.novo.tsx`, `NewCustomer`)
`<title>` "Cadastrar cliente | Forno PDV". Search params: `modo` (`nome|cpf|telefone`) e `termo`.
- Cabeçalho com título "Cadastrar cliente"; no centro: aviso (`Pedido de entrega: o endereço é obrigatório` / `Pedido de balcão: o endereço é opcional`) + `KindSwitch`.
- Corpo (`max-w-3xl`): alerta de duplicidade, alerta de falha, cartão "Dados pessoais", cartão "Endereço" (selo "Obrigatório" em Entrega, "Opcional" em Balcão).
- Rodapé fixo: "Cancelar" e "Salvar cliente" (com spinner ao salvar).

---

## 2. Fluxos, passo a passo

### 2.1 Montar pedido manual
1. Coluna 2 mostra: barra de busca de produtos (placeholder "Busque por nome, código ou ingrediente", botão "Buscar"), abas **Pizzas / Bebidas / Sobremesas** (ícones; `aria-pressed`; aba inicial Pizzas), título da seção ("Nossas pizzas" / "Bebidas" / "Sobremesas") com "N opções", grade de 2 colunas de cartões. Rodapé de status: ícone + "Cardápio de exemplo" ou a mensagem de aviso mais recente (`notice`) com check verde.
2. **Cartão de produto**: foto (pizzas: recorte do sprite `pizzas.jpg` conforme `photo` 0 a 7; bebidas: ícone de copo; sobremesas: ícone de sorvete), nome, descrição, "A partir de" + menor preço, ícone "+". O cartão inteiro é um botão (`aria-label="Montar <nome>"`) que **abre o configurador**, para qualquer categoria.
3. Para **bebidas e sobremesas** há também, abaixo do cartão, **botões de tamanho rápidos** ("+ Lata", "+ 600ml", "+ 2L"...; `aria-label="Adicionar <nome> <tamanho>"`, título "<nome> <tamanho> — R$ x") que adicionam 1 unidade direto (`addQuick`; aviso "<nome> <tamanho> adicionado"). Pizzas não têm.
4. **Configurador** (substitui a grade; título "Montar pedido"/"Editar item", subtítulo "Personalize do jeito do cliente"): botão "Voltar ao cardápio"; nome e descrição do produto; seção "Tamanho" (um botão por chave de `prices`, inicia no primeiro: P para pizza, Lata para Coca-Cola).
   - **Se pizza**: seção "Sabores" com "1 sabor" / "Meio a meio"; em meio a meio aparece "Segundo sabor" (`<select>`, opção "Selecione o segundo sabor", lista as outras pizzas com `<nome> — <preço no tamanho atual>`); seção "Ingredientes" (checkboxes todos marcados; desmarcar = remover; com meio a meio mostra "Primeira metade · <nome>" e "Segunda metade · <nome>" com os ingredientes de cada); seção "Adicionais" (7 itens, cada um com stepper 0..n, "+ R$ x"); "Observação · opcional" (textarea, placeholder "Ex.: pizza bem passada").
   - **Se não for pizza** (bebida/sobremesa com mais de um tamanho, ou um tamanho só aberto pelo cartão): só "Tamanho" e "Quantidade" (stepper, mínimo 1). Sem ingredientes, adicionais ou observação.
   - Rodapé do configurador: "Valor do item" (ou "Valor atualizado" ao editar) = `unitPrice(draft) × draft.quantity`; botão "Adicionar ao carrinho" (ícone +) ou "Salvar alterações" (ícone check). Desabilitado apenas se meio a meio sem segundo sabor (não há mensagem, só o botão desabilitado).
   - **Pizza não tem campo de quantidade no configurador** (a quantidade nasce 1; ajusta-se no carrinho).
5. Confirmar: `submit()` → `saveItem` **sempre cria uma linha nova** (não soma com pizza igual); aviso "Item adicionado ao pedido"; volta ao cardápio. Não há limite de itens.
6. Trocar de aba ou "Voltar ao cardápio" descarta o rascunho do configurador sem confirmação.

### 2.2 Busca de produtos + janela de quantidade
1. Digitar e Enter/"Buscar". Campo vazio: dica `role=alert` "Digite algo para buscar", sem buscar.
2. `runSearch`: status `loading` (grade de 6 cartões-esqueleto, `aria-busy`, botão "Buscar" desabilitado), espera simulada de **450 ms** (`searchProductsAsync`), depois `done`. Troca termo/página volta para 1. Ao existir busca (`status !== 'idle'`), as abas somem e aparece o "X" ("Limpar busca") dentro do campo, que volta ao estado `idle` e às abas.
3. Resultado: "N produto(s) encontrado(s) para "termo"", grade 2 colunas de cartões (ícone de sanduíche como "foto"; `noPhoto` → ícone `ImageOff` e `aria-label="Produto sem foto"`; nome com título, descrição, preço com "A partir de " se tiver mais de um tamanho, botão "Adicionar ao carrinho"). **O cartão em si não é clicável**, só o botão. Paginação de **6 por página**: "Anterior", "Página X de Y", "Próxima" (desativados nas pontas).
4. "Adicionar ao carrinho" chama `pick(p)`: se `isSimple(p)` (categoria diferente de pizza **e** um único preço) abre o **diálogo de quantidade**; senão troca a aba (lanches vão para Pizzas) e abre o configurador.
5. **Diálogo de quantidade**: título = nome do produto; "R$ x por unidade"; rótulo "Quantidade"; botões "−" / "+" (aria "Diminuir quantidade"/"Aumentar quantidade"); campo numérico que só aceita dígitos (inicia em "1"); com campo vazio ou 0 aparece "Informe uma quantidade maior que zero" e "Adicionar" fica desabilitado; "−" desabilita com quantidade ≤ 1 ou inválida; "Cancelar" / "Adicionar".
6. Confirmar: `addOrMerge(cart, id, qty)` **soma na linha existente** do mesmo produto/tamanho sem extras, observação, remoções nem meio a meio; senão cria linha (`origin: 'manual'`); aviso "Produto adicionado ao carrinho"; busca e página permanecem. Se `addOrMerge` lançar, o diálogo permanece com "Não foi possível adicionar o produto. Tente de novo." (o mock nunca lança com entrada válida).
7. Estado `done` sem itens: "Nenhum produto encontrado para "termo". Tente outro termo." (sem botão). Estado `error`: "Não foi possível consultar os produtos agora." + "Tentar de novo" (`retrySearch` refaz o último termo). **O mock nunca falha**, então o erro só existe no código.
8. Busca vinda do chat usa o mesmo `runSearch`, mas só grava `term` (não preenche o campo de texto da barra, `input`).

### 2.3 Carrinho (editar, remover, somar)
- Cada item: título `describeItem` + preço `unitPrice × quantidade`; linha "N × R$ unit"; "Obs.: ..." se houver; `Stepper` (mínimo 1, aria "Diminuir/Aumentar quantidade de <produto>"); botão "Editar" (texto + lápis); botão-ícone lixeira (título "Remover item"). **Remover é imediato, sem confirmação.** Item vindo do assistente mostra ícone de brilho (aria "Item do assistente", título "Adicionado pelo assistente") e pulsa até o fim da animação (`highlighted`).
- **Editar** (`edit`): carrega o item no configurador (troca a aba para a categoria do produto), título "Editar item", "Salvar alterações"; mantém `id` e `origin`. Alterar a quantidade no carrinho com o item aberto atualiza também o rascunho. Remover o item aberto fecha o configurador.
- "Limpar pedido" (desabilitado com carrinho vazio) mostra, no lugar, a confirmação inline "Limpar todos os itens do pedido?" com "Cancelar" e "Sim, limpar"; só zera itens (cliente, tipo, loja e pagamento permanecem); aviso "Pedido limpo".
- Subtotal soma tudo; sem desconto, sem cupom.
- A mesma linha do carrinho **não** é somada quando adicionada pelo configurador, por botão rápido ou pelo assistente (cada uma é nova linha). Só o diálogo de quantidade soma (item 6 acima).

### 2.4 Identificação do cliente no carrinho (busca rápida)
1. Sem cliente: campo (aria "Identificar cliente", placeholder "Cliente: telefone, nome ou CPF (F2)", ícone de lupa, "X" "Limpar busca de cliente" quando há texto). Ao digitar/focar abre lista `role=listbox` (aria "Clientes encontrados").
2. Busca (`quickSearchCustomers`, síncrona, sem esqueleto, sem estado de erro): modo detectado (`detectSearchMode`): qualquer letra → nome; 11 dígitos que formam CPF válido e (pontuado como CPF **ou** terceiro dígito diferente de 9) → CPF; resto → telefone. Nome: contém, sem acento, **mínimo 2 letras**. Telefone/CPF: os dígitos digitados estão **contidos** no telefone ou no CPF do cliente, **mínimo 3 dígitos**. Máximo 6 resultados.
3. Cada resultado: nome em negrito + "telefone · cpf · rua do endereço principal" (omitidos se vazios). Sem resultado: "Nenhum cliente encontrado". Última linha sempre: "Cadastrar novo cliente" (ícone usuário+).
4. Clicar ou Enter seleciona (`pick`): grava `selected = {customerId, addressId: endereço principal ou null}` (**mesmo em Balcão**), limpa o campo, aviso "Cliente: <nome>".
5. Com cliente: cartão com nome (negrito, truncado), telefone ou e-mail, link "Trocar cliente" (desmarca e foca o campo). **Só em Entrega** aparece abaixo: linha do endereço (`formatAddress`) ou "Sem endereço para entrega" (vermelho), e o link "Trocar endereço" (ou "Adicionar" se o cliente não tem nenhum). "Trocar endereço" abre lista (`listbox`, aria "Endereços do cliente") com os endereços (selecionado tem borda primária; principal tem " · principal") e o link "Novo endereço".
6. "Novo endereço" abre o diálogo "Novo endereço" (`AddressForm`; botões "Cancelar" / "Salvar e usar"); valida (`validateAddress`); ao salvar acrescenta o endereço, seleciona-o para o pedido e fecha. Primeiro endereço do cliente vira principal.
7. "Cadastrar novo cliente" abre o diálogo "Cadastrar cliente" (ver 2.6 para os campos). Pré-preenchimento (`initialNewCustomer`): se o termo tem letra vai para Nome, **senão vai sempre para Telefone** (mascarado; inclusive se o usuário digitou um CPF, ao contrário da rota `/clientes/novo`, que respeita `modo=cpf`). Botões "Cancelar" / "Salvar e usar no pedido" (spinner). Salvar: seleciona o novo cliente (primeiro endereço, se informado) e mostra aviso "Cliente cadastrado: <nome>".
8. Duplicidade no diálogo: alerta `role=alert` "Já existe um cliente com este CPF." / "Já existe um cliente com este telefone." + botão "Usar cliente existente" (seleciona o existente). Falha: "Não foi possível cadastrar o cliente. Tente de novo." (gatilho no mock: nome contendo `#falha`).
9. Inconsistência observada: ao selecionar um cliente com `addressId: null` (por exemplo, escolhido em Balcão ou pelo assistente em Balcão) e depois mudar para Delivery, o cartão mostra "Sem endereço para entrega", mas `orderStore` e `checkoutFromSelection` caem no **endereço principal** (`?? mainAddress(c)`), então a loja e o fechamento usam o principal. Ou seja, a tela e a regra divergem (`CustomerQuickPick.tsx` linha 44 vs `customers.ts` linhas 135 e 165).
10. Pedido do chat "Cadastrar novo cliente" grava `registerRequest` no store; o `CustomerQuickPick` abre o diálogo com o termo. Se já houver cliente selecionado, o diálogo não é desenhado (só existe no ramo "sem cliente"), mas `creating` fica `true`.

### 2.5 Tela `/clientes` (ficha, endereços, modais)
1. Escolher modo (Telefone / Nome / CPF; trocar de modo limpa o campo e o erro). Placeholders: "Digite o telefone" / "Digite o nome" / "Digite o CPF". Máscaras (`maskPhone` `(00) 00000-0000`, `maskCpf` `000.000.000-00`); teclado numérico para telefone/CPF.
2. "Buscar" (ou Enter) valida com `validateSearchTerm`: vazio → "Digite algo para buscar"; telefone com menos de 10 dígitos → "Informe o telefone com DDD"; CPF inválido (dígito verificador, todos iguais inválidos) → "CPF inválido". Com erro, não busca.
3. `run`: esqueletos (3 itens na lista e esqueleto da ficha), atraso simulado de **600 ms**. Termo exatamente `erro` (qualquer caixa) força o estado de erro: "Não foi possível buscar o cliente agora." + "Tentar de novo". Nome: contém sem acento; telefone/CPF: **igualdade exata dos dígitos**, no máximo 1 resultado.
4. Resultados: "N cliente(s) encontrado(s) para "termo"", lista com nome e endereço principal formatado (ou "Sem endereço cadastrado"). Se vier **exatamente um** resultado, a ficha abre sozinha. Nenhum: `Nenhum cliente encontrado para "termo".` + botão "Cadastrar cliente novo" (vai para `/clientes/novo?modo=...&termo=...`). Sem busca: "Digite um telefone, nome ou CPF para buscar o cliente".
5. Ficha: sem cliente aberto, "Nenhum cliente selecionado". Aberto: aviso opcional (`role=status`), "Dados pessoais" (Nome, Telefone, E-mail, CPF, Data de nascimento; vazio vira "—") com "Editar dados"; "Endereços (N)" com "Adicionar endereço"; sem endereços: "Este cliente ainda não tem endereço".
6. Cartão de endereço: em **Entrega**, um rádio "Usar neste pedido" (aria "Usar neste pedido: <rua>"; o principal vem marcado); selo "Principal"; rua em negrito; complemento; "bairro, cidade/UF — CEP x"; em Entrega, "Loja de entrega: <loja>" ou "Nenhuma loja entrega neste endereço". Botões: "Alterar", "Remover", "Tornar principal" (só se não principal; aplica na hora).
7. Modal **endereço** ("Adicionar endereço"/"Alterar endereço", descrição "Campos com * são obrigatórios."; "Cancelar"/"Salvar endereço"; atraso 500 ms; falha "Não foi possível salvar. Tente de novo." quando rua ou complemento contém `#falha`). Primeiro endereço de um cliente vira principal e é pré-selecionado.
8. Modal **editar dados** ("Editar dados do cliente", descrição "Telefone e e-mail não podem ser alterados."): Nome*, CPF, Data de nascimento; erros "Informe o nome", "CPF inválido", "Data inválida"; "Cancelar"/"Salvar"; falha quando o nome contém `#falha`. Não há conferência de CPF duplicado ao editar.
9. Modal **remover** ("Remover endereço"; descrição `Remover o endereço "<rua>"? Esta ação não pode ser desfeita. Os pedidos anteriores continuam com este endereço.`); se o endereço é o principal e existem outros: `<select>` "Novo endereço principal*" (opção "Selecione"), erro "Preencha este campo"; botões "Cancelar" e "Remover" (destrutivo); falha "Não foi possível remover o endereço. Tente de novo." (rua/complemento com `#falha`).
10. "Selecionar cliente" (rodapé da ficha): bloqueado com mensagem ao lado: Entrega sem endereço → "Adicione um endereço para entrega"; Entrega sem endereço escolhido → "Escolha o endereço de entrega". Ao clicar grava `selected` (`addressId` só em Entrega, `null` em Balcão), e **navega para `/`** (o aviso "Cliente selecionado para o pedido" é gravado mas a tela já saiu).
11. O tipo de pedido do `KindSwitch` desta tela é o **mesmo valor** do carrinho (`customerStore.kind`).

### 2.6 `/clientes/novo` (cadastro)
Campos (`NewCustomerFields`): Nome*; Telefone (placeholder "(00) 00000-0000"; ajuda "Informe ao menos o telefone ou o e-mail"); E-mail (`type=email`, mesma ajuda); CPF (placeholder "000.000.000-00"); "Data de nascimento" (placeholder "00/00/0000"). Endereço: CEP* (placeholder "00000-000"), UF* (`<select>` "Selecione" + 27 UFs ordenadas), Cidade*, Bairro*, "Endereço com número"*, Complemento (opcional).
- Sem `termo`, o telefone vem pré-preenchido com **"(19) 99000-1234"**. Com `termo`: `modo=nome` → Nome; `cpf` → CPF mascarado; senão Telefone mascarado.
- Salvar: valida (`validateNewCustomer`), simula 700 ms (spinner), grava, **seleciona** o cliente (`addressId` do primeiro endereço) e navega para `/clientes?cliente=<id>&cadastrado=true`, que abre a ficha com o aviso "Cliente cadastrado e selecionado para o pedido". Não volta direto ao PDV. "Cancelar" volta a `/clientes`.
- Duplicidade: alerta + botão **"Abrir ficha existente"** (vai para `/clientes?cliente=<id>`).
- CEP: ao completar 8 dígitos, 600 ms de espera com esqueleto em UF/Cidade/Bairro; achado: preenche UF, cidade, bairro e, se a rua estiver vazia, `"<rua do CEP>, "` (com vírgula, para o atendente digitar o número); não achado: alerta "CEP não encontrado. Preencha o endereço manualmente."; todos os campos continuam editáveis.

### 2.7 Tipo do pedido (Entrega, Balcão ou Delivery: qual nome vale?)
- Valor interno: `OrderKind = 'entrega' | 'balcao'` (`customer-store`), padrão **`'balcao'`** (isto contradiz o plano `.lovable/plan/clientes-...md`, que diz "Entrega (padrão)": no código, as telas `/clientes` abrem em **Balcão**).
- Valor do pedido: `OrderType = 'Balcão' | 'Delivery'` (`orders.ts`), convertido por `kindToType`/`typeToKind`. Teste `customers.test.ts` "tipo do pedido vem do carrinho: só Balcão e Delivery".
- **Nome na UI**: no PDV (carrinho, fechamento, sucesso, histórico, assistente "Pedido para Delivery.") vale **"Delivery"**; nas telas de cliente (`KindSwitch`) vale **"Entrega"**. Os dois controlam o mesmo valor. O `AGENTS.md` trata como o mesmo dado: "the customer screens' 'Tipo do pedido' switch and the POS cart selector drive that same value, and the checkout only displays it". Não existe "Retirada" (removida no commit `3161c29`, "remover Retirada").
- No fechamento o tipo é **somente leitura** ("Escolhido no carrinho").
- "Novo pedido" recoloca o tipo em Balcão.

### 2.8 Loja
- **Balcão**: `<select>` aria "Loja do pedido", opção vazia "Escolha a loja", lista `STORES_LIST` (3 lojas). Começa sem loja. A escolha fica guardada em `balcaoStore` mesmo se o usuário alternar para Delivery e voltar.
- **Delivery**: texto (ícone de loja) com a loja calculada do endereço escolhido (`orderStore`): selo "Automática" aparece sempre em Delivery. Sem cliente ou sem endereço: "Definida pelo endereço de entrega" (cinza). Endereço fora da área: "Nenhuma loja entrega neste endereço" (vermelho, negrito). Troca de endereço recalcula.
- Regra (`orderStore`): Balcão → loja escolhida, ou motivo `escolher`. Entrega → endereço selecionado (ou o principal) → `a.store ?? storeFor(a.cep)`; sem endereço → `sem-endereco`; sem loja → `fora-da-area`. Testes `orders.test.ts` "loja do pedido".
- "Finalizar pedido" fica desabilitado sem loja (título "Defina a loja do pedido").

### 2.9 Pagamento
- Seletor no carrinho (aria/for `cart-payment`): Dinheiro, Pix, Cartão de crédito, Cartão de débito. **Padrão Pix** (nunca fica "não escolhido"). Dinheiro mostra "Troco R$" (aria "Troco para"; `inputMode=decimal`).
- O valor vive no `customerStore` (`payment`, `changeFor`) e é copiado para o fechamento em `startCheckout`. No fechamento o usuário pode mudar o pagamento, mas isso **não volta** para o `customerStore`: ao "Voltar" e "Finalizar" de novo, o fechamento é reconstruído (`{...current, ...client, payment: clientStore.payment, changeFor, store}`), descartando edições de nome, endereço, telefone e pagamento feitas no fechamento.
- Não há pagamento parcial, divisão, cobrança, link, nota fiscal ou taxa de maquininha.

### 2.10 Fechamento / checkout
1. "Finalizar pedido" (`startCheckout`): sem cliente → aviso "Identifique o cliente para finalizar o pedido"; sem loja → "Defina a loja do pedido"; (na prática o botão desabilitado impede os dois). Abre `view = 'checkout'` e congela colunas 1 e 2.
2. `CheckoutPanel` ("Fechar pedido", "Dados do cliente e pagamento"), `<form noValidate>`: "Nome do cliente *" (editável, pré-preenchido); "Tipo do pedido" somente leitura com ícone + nome + "Escolhido no carrinho", e "Loja: <loja>"; **só Delivery**: "Endereço *" (textarea, texto plano do `formatAddress`) e "Telefone *" (editáveis); "Forma de pagamento"; "Troco para · opcional" (placeholder "R$", só Dinheiro); "Resumo do pedido" (linhas "N× <descrição>", "Obs.: ...", preço); rodapé com erro (`role=alert`), Subtotal, "Taxa de entrega" (Delivery), "Total final", botão "Confirmar pedido", "Voltar" (volta ao carrinho sem perder itens).
3. Qualquer edição de campo limpa a mensagem de erro.
4. "Confirmar pedido" (`confirmOrder`): tem guarda `if (view !== 'checkout') return`; valida (`validateCheckout`); se erro, mostra no rodapé; se ok, `createOrder`, empilha em `orders`, guarda `confirmed` e `view = 'success'`.

### 2.11 Tela de sucesso
`SuccessPanel`: "Pedido confirmado" + `#0001` (4 dígitos com zeros); ícone de check; número; nome; "<Tipo> · <Pagamento>"; "Loja: <loja>"; em Delivery, endereço e telefone; resumo dos itens; "Taxa de entrega" se > 0; se houve troco, "Troco para R$ X · devolver R$ Y" (Y = troco − total); "Total final"; botão **"Novo pedido"**.

### 2.12 Novo pedido
`newOrder()`: zera carrinho e conversa (`resetSession`), configurador, busca, avisos, destaque, fechamento; `view = 'cart'`, aba Pizzas; `customerStore.set({selected: null, kind: 'balcao', balcaoStore: null, payment: 'Pix', changeFor: ''})`. **Mantém o histórico do dia** e o contador. A lista de clientes (incluindo cadastros novos) é mantida.
Existe um segundo botão "Novo pedido" no cabeçalho do chat: título "Limpar conversa, mantendo o carrinho"; só limpa a conversa (`reset` do `ChatPanel`), não o pedido. Mesmo rótulo, efeito diferente.

### 2.13 Histórico / "Pedidos do dia"
- Botão "Pedidos do dia" no topo, disponível em qualquer vista; lembra de onde veio (`historyReturn`) e "Voltar ao pedido" volta para lá (carrinho, fechamento ou sucesso).
- `HistoryPanel`: título "Pedidos do dia" com "N pedido(s)"; **todos** os pedidos da sessão cujo dia no fuso `America/Sao_Paulo` é hoje (`ordersForDay`), **do mais recente ao mais antigo**; sem limite nem paginação. Cada cartão: `#0001 · <nome>`, hora (`HH:mm`), "<Tipo> · <Pagamento> · <Loja>", em Delivery endereço · telefone, resumo dos itens, "Entrega: R$ x", "Troco para R$ x", "Total". Vazio: "Nenhum pedido hoje".
- É global do dia e da sessão do navegador; **não é por cliente**. Sem filtro, sem detalhe, sem reabrir, sem cancelar.

### 2.14 Assistente (chat) e voz
Ver seção 6 para as intenções. Fluxo de UI:
1. Cabeçalho "Assistente / Simulação", botão "Novo pedido" (limpa conversa). Vazio: "Olá! O que vamos pedir?" (ícone de balão com brilho).
2. Mensagem do usuário aparece; campo desabilita; indicador `role=status` "digitando..." (três pontos) por **1000 ms** fixos de atraso artificial; então `sendMessage` responde.
3. Resposta: texto + para cada item adicionado um resumo "✓ Adicionado" + descrição + preço; botões "Adicionar <produto> · R$ menor preço" (busca); botão "Cadastrar novo cliente"; **respostas rápidas** (perguntas) desabilitadas se `busy` ou se a mensagem não é a última.
4. Ações são aplicadas por `applyActions`: busca atualiza a coluna 2; ações de jornada atualizam o `customerStore`, com destaque de 2 s nas regiões (cliente/tipo/loja/pagamento: classe `assistant-flash`) e aviso "Pedido atualizado pelo assistente"; itens entram no carrinho com `origin: 'ia'`, destacados e aviso "Item do assistente adicionado ao pedido". Só aplica quando `view === 'cart'` (busca é exceção).
5. Se a pergunta anterior tinha `contexto` e o usuário digita só `p|m|g|gg`, o texto enviado vira `<contexto>, tamanho <x>` (continua a pizza).
6. **Voz** (`use-speech-input.ts`): só aparece o botão de microfone (aria "Ativar microfone"/"Parar microfone", título "Ditado por voz"/"Parar microfone") se o navegador tem `SpeechRecognition`/`webkitSpeechRecognition` (detectado após hidratar). `lang = 'pt-BR'`, `interimResults = true`, `continuous = false`. A transcrição vai para o campo de texto (prefixo digitado + transcrito) e **não envia sozinha**. Indicador "Ouvindo..." com ponto pulsante. Erros: `not-allowed`/`service-not-allowed` → "Permita o uso do microfone no navegador."; `no-speech` → "Nenhuma fala detectada. Tente novamente."; `aborted` → vazio; outros → "Não foi possível transcrever. Tente novamente ou digite o pedido."; falha ao iniciar → "Não foi possível iniciar o microfone. Tente novamente.". A voz para ao enviar, ao desabilitar (fechar pedido) e ao limpar a conversa. `roadmap.md`: "Validar transcrição com microfone físico no Chrome" está **desmarcado** (só testado com resultados simulados, `speech-input.test.tsx`).
7. Erro do envio: "A resposta não chegou. Tente enviar novamente." (o mock nunca lança).

---

## 3. Regras de negócio exatas

### 3.1 Preço (`menu.ts`, `unitPrice`)
- Preço base = `product.prices[size]`.
- **Meio a meio** (somente pizza com `half=true`): preço base = `max(preço do 1º sabor no tamanho, preço do 2º sabor no tamanho)` (`pdv.test.ts`: G calabresa + portuguesa = 56; `aiService.test.ts`: G mussarela + calabresa = 50). Máximo de **dois** sabores. Sem segundo sabor o preço usa só o primeiro, mas o botão fica desabilitado.
- **Adicionais** (só pizza): soma `preço × quantidade` de cada adicional, **sobre a pizza inteira** (não por metade): "bacon soma ao preço da pizza inteira e respeita quantidade" (G meio a meio portuguesa + bacon×2 = 56 + 16 = 72). Em não-pizzas os extras são ignorados.
- **Remover ingrediente não altera o preço** (`pdv.test.ts`: G calabresa sem cebola = 50). Aparece na descrição "(sem cebola)".
- Total da linha = `unitPrice × quantity`; `cartTotal` = soma. Exemplo de teste: G meio a meio portuguesa + bacon + sem cebola = R$ 64; ×2 = 128; trocar para GG = 152.
- Bebidas e sobremesas: preço fixo por tamanho; sem extras.
- Produtos "lanches": um preço ("Unidade").
- Moeda: `Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'})` (ex.: "R$ 8,50").

### 3.2 Taxa de entrega
`deliveryFee(type)` = **R$ 8,00 fixo se `Delivery`**, R$ 0 se Balcão (`orders.ts`; teste "só existem Balcão e Delivery; delivery soma exatamente R$ 8,00": G calabresa 50 + 8 = 58). Mostrada já no carrinho ("Taxa de entrega") e no fechamento. Sem faixa por distância, sem frete grátis, sem tempo estimado.

### 3.3 Validações do checkout (`validateCheckout`, ordem exata e mensagens)
1. `customerId` vazio → "Identifique o cliente para finalizar o pedido."
2. `name` vazio ou só espaços → "Informe o nome do cliente."
3. `store` vazio → "Defina a loja do pedido."
4. carrinho vazio → "Adicione um item ao pedido."
5. Delivery e (endereço vazio **ou** telefone vazio) → "Informe o endereço e o telefone para delivery."
6. Pagamento Dinheiro **e** troco preenchido: `parseChange` = `Number(valor.trim().replace(',', '.'))` (só troca a primeira vírgula; "R$ 100" e "1.000,50" viram `NaN`); se não for finito **ou** menor que o **total final (inclui a taxa)** → "O valor para troco deve ser igual ou maior que o total."
Troco vazio é aceito (sem troco). Troco só vale para Dinheiro: `createOrder` zera `changeFor` e grava `null` para outras formas; para Dinheiro sem valor, `changeFor = null`.
Consequência: cliente cadastrado só com e-mail (telefone vazio) em Delivery trava no passo 5 até digitar um telefone no campo do fechamento.

### 3.4 Pedido criado (`createOrder`)
`number` = maior número do histórico + 1 (contador da sessão, nunca reinicia com "Novo pedido"); `createdAt` ISO; `customer` (id, nome aparado, tipo, endereço e telefone **só se Delivery**, pagamento, troco, loja); `items` clonados (preservam `origin`); `subtotal`, `deliveryFee`, `total`, `changeFor` numérico ou `null`. Número exibido `#` + 4 dígitos. **Não grava**: origem (telefone/balcão), atendente, observação geral, endereço estruturado (só a string), tempo estimado.

### 3.5 Cliente, endereço, CPF, data, duplicidade (`customers.ts`)
- **CPF**: 11 dígitos, rejeita todos iguais, confere os dois dígitos verificadores (válidos de teste: 529.982.247-25 e 111.444.777-35; 529.982.247-26 inválido; 111.111.111-11 inválido).
- **Data**: `dd/mm/aaaa`, calendário real (31/02 inválida), ano ≥ 1900, **não pode ser futura** (`isValidDate`).
- **E-mail**: regex `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`.
- **Telefone**: máscara `(00) 00000-0000`; válido com ≥ 10 dígitos (DDD obrigatório). Um telefone de 10 dígitos aparece mascarado como `(19) 98765-432` (a máscara é só de celular).
- **Cadastro** (`validateNewCustomer`): Nome obrigatório ("Informe o nome"); telefone **ou** e-mail ("Informe ao menos o telefone ou o e-mail", nos dois campos); telefone preenchido com < 10 dígitos "Informe o telefone com DDD"; "E-mail inválido"; "CPF inválido"; "Data inválida". Endereço: em **Entrega** os 5 campos obrigatórios (CEP, UF, cidade, bairro, endereço com número) com "Preencha este campo", CEP com ≠ 8 dígitos "Informe o CEP com 8 dígitos"; em **Balcão** só se começar a preencher (qualquer campo, inclusive Complemento) vale a validação inteira (teste: CEP "1306" em balcão acusa "Informe o CEP com 8 dígitos").
- **Duplicidade**: compara os dígitos de CPF e de telefone com todos os clientes; CPF tem prioridade sobre telefone; **e-mail e nome não são conferidos**. Bloqueia o cadastro e oferece abrir o existente.
- **Endereço principal**: o primeiro endereço de um cliente vira principal; "Tornar principal" move o selo (um só principal); remover o principal com outros exige escolher o novo (`removeAddress` lança "Escolha o novo endereço principal").
- Alterar endereço recalcula a loja pelo CEP. Pedidos antigos guardam o endereço como texto, então não mudam.
- `formatAddress`: `<rua>[ — <complemento>] — <bairro>, <cidade>/<UF>`.
- Editar cliente: só nome (obrigatório), CPF (opcional, validado), nascimento (opcional, validado). Telefone e e-mail não editáveis.
- Gatilho de falha de gravação no mock: texto contendo `#falha`.

### 3.6 CEP → loja (`customers.ts`: `STORES`, `storeFor`, `CEPS`, `lookupCep`)
Mapa explícito (dígitos): 13060000 → Bella Capri Cambuí; 13010000 → Bella Capri Centro; 13025001 → Bella Capri Cambuí; 13026000 → Bella Capri Cambuí; 13825000 → **sem loja** (Holambra, zona rural). Qualquer outro CEP que **comece por `130`** → Bella Capri Centro; todo o resto → sem loja ("Nenhuma loja entrega neste endereço"). A loja "Bella Capri Taquaral" só existe para Balcão. A consulta de CEP (`lookupCep`) só conhece 5 CEPs (tabela na seção 5); qualquer outro → "CEP não encontrado".

### 3.7 O que bloqueia "Finalizar pedido" (`index.tsx`, botão `.checkout`)
`disabled = !cart.length || !client || !storeInfo.store`. Títulos: "Pedido vazio", "Identifique o cliente para finalizar", "Defina a loja do pedido", "Fechar pedido". Quando não há cliente aparece também o texto "Identifique o cliente para finalizar o pedido no campo acima (F2)". Entrega: sem endereço ou fora da área = sem loja = bloqueado. Itens, cliente e loja são as únicas travas; **não** há trava por pagamento, nem por telefone/endereço (essas só no "Confirmar pedido").

### 3.8 Outras regras
- Quantidade: inteiro ≥ 1 (`parseQuantity`: `^\d+$` e > 0; "1.5", "0" e "" inválidos; teste `search.test.ts`).
- Fuso do histórico: dia civil de São Paulo (teste `orders.test.ts` "histórico do dia usa data de São Paulo").
- Busca de produto: nome, descrição, código e ingredientes, sem acento, "contém" (`searchProducts`); termo vazio → lista vazia. "frango" retorna mais de 12 itens e 3 páginas (teste).
- O assistente nunca confirma o pedido (não existe ação de confirmar). `AGENTS.md`: "the attendant always finalizes from the cart".

---

## 4. Textos de interface exatos (pt-BR), por tela

### 4.1 PDV `/`
- Topbar: "forno." / "PDV PIZZARIA" / "Balcão aberto" / "Clientes" / "Pedidos do dia" / "Atendente".
- Painel de montagem: títulos "Montar pedido" / "Editar item"; subtítulos "Escolha os produtos para o pedido" / "Personalize do jeito do cliente"; abas "Pizzas", "Bebidas", "Sobremesas"; seções "Nossas pizzas", "Bebidas", "Sobremesas", "N opções"; "A partir de"; aria "Montar <nome>"; "Voltar ao cardápio"; "Tamanho"; "Sabores", "1 sabor", "Meio a meio"; "Segundo sabor", "Selecione o segundo sabor"; "Ingredientes", "Primeira metade · X", "Segunda metade · X"; "Adicionais", "+ R$ x"; "Observação" + "· opcional", placeholder "Ex.: pizza bem passada"; "Quantidade"; "Valor do item", "Valor atualizado"; "Adicionar ao carrinho", "Salvar alterações"; rodapé "Cardápio de exemplo".
- Avisos (`notice`): "Produto adicionado ao carrinho"; "<nome> <tamanho> adicionado"; "Item atualizado"; "Item adicionado ao pedido"; "Pedido limpo"; "Pedido atualizado pelo assistente"; "Item do assistente adicionado ao pedido"; "Cliente: <nome>"; "Cliente cadastrado: <nome>"; "Identifique o cliente para finalizar o pedido"; "Defina a loja do pedido".
- Busca: placeholder "Busque por nome, código ou ingrediente"; aria "Buscar produtos", "Limpar busca"; "Buscar"; "Digite algo para buscar"; "N produto(s) encontrado(s) para "termo""; "Adicionar ao carrinho"; "Anterior", "Página X de Y", "Próxima"; "Nenhum produto encontrado para "termo". Tente outro termo."; "Não foi possível consultar os produtos agora."; "Tentar de novo"; aria "Produto sem foto".
- Quantidade: "<nome>", "R$ x por unidade", "Quantidade", "Diminuir quantidade", "Aumentar quantidade", "Informe uma quantidade maior que zero", "Não foi possível adicionar o produto. Tente de novo.", "Cancelar", "Adicionar".
- Carrinho: "Pedido atual"; "Seu pedido começa aqui"; "N item no pedido"/"N itens no pedido"; campo "Cliente: telefone, nome ou CPF (F2)"; "Nenhum cliente encontrado"; "Cadastrar novo cliente"; "Trocar cliente"; "Sem endereço para entrega"; "Trocar endereço"; "Adicionar"; "· principal"; "Novo endereço"; "Tipo do pedido", "Balcão", "Delivery"; "Loja", "Automática", "Escolha a loja", "Definida pelo endereço de entrega", "Nenhuma loja entrega neste endereço"; "Pagamento", "Dinheiro", "Pix", "Cartão de crédito", "Cartão de débito", placeholder "Troco R$"; vazio: "Nenhum produto no carrinho" / "Seu carrinho está vazio"; "N × R$ x"; "Obs.: ..."; "Editar"; "Remover item"; "Subtotal"; "Taxa de entrega"; "Total do pedido"; "Identifique o cliente para finalizar o pedido no campo acima (F2)"; "Finalizar pedido"; "Limpar pedido"; "Limpar todos os itens do pedido?"; "Cancelar"; "Sim, limpar"; "Pedido em montagem".
- Diálogos do carrinho: "Cadastrar cliente" (rodapé "Cancelar" / "Salvar e usar no pedido"); "Já existe um cliente com este CPF." / "...com este telefone." + "Usar cliente existente"; "Não foi possível cadastrar o cliente. Tente de novo."; "Novo endereço" ("Cancelar" / "Salvar e usar").
- Fechamento: "Fechar pedido"; "Dados do cliente e pagamento"; "Nome do cliente *"; "Tipo do pedido"; "Escolhido no carrinho"; "Loja: X"; "Endereço *"; "Telefone *"; "Forma de pagamento"; "Troco para" + "· opcional" (placeholder "R$"); "Resumo do pedido"; "Subtotal"; "Taxa de entrega"; "Total final"; "Confirmar pedido"; "Voltar". Erros: ver 3.3.
- Sucesso: "Pedido confirmado"; "#0001"; "<Tipo> · <Pagamento>"; "Loja: X"; "Taxa de entrega"; "Troco para R$ X · devolver R$ Y"; "Total final"; "Novo pedido".
- Histórico: "Pedidos do dia"; "N pedido(s)"; "#0001 · <nome>"; "<Tipo> · <Pagamento> · <Loja>"; "Entrega: R$ x"; "Troco para R$ x"; "Total"; "Nenhum pedido hoje"; "Voltar ao pedido".
- Assistente: "Assistente"; "Simulação"; "Novo pedido" (título "Limpar conversa, mantendo o carrinho"); "Olá! O que vamos pedir?"; aria "Conversa com o assistente", "Mensagem para o assistente"; placeholder "Digite o pedido..."; "Adicionado"; "digitando..."; "Ouvindo..."; "Ativar microfone"/"Parar microfone"/"Ditado por voz"; "Enviar mensagem"; "Adicionar <produto> · R$ x"; "Cadastrar novo cliente"; "A resposta não chegou. Tente enviar novamente."; erros de voz (seção 2.14). Mensagens do mock na seção 6.

### 4.2 `/clientes`
"Identificar cliente"; "Voltar ao PDV"; "Tipo do pedido"; "Entrega"; "Balcão"; "Cliente: <nome>"; "Atendente: Marina Souza"; "Buscar por"; "Telefone", "Nome", "CPF"; placeholders "Digite o telefone"/"Digite o nome"/"Digite o CPF"; "Buscar"; "Cadastrar cliente novo"; "Digite um telefone, nome ou CPF para buscar o cliente"; "Carregando"/"Carregando ficha" (aria dos esqueletos); "Não foi possível buscar o cliente agora." + "Tentar de novo"; `Nenhum cliente encontrado para "termo".`; "N cliente(s) encontrado(s) para "termo""; "Sem endereço cadastrado"; "Nenhum cliente selecionado"; "Dados pessoais"; "Editar dados"; rótulos "Nome", "Telefone", "E-mail", "CPF", "Data de nascimento" (vazio "—"); "Endereços (N)"; "Adicionar endereço"; "Este cliente ainda não tem endereço"; "Principal"; "Usar neste pedido"; "Loja de entrega: X"; "Nenhuma loja entrega neste endereço"; "CEP x"; "Alterar"; "Remover"; "Tornar principal"; "Adicione um endereço para entrega"; "Escolha o endereço de entrega"; "Selecionar cliente"; "Cliente selecionado para o pedido"; "Cliente cadastrado e selecionado para o pedido". Modais: seção 2.5. Erros de campo: "Informe o telefone com DDD"; "CPF inválido"; "Digite algo para buscar"; "Preencha este campo"; "Informe o CEP com 8 dígitos"; "Informe o nome"; "Data inválida"; "Não foi possível salvar. Tente de novo."; "Não foi possível remover o endereço. Tente de novo.".

### 4.3 `/clientes/novo`
"Cadastrar cliente"; "Pedido de entrega: o endereço é obrigatório"; "Pedido de balcão: o endereço é opcional"; "Dados pessoais"; "Nome*"; "Telefone" ("(00) 00000-0000"); "E-mail"; "CPF" ("000.000.000-00"); "Data de nascimento" ("00/00/0000"); "Informe ao menos o telefone ou o e-mail"; "Endereço"; "Obrigatório"/"Opcional"; "CEP*" ("00000-000"); "UF*" ("Selecione"); "Cidade*"; "Bairro*"; "Endereço com número*"; "Complemento"; "CEP não encontrado. Preencha o endereço manualmente."; "Já existe um cliente com este CPF."/"...telefone."; "Abrir ficha existente"; "Não foi possível cadastrar o cliente. Tente de novo."; "Cancelar"; "Salvar cliente".

---

## 5. Dados de exemplo

### 5.1 Cardápio (`menu.ts`, `products`; códigos = 101 + posição, `products.forEach`)
| Cód | id | Nome | Categoria | Preços | Ingredientes | Descrição |
|---|---|---|---|---|---|---|
| 101 | mussarela | Mussarela | pizzas | P 28, M 38, G 48, GG 58 | Mussarela, Molho de tomate, Orégano, Azeitona | O clássico que todo mundo ama |
| 102 | calabresa | Calabresa | pizzas | P 30, M 40, G 50, GG 60 | Calabresa, Cebola, Mussarela, Molho de tomate, Orégano | Calabresa, cebola e mussarela |
| 103 | portuguesa | Portuguesa | pizzas | P 34, M 44, G 56, GG 68 | Presunto, Ovo, Cebola, Azeitona, Mussarela, Molho de tomate | Presunto, ovos e azeitonas |
| 104 | frango | Frango com Catupiry | pizzas | P 34, M 44, G 56, GG 68 | Frango, Catupiry, Mussarela, Molho de tomate, Orégano | Frango desfiado e Catupiry cremoso |
| 105 | marguerita | Marguerita | pizzas | P 32, M 42, G 52, GG 64 | Mussarela, Tomate, Manjericão, Molho de tomate | Tomate fresco e manjericão |
| 106 | queijos | Quatro Queijos | pizzas | P 36, M 46, G 58, GG 70 | Mussarela, Provolone, Parmesão, Gorgonzola, Molho de tomate | Uma combinação de quatro queijos |
| 107 | pepperoni | Pepperoni | pizzas | P 36, M 46, G 58, GG 70 | Pepperoni, Mussarela, Molho de tomate, Orégano | Pepperoni e mussarela derretida |
| 108 | chocolate | Chocolate | pizzas | P 30, M 40, G 50, GG 62 | Chocolate, Granulado, Leite condensado | Chocolate ao leite e granulado |
| 109 | coca | Coca-Cola | bebidas | Lata 6, 600ml 9, 2L 14 | — | Refrigerante |
| 110 | guarana | Guaraná | bebidas | Lata 6, 600ml 8, 2L 12 | — | Refrigerante |
| 111 | suco | Suco Del Valle | bebidas | Lata 7, 1L 12 | — | Suco de fruta |
| 112 | agua | Água | bebidas | 500ml 4 | — | Água mineral |
| 113 | petit | Petit Gâteau | sobremesas | Individual 16, Família 48 | — | Chocolate com sorvete de baunilha |
| 114 | pudim | Pudim | sobremesas | Individual 10, Família 35 | — | Pudim de leite com calda de caramelo |
| 115 | mousse | Mousse de Maracujá | sobremesas | Individual 10, Família 32 | — | Leve, cremoso e feito com maracujá |
| 116 | suco-laranja | Suco de Laranja 500 ml | bebidas | Unidade 9 | Laranja | Suco natural de laranja. |
| 117 | x-frango | X-Frango Grelhado | lanches | Unidade 24,90 | — | Pão brioche, filé de frango grelhado, queijo prato, alface e tomate. |
| 118 | coxinha | Coxinha de Frango com Catupiry | lanches | Unidade 8,50 | — | Massa de batata recheada com frango desfiado e catupiry. |
| 119 | caesar | Salada Caesar com Frango | lanches | Unidade 29 | — | Alface americana, frango em tiras, croutons, parmesão e molho caesar. |
| 120 | torta-frango | Torta de Frango com Palmito Fatia Média Assada no Forno a Lenha | lanches | Unidade 16,75 | — | (texto longo de ~290 caracteres: massa amanteigada, frango, palmito, milho, ervilha, azeitona, requeijão, muçarela) |
| 121 | wrap-frango | Wrap de Frango Defumado (`noPhoto`) | lanches | Unidade 21,40 | — | Tortilha integral com frango defumado, cream cheese e rúcula. |
| 122 | pastel-frango | Pastel de Frango | lanches | Unidade 9,90 | — | Pastel frito com recheio de frango temperado. |
| 123 | esfiha-frango | Esfiha de Frango | lanches | Unidade 7,50 | — | Esfiha aberta de frango com requeijão. |
| 124 | natural-frango | Sanduíche Natural de Frango | lanches | Unidade 14,90 | — | Pão integral, frango, cenoura ralada e maionese leve. |
| 125 | empada-frango | Empada de Frango | lanches | Unidade 8 | — | Massa podre com frango e azeitona. |
| 126 | passarinho | Frango a Passarinho | lanches | Unidade 32 | — | Porção de frango frito com alho. |
| 127 | burger-frango | Hambúrguer de Frango Empanado | lanches | Unidade 26,50 | — | Frango empanado crocante, queijo e molho especial. |
| 128 | quesadilla | Quesadilla de Frango | lanches | Unidade 22 | — | Tortilha com frango, queijo e pimentão. |
| 129 | caldo-frango | Caldo de Frango | lanches | Unidade 15 | — | Caldo cremoso de frango com legumes. |

Totais: 29 produtos; 8 pizzas (teste `pdv.test.ts`); 5 bebidas; 3 sobremesas; 13 lanches (os lanches não aparecem nas abas, só pela busca e pelo assistente). Fotos: só as 8 pizzas têm `photo` 0 a 7, via sprite `src/assets/pizzas.jpg` (1536x768); os demais usam ícone. `.lovable/plan/busca-...md` afirma que os 8 lanches "frango" extras foram inventados para forçar 3 páginas ("Você pode trocar pelos itens reais depois"); também descreve "Suco de Laranja 500 ml" e os cinco itens do documento de consulta (X-Frango, Coxinha, Salada Caesar, Torta, Wrap).

**Adicionais** (só pizza; preço fixo, `extras`): Bacon 8, Catupiry 8, Cheddar 8, Azeitona 4, Ovo 4, Borda de Catupiry 12, Borda de Cheddar 12. Teste: todos entre R$ 4 e R$ 12.

### 5.2 Lojas
`STORES_LIST` (`customers.ts`): "Bella Capri Centro", "Bella Capri Cambuí", "Bella Capri Taquaral" (a Taquaral é "exemplo", plano `loja-responsável...md`). Nenhum CEP de entrega mapeia para Taquaral.

### 5.3 Clientes e endereços (`sampleCustomers`)
| id | Nome | Telefone | E-mail | CPF | Nasc. | Endereços |
|---|---|---|---|---|---|---|
| c1 | Maria Oliveira | (19) 99876-5432 | maria.oliveira@email.com | 529.982.247-25 | 14/03/1988 | a1 (principal): Rua das Acácias, 120 / Apto 32, bloco B / Jardim Primavera / Campinas / SP / 13060-000 → Cambuí; a2: Avenida Brasil, 1500 / Centro / Campinas / 13010-000 → Centro; a3: Estrada Municipal do Rio Pequeno, km 7, Sítio Recanto das Palmeiras, portão azul ao lado do mercado / Zona Rural / Holambra / 13825-000 → **sem loja** |
| c2 | Maria de Fátima Albuquerque Nascimento Souza dos Santos | (19) 98123-4567 | — | — | — | a4 (principal): Rua Coronel Quirino, 880 / Cambuí / Campinas / 13025-001 → Cambuí |
| c3 | Mariana Lopes | (19) 99701-2233 | — | — | — | a5 (principal): Rua Dr. Sampaio Ferraz, 45 / Bosque / Campinas / 13026-000 → Cambuí |
| c4 | João Pereira Lima | (19) 99333-1100 | joao.lima@email.com | — | — | nenhum |
Todas as UF são "SP". Testes: `nome "maria"` → 3 resultados; telefone/CPF → 1.

### 5.4 Mapa CEP → loja e consulta de CEP
| CEP | `lookupCep` (UF / cidade / bairro / rua) | `storeFor` |
|---|---|---|
| 13060-000 | SP / Campinas / Jardim Primavera / Rua das Acácias | Bella Capri Cambuí |
| 13010-000 | SP / Campinas / Centro / Avenida Brasil | Bella Capri Centro |
| 13025-001 | SP / Campinas / Cambuí / Rua Coronel Quirino | Bella Capri Cambuí |
| 13026-000 | SP / Campinas / Bosque / Rua Dr. Sampaio Ferraz | Bella Capri Cambuí |
| 13825-000 | SP / Holambra / Zona Rural / (sem rua) | sem loja |
| `130xxxxx` não listado | CEP não encontrado | Bella Capri Centro |
| qualquer outro (ex.: 99999-999) | CEP não encontrado | sem loja |

---

## 6. Assistente (`aiService.ts`; mock por regex, sem IA)

Contrato (comentário no código): "The UI consumes this contract only. Replace the implementation here for a real AI later." `sendMessage(texto, carrinhoAtual, contexto: AIContext) → { mensagem, acoes[] }`. `AIContext = { customers: Customer[] (completos, com CPF/telefone/e-mail), selected, kind, balcaoStore }`. Texto é normalizado (sem acento, minúsculo) antes do parse.

### 6.1 Ações tipadas (`AIAction`)
`adicionar_item {item}`, `remover_item {id}`, `pergunta {respostas[{label,text}], contexto?}`, `buscar {termo, produtos[ids]}`, `identificar_cliente {customerId, addressId|null}`, `cadastrar_cliente {termo}`, `definir_tipo {kind}`, `definir_loja {store}`, `definir_endereco {addressId}`, `definir_pagamento {payment, changeFor}`. **Não existe** ação `pendencias` (o plano `.lovable/plan/jornada-completa...md` a lista, mas no código "O que falta?" é resposta de texto); não existe ação de confirmar, editar quantidade, observação, desfazer nem aplicar desconto.

### 6.2 Como a frase é interpretada
1. `splitSegments` divide a frase em trechos (vírgula, ponto e vírgula, " e " antes de `um|uma|dois|duas|tres|\d|no|na|pra|para|cliente|pagamento|paga|delivery|entrega|balcao|loja`; antes de "pra/para/pro/cliente"; antes de "pix/dinheiro/cartao"; trechos que começam por `tamanho|metade|meia|meio|sem|com|troco` colam no anterior).
2. Um trecho: `journeyReply ?? itemReply`. Vários: processa cada trecho em ordem, atualizando um contexto simulado (`applyToContext`) e carrinho temporário; a mensagem final junta, por trecho, "<descrição>, ... adicionado." (itens) ou a mensagem do trecho; só **a primeira pergunta** é mantida.
3. `journeyReply`, na ordem de precedência:
   - **"O que falta?"** (`o que falta|falta algo|fechar|finalizar|pode fechar`): `pendingForCheckout`; se vazio → `Tudo pronto! Confira o carrinho e clique em "Finalizar pedido".`; senão `Para finalizar, falta: <itens separados por "; ">.` (com botões de loja quando falta loja). Pendências, nesta ordem: "Identificar o cliente"; "Escolher a loja" (Balcão sem loja); "Informar o endereço de entrega" (Entrega, cliente sem endereço); "Trocar o endereço: nenhuma loja entrega nele"; "Adicionar itens". **Pagamento nunca é pendência.**
   - **Pagamento** (`pix`, `credito`, `debito`, `dinheiro`, exceto se o trecho cita pizza/coca/guaraná/refri): `Pagamento: <forma>[, troco para R$ <valor>].` → `definir_pagamento`. Troco só para dinheiro, via `troco (para|pra|de) [r$] N[,NN]`.
   - **Delivery** (`delivery|entrega|entregar`, sem "endereco" nem "entregar na/no/em"): `Pedido para Delivery.` → `definir_tipo entrega`.
   - **Balcão** (`balcao|retirada|retirar|retira|vai buscar`): `definir_tipo balcao`; sem loja escolhida: "Pedido para Balcão. Qual loja?" + botões das 3 lojas (texto `loja <nome>`); com loja: "Pedido para Balcão.".
   - **Loja** (nome parcial sem "Bella Capri" mais `loja|na|no|unidade`): `Loja: <nome>.` → `definir_tipo balcao` + `definir_loja`.
   - **Endereço** (`outro endereco|trocar endereco|trocar o endereco|endereco|entregar na/no/em`): sem cliente → "Identifique o cliente primeiro para escolher o endereço."; achou o endereço do cliente que contém o texto (≥ 3 letras) → `Entrega em <endereço>.` (`definir_tipo entrega` + `definir_endereco`); cliente sem endereço → `<nome> não tem endereço cadastrado. Inclua um em "Trocar endereço" no carrinho.`; senão "Qual endereço de entrega?" com um botão por endereço (rótulo = rua).
   - **Cliente** (`cliente|cpf|telefone|fone|pra|para|pro` + termo, ou só dígitos ≥ 8): busca rápida; **um resultado** (ou nome exato único) → `Cliente: <nome>.` → `identificar_cliente` (endereço principal só se o tipo atual é entrega); **vários** → "Encontrei mais de um cliente. Qual deles?" com botões "<nome> · <telefone>" (texto `cliente <telefone>`); **nenhum** (e houve palavra de cliente ou só dígitos) → `Nenhum cliente encontrado para "<termo>".` + ação `cadastrar_cliente` (botão "Cadastrar novo cliente").
4. `itemReply`/`itemCore` (quando a jornada não pegou o trecho):
   - **Quantidade inicial** `\d{1,2}` ou `um|uma|dois|duas|tres|quatro|cinco|seis`; para um único produto simples, adiciona direto com a quantidade.
   - **Busca** (verbos `buscar|busque|procurar|pesquisar|consultar|mostrar|listar|encontrar|achar` e variações, ou "tem/tens/vocês têm/existe [algo com] X"): `Encontrei N produto(s) para "termo":` + até **6** botões "Adicionar <produto> · R$ menor preço" (abrem a janela de quantidade/configurador); sem resultado: `Nenhum produto encontrado para "termo". Tente outro termo.`
   - **Remover** (`remova|remover|retire|tirar`): casa o nome do produto no carrinho; um só → `Removido: <descrição>.` (`remover_item`); vários → "Há mais de um item desse tipo. Qual deseja remover?"; nenhum → "Qual item do pedido deseja remover?" (pergunta sem botões).
   - **Refrigerante** (`refri|refrigerante|coca|guarana`): com tamanho (`2l`, `lata`, `600ml`) e marca → adiciona "Adicionado ao pedido!"; senão "Qual refrigerante e tamanho?" com botões "Coca-Cola 2L", "Guaraná 2L", "Coca-Cola Lata" (testado).
   - **Pizza**: identifica sabores pelo nome (e aliases: `frango` → Frango com Catupiry; `muçarela|mucarela|mozarela` → Mussarela); `meia|meio|metade|1/2|½` ativa meio a meio; só **um sabor** com meio a meio → "Qual será o segundo sabor?" (botões com as outras 7 pizzas); **mais de dois** sabores → "Escolha dois sabores para a pizza meio a meio."; sem tamanho (`p|pequena`, `m|media`, `g|grande`, `gg|gigante`) → "Qual tamanho da pizza?" com botões P, M, G, GG; completo → "Adicionado ao pedido!". Extras/remoções reconhecidos: **somente** "sem cebola" (remove Cebola dos sabores que a têm) e "com bacon" (1 bacon).
   - **Fallback**: tira palavras de enchimento (`quero|queria|gostaria|de|me|um|uma|por favor`...), e se o resto (≥ 3 letras, tentando também sem "s" final) bate em produtos → resposta de busca; senão **"Não entendi, pode reformular?"** (sem ações; "entrada desconhecida não altera o carrinho", teste).

### 6.3 Frases aceitas comprovadas por teste
- `pizza meio mussarela meio calabresa` → pergunta tamanho (P, M, G, GG); resposta "G" → meio a meio G, R$ 50 (`aiService.test.ts`).
- `pizza G meio <A> meio <B>` para todas as combinações das 8 pizzas, qualquer ordem; preço = maior dos dois.
- `pizza grande meia/metade mussarela meia/metade calabresa sem cebola com bacon` → remove cebola da calabresa; R$ 58.
- `pizza G meio mussarela` → pergunta segundo sabor.
- `uma pizza grande de calabresa sem cebola` → G, R$ 50.
- `meia portuguesa meia frango com catupiry, tamanho G, com bacon` → R$ 64.
- `um refri` → botões "Coca-Cola 2L", "Guaraná 2L", "Coca-Cola Lata".
- `uma pizza de mussarela` → pergunta tamanho (nunca adiciona sem tamanho).
- `remover calabresa` → remove o item único; com dois iguais não remove.
- `cliente Maria Oliveira` → identifica `c1`; `cliente maria` → só pergunta; `cliente Zuleica Fictícia` → `cadastrar_cliente` com termo `zuleica ficticia`.
- `vai retirar` → Balcão + pergunta da loja; `loja cambui` → `definir_loja` "Bella Capri Cambuí".
- `dinheiro, troco para 100` → `definir_pagamento Dinheiro, "100"`.
- `delivery pra Maria Oliveira, uma calabresa G e uma coca 2L no pix` → `[definir_tipo, identificar_cliente (com addressId), adicionar_item, adicionar_item, definir_pagamento]`, sem "Não entendi".
- `2 cocas lata` → Coca Lata ×2; `3 coxinhas` → coxinha ×3.
- `buscar frango`, `quero buscar frango`, `Buscar Frango!`, `busca: frango`, `mostre os produtos de frango` → busca "frango"; `quero uma coxinha` → resultado com a coxinha.
- Qualquer texto com a palavra "frango" e **sem** verbo de busca é lido como a pizza Frango com Catupiry (alias em `itemCore`): risco de interpretação, não coberto por teste.

### 6.4 O que o assistente NÃO faz
Confirmar/finalizar pedido; cadastrar o cliente por completo (só oferece o botão que abre o cadastro); editar a ficha; mudar quantidade de item existente; adicionar observação ou ingrediente além de "sem cebola"/"com bacon"; outros adicionais (cheddar, borda); desfazer; consultar histórico ou repetir pedido; voz própria (a voz é só ditado para o campo); chamar ERP; medir custo. `AGENTS.md` e `.lovable/plan/jornada-completa...md` ("Fora do escopo: IA de verdade, confirmar o pedido pelo chat, cadastrar o cliente inteiro só pelo chat e editar a ficha").

---

## 7. Estados por tela/componente

| Componente | Vazio | Carregando | Erro | Sucesso/aviso |
|---|---|---|---|---|
| Cardápio por abas | N/D (sempre há itens) | N/D | N/D | aviso na barra inferior da coluna 2 |
| Busca de produtos | `idle` mostra as abas; campo vazio → "Digite algo para buscar" | 6 cartões-esqueleto (450 ms), botão "Buscar" desabilitado | "Não foi possível consultar os produtos agora." + "Tentar de novo" (**nunca disparado pelo mock**) | "N produto(s) encontrado(s)"; sem resultado → "Nenhum produto encontrado para "x". Tente outro termo." |
| Diálogo de quantidade | campo vazio/0 → "Informe uma quantidade maior que zero", "Adicionar" desabilitado | N/D | "Não foi possível adicionar o produto. Tente de novo." | "Produto adicionado ao carrinho" |
| Configurador | N/D | N/D (preço instantâneo, sem chamada) | N/D (botão desabilitado se faltar 2º sabor, sem texto) | "Item adicionado ao pedido"/"Item atualizado" |
| Carrinho | "Nenhum produto no carrinho" / "Seu carrinho está vazio"; "Seu pedido começa aqui"; "Finalizar pedido" e "Limpar pedido" desabilitados | N/D | N/D | destaque do item do assistente |
| Cliente no carrinho | campo vazio; "Nenhum cliente encontrado" | N/D (síncrono) | N/D | "Cliente: <nome>" / "Cliente cadastrado: <nome>" |
| Cadastro (diálogo e rota) | — | botão com spinner ao salvar (700 ms); esqueleto nos campos UF/cidade/bairro durante CEP (600 ms) | alerta de falha (`#falha`); duplicidade com botão; erros por campo; "CEP não encontrado..." | volta/seleciona |
| `/clientes` busca | "Digite um telefone, nome ou CPF para buscar o cliente" | esqueletos na lista (3) e na ficha, botão "Buscar" desabilitado, 600 ms | "Não foi possível buscar o cliente agora." + "Tentar de novo" (gatilho: termo `erro`) | "N cliente(s) encontrado(s)"; nenhum → `Nenhum cliente encontrado para "x".` + cadastrar |
| Ficha | "Nenhum cliente selecionado"; "Este cliente ainda não tem endereço" | esqueleto da ficha | modais mantêm-se abertos com mensagem ("Não foi possível salvar. Tente de novo."; "Não foi possível remover o endereço. Tente de novo.") | — |
| Fechamento | N/D | N/D | mensagens de `validateCheckout` no rodapé (`role=alert`, classe `chat-error`) | tela "Pedido confirmado" |
| Histórico | "Nenhum pedido hoje" | N/D | N/D | — |
| Chat | "Olá! O que vamos pedir?" | "digitando..." (1 s) | "A resposta não chegou. Tente enviar novamente." (**nunca disparado pelo mock**) + erros de voz | resumo "Adicionado"; mensagens do mock |
| Voz | botão ausente em navegador sem suporte | "Ouvindo..." | mensagens do 2.14 | texto vai ao campo |
| Rotas inexistentes/erro | 404 em inglês | — | "This page didn't load" em inglês | — |

---

## 8. O que o protótipo NÃO tem (busca explícita)

| Funcionalidade | Existe? | Onde / evidência |
|---|---|---|
| "Repetir último pedido" | **NÃO ENCONTRADO** | `grep -i "repetir\|recompra\|último pedido"` em `src` sem resultado |
| Histórico por cliente (na ficha) | **NÃO ENCONTRADO** | a ficha (`clientes.index.tsx`) mostra só dados pessoais e endereços; `Customer` não tem pedidos; o único histórico é global "Pedidos do dia" (`HistoryPanel`) |
| Configurador de pizza com ingredientes removidos e observação | **EXISTE** | `index.tsx` linhas 108 a 121 (checkboxes de ingredientes por sabor, `removed`, textarea "Observação · opcional"); remoção não altera preço (`pdv.test.ts`). Observação só em pizza e só por item |
| Observação geral do pedido | **NÃO ENCONTRADO** | `grep observa` só acha a do item |
| Cancelar pedido | **NÃO ENCONTRADO** | nenhuma ação sobre pedido confirmado (sucesso e histórico são só leitura); "cancelar" só aparece como botão de fechar diálogo |
| Rascunho que sobrevive ao recarregar | **NÃO EXISTE** | estado em módulos (`session-store.ts`, `customer-store.ts`) sem `localStorage`, `sessionStorage` ou IndexedDB (`grep` vazio). Sobrevive só à navegação interna entre `/`, `/clientes` e `/clientes/novo` (teste `session-store.test.ts`). Um único rascunho; recarregar perde carrinho, conversa, histórico e cadastros |
| Painel de custo/uso do assistente | **NÃO ENCONTRADO** | o chat diz apenas "Simulação"; sem custo, tokens, orçamento |
| Desfazer do assistente | **NÃO ENCONTRADO** | só "remover item" por frase; o botão "Novo pedido" do chat só limpa a conversa |
| Limite de pedidos exibidos | **NÃO EXISTE** | `HistoryPanel` lista todos os do dia (`ordersForDay`), sem `slice` nem paginação |
| Origem do pedido (telefone/balcão) | NÃO ENCONTRADO | `Order`/`Checkout` não têm o campo |
| Tempo estimado de entrega | NÃO ENCONTRADO | |
| Login/atendente real, papéis, tenant | NÃO ENCONTRADO | "Atendente" fixo; "Marina Souza" fixo em `CustomerHeader` |
| Disponibilidade/indisponibilidade de produto, preço mudando | NÃO ENCONTRADO | |
| ERP, MCP, fila de envio, número do ERP, reenvio, recusa, idempotência | NÃO ENCONTRADO | número é contador local; `createOrder` síncrono |
| Soma de pizza idêntica no carrinho | NÃO EXISTE (só produtos simples via diálogo de quantidade) | `saveItem` vs `addOrMerge` |
| Atalho "O que falta?" como botão | NÃO ENCONTRADO (só digitando) | `ChatPanel` não tem chips fixos |
| Painel do gerente, relatórios | NÃO ENCONTRADO | |
| Lojas configuráveis, tenant, aba Lojas | NÃO ENCONTRADO | `STORES_LIST` constante |
| Tradução das telas de erro/404 | NÃO TRADUZIDO | `__root.tsx` em inglês |
| Impressão, comanda, cupom, desconto | NÃO ENCONTRADO | |

---

## 9. Comparação com a documentação do produto

Documentos lidos: os cinco `casos-de-uso.md` e o PRD FR-010 v0.7 (FR-010.1 a FR-010.9 e "Divergências do protótipo").

### 9.1 Respostas às 13 pendências `[A DEFINIR]`
Fazer pedido (6), Repetir pedido (3), Assistente (4). Consulta de produto e Identificar cliente declaram "Nenhuma".

| # | Pendência | O protótipo decide? |
|---|---|---|
| 1 | Formas de pagamento (lista fixa ou ERP) | **Decide parcialmente:** lista **fixa no código**: Dinheiro, Pix, Cartão de crédito, Cartão de débito (`orders.ts` tipo `Payment`; `index.tsx` e `CheckoutPanel`), padrão Pix. **Não cobre** a origem pelo ERP nem "cartão na entrega" (não distingue cartão na entrega de cartão online). Também não cobre "forma não escolhida" (UC04 2a): nunca fica vazio. |
| 2 | Troco: só dinheiro? valor "troco para" ou valor do troco? | **Decide:** só para Dinheiro; informa **"troco para" o valor da nota** (campo "Troco para · opcional"); opcional; deve ser ≥ total final **com taxa** ("O valor para troco deve ser igual ou maior que o total."); a tela de sucesso calcula "devolver R$ (troco − total)". Aceita vírgula decimal simples; "R$ 100" e milhar com ponto são recusados. |
| 3 | Observação geral e limite de caracteres | **Não cobre** observação geral (inexistente). Só observação **por item de pizza** (texto livre, **sem limite**). |
| 4 | Rascunho: um por atendente ou vários; sobrevive ao fechar o navegador | **Decide parcial:** exatamente **um** rascunho em memória (carrinho + cliente + loja + pagamento + conversa); sobrevive à navegação interna; **não** sobrevive ao recarregar; sem rascunho paralelo. **Não cobre** persistência nem tempo de vida. |
| 5 | Cancelamento depois de enviado | **Não cobre.** |
| 6 | Meio a meio: no máximo dois sabores? preço | **Decide:** **dois** sabores no máximo (`half` booleano; chat recusa 3: "Escolha dois sabores para a pizza meio a meio."). Preço **calculado no PDV** = maior dos dois no tamanho (contradiz a decisão do dono de que o ERP calcula; o PRD já lista como divergência). Adicionais sobre a pizza inteira. Pizza e meio a meio só entre pizzas (sem bebida/sobremesa). |
| 7 | Repetir: quantos pedidos a ficha lista | **Não cobre** histórico por cliente. Único dado próximo: "Pedidos do dia" lista todos do dia, sem limite (global, não por cliente). |
| 8 | O que conta como "último pedido" (aceitos, recusados, cancelados) | **Não cobre** (não há estados de pedido nem recusa). Todos os pedidos confirmados da sessão entram no histórico. |
| 9 | Repetir com carrinho cheio (substitui ou soma) | **Não cobre** (sem "Repetir"). O mais próximo: adicionar produto simples já existente **soma** (`addOrMerge`), mas isso não é "repetir". |
| 10 | Desfazer a última aplicação do assistente | **Não cobre.** |
| 11 | Teto de orçamento de IA | **Não cobre** (mock local, sem custo). |
| 12 | Voz: só transcrição do navegador em português? outros idiomas? | **Decide:** só transcrição do navegador (Web Speech API), **fixa em `pt-BR`**, preenche o campo sem enviar; botão escondido sem suporte. Outros idiomas: **não cobre**. Funcionamento com microfone físico **não validado** (`roadmap.md`). |
| 13 | Quem vê o painel de uso do assistente | **Não cobre** (não há painel nem papéis). |

### 9.2 Onde o protótipo CONTRADIZ a documentação

**Fazer pedido**
1. **Preço, taxa, total e tempo vêm do ERP** (decisão do dono; FR-010.4, FR-010.6) × protótipo calcula tudo no cliente: meio a meio = maior valor, adicionais com preço fixo, taxa fixa **R$ 8,00** em Delivery, sem tempo estimado (`menu.ts` `unitPrice`; `orders.ts` `deliveryFee`). A tabela "Divergências" do PRD já cobre os três, mas **não** cobre a ausência de tempo estimado.
2. **UC01 5/5a (preço a cada mudança, "Tentar de novo", não confirmar sem preço)** × configurador sem chamada, sem carregamento e sem erro; preço instantâneo.
3. **UC01 7a (pizza idêntica soma a quantidade)** × `saveItem` nunca soma; só `addOrMerge` (diálogo de quantidade) soma, e só produto simples sem personalização. Botões rápidos de bebida e itens do assistente também geram linhas novas.
4. **UC01 6 (quantidade no configurador)** × pizza não tem campo de quantidade no configurador (ajusta no carrinho); bebida/sobremesa tem.
5. **UC01 pré-condição "cliente identificado"** × protótipo deixa montar o carrinho sem cliente; só bloqueia "Finalizar".
6. **UC03 2 (loja já vem definida se o tenant atende uma só)** × protótipo sempre começa sem loja escolhida e lista 3 lojas fixas; não há tenant.
7. **UC03 5 / FR-010.5 (gravar a origem telefone ou balcão, separada do tipo)** × **não existe** campo de origem.
8. **UC03 4b / FR-010.9 (loja fora do tenant é recusada)** × sem tenant, sem validação por tenant.
9. **UC03 4 (loja que entrega vem do ERP)** × mapa CEP → loja estático com regra do prefixo `130` → Centro.
10. **UC04 2a (forma de pagamento não escolhida bloqueia)** × pagamento tem padrão Pix; nunca fica vazio.
11. **UC04 1 (resumo com cliente, tipo, loja, endereço, itens, taxa, **tempo**, total)** × resumo sem tempo; nome, endereço e telefone são **editáveis** no fechamento (a spec trata esses dados como já definidos/validados); o tipo é somente leitura.
12. **UC04 3-6 e FR-010.6 (confirmar grava como confirmado, envia por worker em até 60 s, número do ERP, recusa, reenvio, rascunho se ERP cair, idempotência)** × `confirmOrder` cria o pedido na hora, número local sequencial `#0001`, nada é enviado; sem recusa, sem fila.
13. **UC05 (acompanhar, corrigir, reenviar, cancelar)** × inexistente. O histórico do dia é só leitura.
14. **UC02 2b (item indisponível), UC01 2a/3a (tamanho/sabor indisponível)** × sem conceito de disponibilidade.
15. **UC02 2a (carrinho vazio "leva de volta à consulta")** × só mostra o vazio, sem ação.

**Repetir pedido** — tudo ausente: UC01 (histórico por ficha, destaque da última compra, "Este cliente ainda não fez pedidos", erro com "Tentar de novo", várias fichas por contato) e UC02 (repetir, conferir contra cardápio, estados "mantido/preço novo/indisponível"). FR-010.1 diz que a ficha mostra "dados pessoais, endereços e **histórico**": a ficha do protótipo **não tem histórico**.

**Assistente**
16. **Ações do assistente**: documentos listam identificar cliente, tipo, loja, endereço, adicionar/remover item e consultar pendências. O protótipo **acrescenta** `definir_pagamento`, `buscar`, `pergunta`, `cadastrar_cliente` (o PRD só trata pagamento como pendência 2; não menciona busca nem pergunta). Pendências **não incluem forma de pagamento** (UC02 do assistente pede cliente, tipo, loja, endereço, itens **e forma de pagamento**).
17. **UC02 passo 1 e 3 ("O que falta?" também por botão; cada pendência traz botão que leva à tela que a resolve)** × só frase digitada/ditada; resposta é texto; só a pendência de loja tem botões.
18. **UC01 passos 3-4 (ações validadas contra o ERP antes de aplicar; ação recusada mostra motivo e não aplica)** × aplicação direta sobre dados locais; o conceito "recusada" não existe.
19. **Regra "CPF, telefone e e-mail não vão ao modelo"** × contrato `AIContext` entrega `Customer[]` inteiros a `sendMessage`. Como é regex local, nada sai, mas **a interface do contrato precisaria mudar** para respeitar a regra quando houver IA real (FR-010.8 já pede "primeiro nome e o necessário").
20. **UC01 1a (assistente indisponível: PDV segue manual e o sistema diz por quê)** × só há mensagem genérica "A resposta não chegou. Tente enviar novamente."; manual é sempre disponível (chat só trava durante fechamento).
21. **Frases e testes como especificação** (PRD: "manter o conjunto de ações e os testes de frases") — **confere**: `aiService.test.ts`, `assistant-journey.test.ts` e `search.test.ts` são a especificação executável (seção 6.3).

**Consultar produto**
22. UC01/FR-010.4: "foto" do cartão: no protótipo a foto é **ícone genérico** (sanduíche), nunca imagem de CDN; só as pizzas do **cardápio por abas** usam recorte de uma imagem local; o marcador de "sem foto" só aparece no Wrap. O doc fala de URL do CDN.
23. O **cardápio por abas Pizzas/Bebidas/Sobremesas, os botões de tamanho rápidos e o configurador reduzido para bebida/sobremesa** não estão nos casos de uso (que só descrevem busca → "Adicionar ao carrinho" → quantidade, e configurador só para pizza). Os docs não definem como bebida/sobremesa **com vários tamanhos** entra no carrinho.
24. Paginação: protótipo fixa **6 por página** (doc não define). Quantidade ilimitada.
25. Busca usa "contém sem acento" nos campos nome/descrição/código/ingrediente; doc diz que a API do ERP decide. Lanches só existem na busca e no assistente.

**Identificar cliente**
26. **Duas formas de identificar**: o documento descreve só a tela com seleção Telefone/Nome/CPF e ficha (equivale a `/clientes`). O protótipo acrescenta a **busca rápida no carrinho** (detecção automática, contém, atalho F2, sem ficha, sem validação de formato, sem carregamento nem erro) como caminho principal, e `/clientes` ficou secundária (`AGENTS.md`: "/clientes and /clientes/novo remain for full record management"). Os docs não descrevem F2, detecção automática, busca "contém" com mínimos de 2 letras e 3 dígitos, nem a lista suspensa.
27. Casos de uso 2b (telefone/CPF inválido não pesquisa) valem só em `/clientes`; a busca rápida não valida formato.
28. Textos divergentes do mesmo botão: `/clientes/novo` "Abrir ficha existente" × diálogo "Usar cliente existente" (o documento diz "abrir a ficha existente").
29. UC02 3c: "CEP falha na consulta" (serviço indisponível) × protótipo só trata CEP não encontrado.
30. UC03 6a `Nenhuma loja entrega neste endereço` ✓ literal igual. UC03 2b (remoção com confirmação e novo principal) ✓. UC01 5c (editar só nome, CPF, nascimento) ✓.
31. Padrão do tipo na tela de clientes: plano diz "Entrega (padrão)"; código é **Balcão**. Os documentos não fixam padrão.
32. Atendente fixo "Marina Souza" × docs exigem atendente autenticado.
33. Tipo "Entrega" × "Delivery": documentos e PRD usam "entrega"; o PDV mostra "Delivery" e `/clientes` mostra "Entrega".

### 9.3 Onde o protótipo NÃO cobre o que a documentação define
Vários fichas por contato; unicidade validada no ERP e no CRM; contato espelho; tenant e lojas por tenant; aba Lojas; WhatsApp; Central de avisos; auditoria; LGPD (CPF cifrado, anonimização); idempotência; rascunho persistente; reenvio; recusa do ERP; origem; tempo estimado; histórico por ficha; repetir pedido; custo de IA; papel de gerente; acessibilidade de 44 px (o protótipo usa botões `size="sm"` e `size="icon"` menores em vários pontos, não medido).

### 9.4 O que o protótipo decide e a documentação deixou em aberto (resumo)
- Lista de formas de pagamento (4, padrão Pix).
- Troco = "troco para" (valor da nota), só dinheiro, ≥ total com taxa.
- Máximo de dois sabores; preço pelo maior (mas o PRD manda o ERP calcular).
- Um rascunho, só em memória.
- Voz = ditado pt-BR, sem envio automático.
- Itens guardam origem manual/assistente (conforme o documento) e a UI a mostra com ícone.
- Paginação de 6 por página; quantidade em janela própria; produto simples vs pizza vs bebida com tamanhos.
- Histórico do dia: sem limite, mais recente primeiro, fuso São Paulo.
- Cliente "contém" ≥ 2 letras / ≥ 3 dígitos na busca rápida; `/clientes` por igualdade exata de dígitos.
- Primeiro endereço vira principal; remover principal exige escolha; "Usar neste pedido" só em Entrega.
- Pedido não vai a lugar nenhum: sucesso e histórico apenas.

### 9.5 Confirmação da tabela "Divergências do protótipo" do PRD
Os 8 pontos da tabela conferem com o código: taxa R$ 8 (`deliveryFee`); pagamento coletado (4 formas + troco); só tipo Balcão/Delivery, sem origem; dados de exemplo (`sampleCustomers`, `CEPS`, `products`); um telefone por cliente e duplicidade de CPF/telefone local; `STORES_LIST` fixa; preço calculado no cliente; assistente por regras. **Pontos que a tabela não lista e deveria**: tempo estimado ausente; pagamento sempre preenchido (UC04 2a); fechamento com nome/endereço/telefone editáveis; busca rápida e F2; configurador sem soma de pizzas iguais; ausência de histórico por cliente; cadastro duplicado só por CPF/telefone (não e-mail); `AIContext` com dados pessoais completos; padrão Balcão; telas de erro em inglês.
