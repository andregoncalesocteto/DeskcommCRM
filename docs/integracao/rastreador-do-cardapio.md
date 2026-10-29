# Rastreador no site do cardápio

Para quem tem um cardápio digital (ou qualquer página) num site próprio e quer que o CRM saiba o que o cliente fez: viu um
item, montou o carrinho, comprou. Você cola um pequeno código no site; o código conta os fatos ao CRM, e o pedido do cliente
anda pelo funil sozinho.

> O rastreador serve a jornada que **começa no WhatsApp**. Para o pedido que nasce fora dele, ou para o valor definitivo da compra, veja
> [webhook ou rastreador](webhook-ou-rastreador.md) — inclusive o aviso sobre a mesma compra chegar pelas duas portas.

> Antes de instalar, o funil precisa ter os **eventos cadastrados** (Configurações › Funis › «Para onde o card vai em cada
> evento»). O rastreador só conta o que o funil cadastrou. Evento não cadastrado é recusado, e a recusa não se reenvia.

## 1. Criar a chave e copiar o código

1. Entre como gerente em **Configurações › Funis**, no funil do cardápio, e vá a «Rastreador para o site do cardápio».
2. **Criar chave do rastreador**: dê um nome e liste os **sites** onde o código vai rodar, um por linha, com `https://` e sem
   nada depois do nome (`https://cardapio.minhaloja.com.br`). Para testar no seu computador, `http://localhost:3000` também vale.
3. Em **Copiar código de instalação** (ou **Ver o código**), pegue o trecho pronto e cole dentro de `<head>` das páginas do
   cardápio. Ele já leva a chave e o endereço do seu CRM.

**A chave não é uma senha.** Ela é o endereço do funil e fica à vista no código da página. Quem a vê só consegue enviar eventos,
e só a partir dos sites que você listou; não consegue ler nada do CRM. Se desconfiar de mau uso, **revogue** a chave (o código
para de funcionar na hora, em todos os sites) e crie outra. A tela mostra, para cada chave, quando ela recebeu um evento pela
última vez e quantos nos últimos 7 dias.

## 2. O link do cliente precisa trazer o `idtrack`

O rastreador só envia algo quando a página foi aberta com `?idtrack=` e o valor é o **código do cliente no CRM** (um UUID). É
assim que o CRM sabe de quem é o pedido. O agente de IA monta o link com `{{id_do_contato}}` no prompt, por exemplo
`https://cardapio.minhaloja.com.br/?idtrack={{id_do_contato}}`.

Sem `idtrack`, ou com algo que não é um UUID (um telefone, um e-mail), o script **não envia nada**. O CRM também descarta o
evento se o cliente não tem um pedido aberto **neste funil** (ele nunca cria pedido) ou se o contato é pessoal.

## 3. Contar os fatos

Onde algo acontece na página, uma linha:

```js
rastreador("track", "page_view",      { screen_name: "home" });
rastreador("track", "view_item",      { item_id: "pizza-1", item_name: "Pizza grande", price: 59.9 });
rastreador("track", "cart_sync",      { items: [{ item_id: "pizza-1", item_name: "Pizza grande", price: 59.9, quantity: 1 }] });
rastreador("track", "begin_checkout", { value: 73.9, item_count: 1, delivery_type: "delivery" });
rastreador("track", "purchase",       { order_id: "P-1042", value: 73.9, payment_method: "pix" });
```

O primeiro argumento é a **chave do evento, exatamente como cadastrada no funil**. Os dados são livres, mas o evento de valor
precisa trazer o campo que o cadastro indica (aqui, `value`). Mande o **carrinho inteiro** em `cart_sync`: o último vale.
Reenviar o mesmo pedido com o mesmo `order_id` conta como repetição e não duplica (a página de sucesso pode ser recarregada).

Outros comandos: `rastreador("optOut")` (o visitante pediu para não ser rastreado) e `rastreador("optIn")`; em `init`, `storage: false`
(não guarda nada no navegador) e `debug: true` (avisa no console do navegador quando um evento não está cadastrado no funil, com a
lista dos cadastrados).

## 4. O que o navegador pode e não pode

O código roda na máquina do visitante, que pode alterá-lo. Por isso:

- Todo evento vindo do navegador é gravado no histórico com a marca **origem: navegador**.
- A compra do navegador **só fecha o pedido se o pedido já registrou antes um evento de estado** (carrinho, pagamento). Sem isso, ela
  fica registrada e o pedido **não** vai a Compras.
- **Nenhum** evento do navegador move o pedido para uma etapa de perda. **O cancelamento passa pelo servidor do cardápio**, com
  o token de API (`crm_move_lead_stage` com o motivo da perda), nunca por esta chave.
- Pedido já encerrado (ganho ou perdido) só registra o evento.
- Limite: as travas reduzem o estrago de uma compra forjada, não o eliminam. Quem forja um carrinho e uma compra consegue fechar o
  pedido dele. Para valor definitivo e cancelamento, use o servidor.

## 5. Privacidade e consentimento

- O script **nunca envia telefone, e-mail nem nome**: ele remove dos dados, antes de enfileirar, chaves como `phone`, `telefone`,
  `email`, `name`, `nome`, `cpf` (em qualquer profundidade; `item_name`, nome de produto, não é removido) e qualquer valor com
  cara de e-mail. O único identificador enviado é o `idtrack`, que o CRM já tinha.
- **No navegador do visitante o script guarda só o `idtrack`**, na sessão (`sessionStorage`, some ao fechar a aba). Se o visitante
  chamar `optOut`, ele apaga isso e grava um marcador `rastreador_optout` (em `localStorage`) para respeitar a escolha nas próximas
  páginas. Com `storage: false` nada é guardado.
- **Quem instala é o controlador dos dados**: a sua empresa. Informe no aviso de privacidade e, quando a sua base legal exigir, no
  banner de consentimento do site, que o cardápio registra a navegação do cliente identificado no CRM. Ofereça um jeito de o visitante
  optar por sair (`rastreador("optOut")`) e só inicialize o rastreador depois do consentimento, se for o caso.

## 6. Se algo não aparece

| Sintoma | Causa provável |
|---|---|
| Nada chega e o console avisa «sem idtrack válido» | O link não trouxe `?idtrack=` com o código do cliente |
| O console avisa «evento … não está cadastrado» (com `debug: true`) | A chave do evento não existe no funil, ou está desativada |
| Navegador bloqueia por CORS | O site não está na lista de sites da chave (confira `https`, a porta e o `www`) |
| Parou depois de revogar | Esperado. A resposta de chave revogada não leva cabeçalhos de CORS, então o navegador a vê como erro de rede e o script tenta algumas vezes (até 5, com espera crescente) antes de desistir |
| «Muitas requisições» | A porta limita por visitante (60 por minuto) e por chave (1.200 por minuto) |
| A compra aparece no histórico e o pedido não foi a Compras | Faltou um evento de estado antes (carrinho ou pagamento), ou o pedido já estava encerrado |

Fonte do script: `public/rastreador.js` (sem dependência). Desenho: [`../design/eventos-do-funil.md`](../design/eventos-do-funil.md).
