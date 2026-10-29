# Webhook de entrada ou rastreador: qual porta usar

O CRM recebe o que o cliente faz fora do WhatsApp por **duas portas**, e elas servem a jornadas diferentes. Escolha pela
jornada, não pelo gosto.

| A jornada do cliente | Use | Por quê |
|---|---|---|
| Começa no **WhatsApp**: a pessoa conversa, o agente manda o link do cardápio com o código dela, ela navega e compra | **Rastreador** ([guia](rastreador-do-cardapio.md)) | O pedido **já existe** (nasceu na conversa); o rastreador conta cada passo (visita, item, carrinho, compra) e o card anda pelo funil. Precisa do `?idtrack=` no link |
| **Nasce fora**: o cliente entra direto pelo site ou pela plataforma de pedidos e finaliza sem nunca ter falado no WhatsApp | **Webhook de entrada** | Não há pedido para o rastreador achar. A plataforma avisa o pedido finalizado e o CRM **cria** o card (ou reaproveita o card aberto do contato) |
| Os dois: a pessoa começa no WhatsApp e a plataforma ainda avisa a compra do servidor | **Rastreador para a navegação, webhook para a compra** — e leia o aviso de duplicidade abaixo | O servidor da plataforma é a fonte confiável do valor definitivo; o navegador conta só o caminho |

## Configurar o valor e os itens na fonte do webhook

Em **Webhooks › a fonte**, a seção «Valor e itens do pedido»:

- **Campo do valor do pedido**: onde o total aparece no envio (`value`, ou `pedido.total` quando está dentro de outro bloco) e a
  **unidade** (reais ou centavos). O CRM preenche o valor do card com ele, **antes** de mover a etapa. Valor ausente ou ilegível nunca
  derruba o envio: o card entra sem valor e o motivo fica no log.
- **Guardar os itens e os demais dados aninhados em**: o nome de uma chave da ficha do card (por exemplo `pedido_json`). Listas e blocos
  do envio (os itens, os dados do cliente) ficam guardados ali, como vieram, até 32 KB; acima disso o JSON não é guardado e o motivo vai
  para o log. Sem esta chave, o aninhado é descartado, como sempre foi. A chave não pode ter o nome de um campo da ficha do funil.
- A tela avisa quando a **etapa padrão** da fonte é de ganho e nenhum campo do valor foi configurado (a venda chegaria sem valor), e lembra
  que a etapa padrão vale para **todo** envio da fonte: para o pedido andar por várias etapas conforme o que o cliente faz, use os eventos do funil.

Um envio com o mesmo `external_id` repetido não altera nada se nada mudou (nem etapa, nem valor, nem JSON).

## ⚠️ A mesma compra pelas duas portas

**O produto não reconhece que o rastreador e o webhook estão contando a mesma compra.** Cada porta tem a sua própria regra de repetição
(o rastreador pelo `order_id` cadastrado no evento; o webhook pelo `external_id` do envio), e uma não enxerga a outra. O que acontece:

- A compra chega **primeiro pelo rastreador** e fecha o pedido (Compras, ganho). Quando o webhook avisa a mesma compra, o card **não está
  mais aberto**, então não é reaproveitado e o webhook **cria outro card** em Compras: duas vendas para uma compra.
- A compra chega **primeiro pelo webhook** e fecha o card. A compra do navegador depois só **registra o evento** (o pedido já está encerrado).
  Não duplica card, mas o histórico mostra a compra duas vezes.

**O cuidado:** para cada loja, escolha **uma** porta para a compra. O que recomendamos: o rastreador conta a navegação (visita, item, carrinho) e
**não** envia `purchase`; a compra vem pelo webhook do servidor da plataforma, que tem o valor definitivo. Se a compra tiver de vir pelo
rastreador, não ligue o aviso de pedido finalizado da plataforma para a mesma loja.

## Relatórios

O pedido que nasce pelo webhook não passou por «Conversas». Nos relatórios de funil e de conversão (`relatorios-bellacapri.sql`) há uma coluna
**origem** (`whatsapp`, `webhook`, `outros`): compare a conversão **dentro** de cada origem, nunca entre elas, ou o webhook infla a taxa da conversa à compra.
