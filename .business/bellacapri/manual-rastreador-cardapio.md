# Manual de integração: rastreador do cardápio digital com o CRM da Bella Capri

Para o time que desenvolve o cardápio digital. Aqui está tudo o que vocês precisam para fazer o cardápio contar ao CRM o que o
cliente faz (viu uma página, viu um produto, mexeu no carrinho, foi ao pagamento, comprou). Com isso o pedido do cliente anda
sozinho pelo funil de vendas da Bella.

**Resumo em cinco linhas**

1. Vocês colam **um trecho de código** no `<head>` do cardápio (a Bella entrega a chave e o endereço do CRM).
2. Os links que levam o cliente ao cardápio já chegam com `?idtrack=<código do cliente>`. Vocês só precisam **não perder** esse código.
3. Onde algo acontece na página, vocês chamam `rastreador("track", "<evento>", { ... })`.
4. São **5 eventos** com nomes e propriedades fixos (seção 5).
5. O cancelamento de pedido **não** passa por aqui (seção 8).

---

## 1. O que a Bella entrega a vocês

| O que | Como aparece | Para que serve |
|---|---|---|
| **Chave pública** | `pk_` seguido de letras e números | Diz de qual funil são os eventos. Fica à vista no código da página |
| **Endereço do CRM** | `https://...` | De onde o script é carregado e para onde os eventos vão |
| **Sites autorizados** | os endereços do cardápio cadastrados na chave | O CRM só aceita eventos vindos desses sites |

> A chave pública **não é uma senha**. Quem a vê só consegue enviar eventos, e apenas a partir dos sites autorizados. Ela não lê nada
> do CRM. Mesmo assim, não a use em sites que não sejam o cardápio. Se vazar para outro lugar, a Bella a revoga e entrega outra.

**Peça à Bella os valores reais.** Neste manual eles aparecem como `<CHAVE_PUBLICA>` e `<ENDERECO_DO_CRM>`.

**Importante:** o endereço do cardápio precisa estar cadastrado **exatamente** como vocês o acessam, com a porta quando houver:
`https://cardapio.exemplo.com` é diferente de `https://www.cardapio.exemplo.com`, e `http://localhost:3000` é diferente de
`http://localhost`. Para testes locais, `http://localhost:<porta>` e `http://127.0.0.1:<porta>` são aceitos. Qualquer outro endereço
precisa ser `https`.

---

## 2. Instalação

Cole **uma vez**, dentro do `<head>` de todas as páginas do cardápio (ou no HTML base de um app de página única):

```html
<script>
(function(w,d,s){w.rastreador=w.rastreador||function(){(w.rastreador.q=w.rastreador.q||[]).push([].slice.call(arguments))};
var e=d.createElement("script");e.async=1;e.src=s;d.head.appendChild(e)})(window,document,"<ENDERECO_DO_CRM>/rastreador/v1.js");
rastreador("init",{key:"<CHAVE_PUBLICA>",endpoint:"<ENDERECO_DO_CRM>"});
</script>
```

- O trecho carrega o arquivo `rastreador/v1.js` do CRM sem travar a página e já deixa a função `rastreador(...)` disponível.
  Chamadas feitas antes de o arquivo terminar de carregar ficam em fila e são executadas depois.
- O script **não tem dependências** e **nunca lança erro** para a página: se algo falhar, o cardápio continua funcionando.
- Para depurar durante o desenvolvimento, use `rastreador("init",{key:"<CHAVE_PUBLICA>",endpoint:"<ENDERECO_DO_CRM>",debug:true})`
  (ver seção 7).

---

## 3. O `idtrack`: de quem é cada evento

O CRM só sabe de quem é um evento pelo **`idtrack`**: o código do cliente no CRM (um UUID, como
`6a3a1d29-e054-4f33-b406-dcb90ff9c948`). O assistente da Bella monta o link do cardápio já com ele:

```
https://cardapio.exemplo.com/?idtrack=6a3a1d29-e054-4f33-b406-dcb90ff9c948
```

### O que o script faz com ele
- Lê `?idtrack=` da URL, confere se é um UUID e guarda na **sessão do navegador** (`sessionStorage`, some quando a aba fecha).
- Nas páginas seguintes, sem o parâmetro na URL, ele reaproveita o valor guardado.
- **Sem `idtrack` válido, o script não envia nada e descarta o evento.** Não existe segunda chance: o evento não fica guardado
  esperando. Telefone, e-mail ou qualquer valor que não seja UUID são descartados.

### O que vocês precisam garantir
1. **Propague o `idtrack`** nos links internos, ou garanta que a sessão do navegador se mantém na mesma aba.
2. **Cuidado com o retorno do pagamento.** Se o cliente sai para um checkout/gateway externo e volta por uma URL sem
   `?idtrack=`, e sem a sessão, a compra **não será rastreada**. Inclua o `idtrack` na URL de retorno.
3. **Aba nova aberta direto, sem o link da Bella:** não há `idtrack`, então nada é rastreado. É o comportamento esperado.
4. Em app de página única, mantenha o script carregado: não é preciso repetir o `init` a cada tela.
5. Se o `idtrack` só ficar disponível depois do carregamento, chame `rastreador("init", ...)` de novo quando ele aparecer.
   Os eventos disparados antes continuam perdidos.

O CRM também descarta o evento (sem erro, sem aviso) quando o cliente **não tem um pedido aberto** no funil, ou quando o contato
é pessoal. O rastreador nunca cria pedido: ele só atualiza o pedido que a conversa da Bella já abriu.

---

## 4. Como mandar um evento

```js
rastreador("track", "<nome_do_evento>", { propriedade: valor, ... });
```

Regras que valem para **todos** os eventos:

| Regra | Detalhe |
|---|---|
| **Nome do evento** | Exatamente um dos 5 da seção 5 (minúsculas, com `_`). Outro nome é recusado |
| **O segundo argumento é um objeto** | Listas vão **dentro** de uma chave (por exemplo `items: [...]`), nunca soltas |
| **Valores em reais, com ponto** | `73.9` ou `"73.90"`. Nada de vírgula (`73,90`), de separador de milhar nem de `R$` |
| **Campo vazio: omita a chave** | Sem cupom, não mande `coupon`. Não envie `null` nem texto vazio |
| **Tamanho** | Até 8 KB por evento |
| **Hora do evento** | O script grava sozinho. Não é preciso enviar |
| **Dados pessoais** | O script **remove** telefone, e-mail e nome antes de enviar (seção 8). Não precisam ser enviados |

O script junta os eventos e envia em **lotes de até 20, a cada 3 segundos**, e descarrega o que sobrou quando o cliente sai da
página. Cada evento ganha um identificador próprio, então um reenvio por falha de rede **não duplica**.

---

## 5. Os 5 eventos

### 5.1 `page_view`: entrou numa página

Quando: ao entrar em uma página do cardápio (home, perfil, etc.).

| Propriedade | Tipo | Exemplo |
|---|---|---|
| `screen_name` | texto | `"home"`, `"profile"` |

```js
rastreador("track", "page_view", { screen_name: "home" });
```

Efeito no CRM: **só registra** no histórico do pedido. Não move o pedido.

### 5.2 `view_item`: viu um produto

Quando: sempre que o cliente abre/visualiza um produto.

| Propriedade | Tipo | Exemplo |
|---|---|---|
| `item_id` | texto | `"pizza-calabresa"` |
| `item_name` | texto | `"Pizza Calabresa"` |
| `price` | número (reais) | `59.9` |

```js
rastreador("track", "view_item", { item_id: "pizza-calabresa", item_name: "Pizza Calabresa", price: 59.9 });
```

Efeito no CRM: **só registra** no histórico. Não move o pedido.

### 5.3 `cart_sync`: o carrinho mudou

Quando: **toda vez** que o carrinho muda (adicionar, remover, alterar quantidade). Mande **o carrinho inteiro**, não só o item
alterado. O CRM guarda o **último** recebido.

| Propriedade | Tipo | Observação |
|---|---|---|
| `items` | lista | cada item: `item_id`, `item_name`, `price`, `quantity` |
| `value` | número (reais) | **obrigatório**: soma de `price × quantity` de todos os itens |

```js
rastreador("track", "cart_sync", {
  items: [
    { item_id: "pizza-calabresa", item_name: "Pizza Calabresa", price: 59.9, quantity: 2 },
    { item_id: "refri-2l",       item_name: "Refrigerante 2L", price: 12.0, quantity: 1 }
  ],
  value: 131.8
});
```

- **`value` é obrigatório, sempre.** O CRM não soma os itens: quem calcula é o cardápio. Sem o campo, o evento inteiro é recusado.
  Se o cliente esvaziar o carrinho, envie `items: []` e `value: 0`.
- Use um *debounce* de 1 a 2 segundos: uma rajada de cliques deve virar um evento só.

Efeito no CRM: o pedido vai para a etapa **Carrinho** (se ainda estiver antes dela), o **valor do negócio** é atualizado com `value`, e
o carrinho fica guardado na ficha do pedido.

### 5.4 `begin_checkout`: foi para o pagamento

Quando: sempre que o cardápio inicia o checkout.

| Propriedade | Tipo | Exemplo |
|---|---|---|
| `value` | número (reais) | `131.8` (obrigatório) |
| `item_count` | número | `3` |
| `delivery_type` | texto | `"delivery"` ou `"retirada"` |
| `coupon` | texto | `"BELLA10"` (omita se não houver) |

```js
rastreador("track", "begin_checkout", { value: 131.8, item_count: 3, delivery_type: "delivery", coupon: "BELLA10" });
```

Efeito no CRM: o pedido vai para a etapa **Revisão**, o valor do negócio é atualizado e o conteúdo fica guardado.

### 5.5 `purchase`: o pedido foi confirmado

Quando: **uma vez**, quando o pedido é confirmado.

| Propriedade | Tipo | Observação |
|---|---|---|
| `order_id` | texto | **obrigatório**: número do pedido no cardápio. É com ele que o CRM reconhece uma compra repetida |
| `value` | número (reais) | **obrigatório**: o **valor final pago** pelo cliente (já com frete e desconto). É o que vira o valor do negócio |
| `delivery_type` | texto | `"delivery"` ou `"retirada"` |
| `subtotal` | número (reais) | soma dos itens |
| `total` | número (reais) | guardado só para consulta |
| `shipping` | número (reais) | frete |
| `discount` | número (reais) | desconto |
| `payment_method` | texto | `"pix"`, `"cartao"`, ... |
| `coupon` | texto | omita se não houver |
| `items` | lista | cada item: `item_id`, `item_name`, `price`, `quantity` |

```js
rastreador("track", "purchase", {
  order_id: "P-1042",
  value: 141.8,
  delivery_type: "delivery",
  subtotal: 131.8,
  total: 141.8,
  shipping: 10,
  discount: 0,
  payment_method: "pix",
  coupon: "BELLA10",
  items: [
    { item_id: "pizza-calabresa", item_name: "Pizza Calabresa", price: 59.9, quantity: 2 },
    { item_id: "refri-2l",       item_name: "Refrigerante 2L", price: 12.0, quantity: 1 }
  ]
});
```

Efeito no CRM: o pedido vai para **Compras** (venda ganha), o valor do negócio recebe `value` e o conteúdo fica guardado.

Cuidados com a compra:
- **Recarregar a página de sucesso não duplica.** O mesmo `order_id` é reconhecido como repetição. Mesmo assim, evite disparar `purchase`
  mais de uma vez por pedido.
- **A compra vinda do navegador só fecha o pedido se o pedido já registrou um carrinho ou um pagamento antes** (`cart_sync` ou
  `begin_checkout`). Sem isso, ela fica registrada, mas o pedido **não** vai para Compras. Garanta que todo pedido passe por
  `cart_sync`/`begin_checkout` antes. Isso é uma proteção contra compra forjada.
- Depois de **Compras**, o pedido está encerrado: nenhum evento o move mais.

### Resumo do efeito de cada evento

| Evento | Etapa do pedido | Valor do negócio | O que fica guardado |
|---|---|---|---|
| `page_view` | não muda | não muda | só o histórico |
| `view_item` | não muda | não muda | só o histórico |
| `cart_sync` | **Carrinho** | atualizado (`value`) | o último carrinho |
| `begin_checkout` | **Revisão** | atualizado (`value`) | o último checkout |
| `purchase` | **Compras** (ganho) | atualizado (`value`) | o pedido completo |

O pedido **nunca volta** para uma etapa anterior: um `cart_sync` depois de `begin_checkout` atualiza o carrinho e o valor, mas o
pedido continua em Revisão.

---

## 6. API do script (referência)

```js
rastreador("init",  { key: "<CHAVE_PUBLICA>", endpoint: "<ENDERECO_DO_CRM>", debug: false, storage: true });
rastreador("track", "<evento>", { ... });
rastreador("optOut");   // o visitante não quer ser rastreado: apaga o que foi guardado e para de enviar
rastreador("optIn");    // desfaz o optOut
rastreador("flush");    // envia agora o que estiver na fila
```

| Opção do `init` | Padrão | O que faz |
|---|---|---|
| `key` | (obrigatória) | a chave pública. Valor que não comece com `pk_` é recusado |
| `endpoint` | endereço de onde o script foi carregado | endereço do CRM |
| `debug` | `false` | avisa no console do navegador: sem `idtrack` válido, evento não cadastrado, lote recusado |
| `storage` | `true` | `false` não guarda **nada** no navegador. O `idtrack` vale só enquanto a página está aberta |

Também existem como métodos: `rastreador.init(...)`, `rastreador.track(...)`, `rastreador.optOut()`, `rastreador.optIn()`.

### Comportamento de rede
- Lotes de até 20 eventos, a cada 3 segundos (20 acumulados saem na hora). Ao sair da página, o resto vai por `sendBeacon`.
- Falha de rede, `429` e `5xx`: o script **reenvia** com espera crescente (respeita o `Retry-After`), até 5 tentativas, **com o mesmo
  identificador de evento** (não duplica).
- Qualquer outro erro `4xx` (chave revogada, site não autorizado, corpo inválido) é **definitivo**: o script não reenvia.
- A resposta de sucesso é sempre `200` com `"resultado": "recebido"` para cada evento, **mesmo que o CRM descarte o evento** (por
  `idtrack` sem pedido, por exemplo). Isso é proposital, para o navegador não conseguir descobrir quais clientes existem. Por isso,
  **`200` não prova que o pedido andou**: confira no CRM (seção 9).

---

## 7. Depuração

Com `debug: true`, o console do navegador (prefixo `[rastreador]`) avisa:
- que não há `idtrack` válido na URL, e portanto nada será enviado;
- que um evento **não está cadastrado** no funil, com a lista dos cadastrados;
- que o CRM recusou um lote (com o código HTTP).

Na aba **Network** do navegador, procure a requisição `POST <ENDERECO_DO_CRM>/api/v1/coleta/<CHAVE_PUBLICA>`:

| Status | Significado |
|---|---|
| `200` | Recebido. Confira no CRM se o pedido andou |
| `404` | Chave inexistente, mal copiada ou **revogada** |
| `403` | O site de onde veio **não está na lista de sites autorizados** da chave (confira `https`, `www` e a porta) |
| `422` | Corpo inválido: evento sem identificador, mais de 20 eventos num lote, JSON malformado |
| `429` | Muitas requisições. O script respeita o `Retry-After` |
| (bloqueado por CORS) | Mesma causa do `403`: site não autorizado |

---

## 8. O que o rastreador não faz, e privacidade

- **Não cancela pedido.** Nada vindo do navegador move o pedido para uma etapa de perda. O cancelamento é enviado pelo **servidor**
  do cardápio, com o token de API (ver `integracao-mcp-cardapio.md`, nesta mesma pasta).
- **Não identifica quem navega por telefone, e-mail ou nome.** O único identificador é o `idtrack`. Visitante sem `idtrack` não é rastreado.
- **Remove dados pessoais dos eventos antes de enviar**: as chaves `phone`, `telefone`, `celular`, `whatsapp`, `email`, `e-mail`,
  `mail`, `name`, `nome`, `full_name`, `first_name`, `last_name`, `customer_name`, `nome_completo`, `cpf` e `cnpj`, em qualquer
  profundidade, e qualquer valor com cara de e-mail. `item_name` (nome de produto) **não** é removido.
- **O que o script guarda no navegador:** só o `idtrack` (em `sessionStorage`, chave `rastreador_idtrack`) e, se o visitante pedir
  para sair, um marcador `rastreador_optout` em `localStorage`. Não usa cookies.
- **Consentimento:** quem decide a base legal é a Bella (controladora dos dados). Ofereça ao visitante um jeito de recusar chamando
  `rastreador("optOut")`, e inicialize o rastreador só depois do consentimento, se a Bella assim determinar.
- **Compra por uma porta só:** a compra deve chegar ao CRM por **uma** via. Se o servidor também avisar a mesma compra por webhook,
  o CRM não percebe que é a mesma e pode duplicar o pedido. Combine com a Bella antes de ligar as duas.

---

## 9. Roteiro de aceite (como testar)

A Bella fornece **um contato de teste** com um pedido aberto no funil Pedidos, e o `idtrack` dele. Em ambiente local, peça para a Bella
cadastrar `http://localhost:<porta>` como site autorizado da chave de teste.

1. Abra o cardápio com `?idtrack=<codigo-do-contato-de-teste>`, com `debug: true`.
2. Execute os passos abaixo e confira o pedido do contato de teste no CRM depois de cada um (aguarde ~5 segundos pelo lote):

| # | Ação no cardápio | Resultado esperado no CRM |
|---|---|---|
| 1 | Abrir a home | O histórico do pedido ganha um `page_view` com `screen_name`. A etapa não muda |
| 2 | Abrir um produto | Histórico com `view_item`. A etapa não muda |
| 3 | Adicionar 2 itens ao carrinho | Pedido em **Carrinho**, valor do negócio = soma dos itens |
| 4 | Alterar a quantidade de um item | Valor do negócio atualizado; o pedido continua em Carrinho |
| 5 | Ir para o pagamento | Pedido em **Revisão**, valor = `value` do checkout |
| 6 | Confirmar o pedido | Pedido em **Compras**, ganho, valor = `value` da compra |
| 7 | Recarregar a página de sucesso | Nada duplica: continua 1 compra no histórico |

3. **Testes negativos** (todos devem terminar sem nenhum evento no CRM):
   - abra o cardápio **sem** `?idtrack=` em uma aba nova: nenhuma requisição `POST .../coleta/...` deve sair;
   - abra com `?idtrack=+5517999999999` (um telefone): nenhuma requisição deve sair;
   - envie um evento com nome errado (`purchas`): o console avisa e o CRM recusa;
   - confirme uma compra **sem** nunca ter mexido no carrinho: a compra aparece no histórico, mas o pedido **não** vai para Compras.
4. Na tela do CRM (Configurações › Funis › Rastreador), a chave passa a mostrar **"Visto pela última vez em…"**.

---

## 10. Perguntas frequentes

**O cardápio é uma página web ou um app?**
O rastreador roda **no navegador** e depende da origem do site. Um app nativo (que não roda no navegador) não funciona com ele: nesse
caso, combine com a Bella o envio pelo servidor. Se o cardápio for um app Flutter **web**, carregue o script no `index.html` e chame
a função global `rastreador` pela interoperabilidade com JavaScript. Este manual não traz um exemplo testado em Flutter.

**Posso mandar outros eventos além dos 5?**
Não, a menos que a Bella cadastre o evento novo no funil. Evento não cadastrado é recusado.

**Posso mandar mais propriedades além das listadas?**
Sim, as propriedades são livres (até 8 KB por evento). Elas ficam guardadas no histórico e no conteúdo do evento. Só as listadas aqui
têm efeito no funil.

**O `price` é por unidade?**
Sim: `price` é o preço de **uma** unidade e `quantity` a quantidade. O CRM não calcula nada: o valor do negócio vem de `value`.

**O que acontece se o cliente fechar a aba logo depois de clicar?**
O script descarrega a fila ao sair da página. Se a rede falhar, a requisição se perde. Eventos importantes (como a compra) devem ser
disparados enquanto o cliente ainda está na página.

**Como saber se uma chave foi revogada?**
Todos os envios passam a responder `404` e o script desiste depois de algumas tentativas. Peça uma chave nova à Bella.

**Posso usar a mesma chave em ambiente de teste e de produção?**
Melhor não. Peça uma chave de teste (com `localhost` autorizado) e outra de produção (só com o endereço `https` real). Assim a de
teste pode ser revogada sem afetar o cardápio no ar.
