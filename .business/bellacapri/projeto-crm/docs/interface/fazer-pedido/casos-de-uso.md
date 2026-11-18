# Casos de uso — Fazer o pedido no PDV

> **Rascunho anterior ao protótipo (2026-11-18).** O protótipo `cart-craft-counter` é a especificação do produto
> ([especificacao-prototipo.md](../prototipo/especificacao-prototipo.md)); onde este documento difere dela, vale a
> especificação. Este rascunho segue útil só para o que o protótipo não tem por ser local: integração com o ERP (envio,
> recusa, reenvio) e validação das ações do assistente.

Escopo: do carrinho ao pedido aceito pelo ERP: configurar a pizza, revisar o carrinho, definir tipo, loja e
endereço, confirmar, enviar e acompanhar o resultado. Fora deste documento: identificar cliente e consultar
produto (já escritos), histórico e recompra, assistente, cadastro de cliente, cobrança e link de pagamento.

Decisões do dono do projeto (2026-11-18): o **pagamento só registra a forma pretendida e o troco**; o pedido só vai ao
ERP **depois de o atendente confirmar com um clique**; loja de entrega **fora do tenant** é **recusada com aviso**.
Preço, taxa, tempo e total vêm do ERP; o PDV não calcula valor. Os dados vêm do ERP por MCP (hoje, por um mock, ADR-009).

## UC01 — Configurar pizza

**Atores:** primário Atendente; secundário ERP (MCP).

**Objetivo:** montar uma pizza (tamanho, meio a meio, adicionais, ingredientes removidos e observação) com o preço do
ERP a cada mudança, e colocá-la no carrinho.

**Pré-condições:** produto de tipo pizza escolhido na consulta (extensão do UC02 de "Consultar produto"); cliente identificado.

**Pós-condições:** a pizza configurada está no carrinho, com o preço do ERP.

**Fluxo principal**
1. O Atendente aciona "Adicionar" num produto do tipo pizza e o sistema abre o configurador.
2. O Atendente escolhe o tamanho.
3. O Atendente opcionalmente escolhe meio a meio, indicando o segundo sabor.
4. O Atendente opcionalmente marca adicionais e ingredientes a remover e escreve uma observação.
5. A cada mudança, o sistema pede o preço ao ERP e mostra o valor do item.
6. O Atendente informa a quantidade (inteira) e confirma.
7. O sistema inclui a pizza no carrinho e volta à consulta.

**Fluxos alternativos e de exceção**
- 2a. Tamanho indisponível no ERP: o sistema não oferece a opção ou a desabilita com o motivo.
- 3a. Sabor do meio a meio indisponível: o sistema não aceita o sabor e informa.
- 5a. ERP fora do ar ou lento: o sistema mostra o erro com "Tentar de novo" e não deixa confirmar sem preço.
- 5b. O preço muda enquanto o Atendente configura: vale o último devolvido pelo ERP.
- 6a. Quantidade vazia, zero ou decimal: o sistema não confirma e pede um inteiro positivo.
- 7a. Pizza idêntica já no carrinho (mesma configuração): o sistema soma a quantidade.

## UC02 — Revisar o carrinho

**Atores:** primário Atendente; secundário ERP (MCP).

**Objetivo:** conferir os itens e o total antes de fechar, ajustando quantidades e removendo itens.

**Pré-condições:** carrinho com ao menos um item.

**Pós-condições:** carrinho atualizado, com o total do ERP.

**Fluxo principal**
1. O Atendente abre o carrinho.
2. O sistema lista cada item com a configuração, a quantidade, o preço do ERP e o total.
3. O Atendente altera a quantidade ou remove itens.
4. A cada mudança, o sistema recalcula o total pelo ERP.
5. O Atendente segue para definir o tipo do pedido (UC03).

**Fluxos alternativos e de exceção**
- 2a. Carrinho vazio: o sistema mostra o estado vazio e leva de volta à consulta.
- 2b. Item que ficou indisponível: o sistema destaca o item e impede seguir até removê-lo.
- 4a. ERP fora do ar: o sistema mantém o último total, avisa que está desatualizado e não deixa seguir.
- 4b. Falha ao remover ou alterar: o sistema informa e mantém o carrinho.

## UC03 — Definir tipo do pedido, loja e endereço

**Atores:** primário Atendente; secundário ERP (MCP).

**Objetivo:** dizer se o pedido é de balcão ou de entrega e deixar definidos a loja e, na entrega, o endereço.

**Pré-condições:** carrinho com itens; cliente identificado.

**Pós-condições:** tipo, loja, origem (telefone ou balcão) e, na entrega, endereço definidos, com taxa e tempo do ERP.

**Fluxo principal**
1. O Atendente escolhe balcão ou entrega.
2. Balcão: o Atendente escolhe a loja entre as que o tenant atende; se o tenant atende uma só, ela já vem definida.
3. Entrega: o Atendente escolhe um dos endereços do cliente.
4. O sistema pede ao ERP a loja que entrega nesse endereço e mostra a loja, a taxa e o tempo estimado.
5. O sistema grava a origem do pedido (telefone ou balcão), separada do tipo.
6. O Atendente segue para confirmar (UC04).

**Fluxos alternativos e de exceção**
- 3a. Cliente sem endereço: o sistema não deixa seguir na entrega e leva a adicionar um endereço (UC03 de "Identificar cliente").
- 4a. Endereço fora da área de todas as lojas: o sistema não deixa seguir e orienta trocar o endereço.
- 4b. A loja calculada não pertence ao tenant do Atendente: o sistema **recusa e avisa**, sem registrar o pedido.
- 4c. ERP fora do ar: o sistema informa e não deixa seguir.
- 2a. Nenhuma loja ativa para o tenant: o sistema avisa que não há loja e leva à aba Lojas (para quem tem permissão).

## UC04 — Confirmar e enviar o pedido

**Atores:** primário Atendente; secundários ERP (MCP) e Worker de envio do CRM.

**Objetivo:** conferir tudo, registrar a forma de pagamento pretendida e confirmar, para o pedido seguir ao ERP uma única vez.

**Pré-condições:** carrinho sem item indisponível; tipo, loja e, na entrega, endereço definidos.

**Pós-condições:** pedido gravado como confirmado e enviado ao ERP em até 60 segundos, ou mantido como rascunho com aviso.

**Fluxo principal**
1. O sistema mostra o resumo: cliente, tipo, loja, endereço, itens, taxa, tempo estimado e total do ERP.
2. O Atendente informa a forma de pagamento pretendida e, quando couber, o troco.
3. O Atendente aciona "Confirmar pedido".
4. O sistema grava o pedido como confirmado, com uma chave de idempotência, e confirma ao Atendente que foi para a fila.
5. O Worker envia o pedido ao ERP.
6. O ERP aceita e devolve o número do pedido; o sistema o registra e o mostra ao Atendente.

**Fluxos alternativos e de exceção**
- 2a. Forma de pagamento não escolhida: o sistema não confirma e pede a escolha.
- 3a. Duplo clique: o sistema trata como um só pedido.
- 4a. O preço mudou desde o carrinho: o sistema mostra o total do ERP, avisa a diferença e exige uma nova confirmação.
- 5a. ERP fora do ar ou tempo esgotado: o pedido permanece confirmado na fila com novas tentativas, o Atendente é avisado e há "Reenviar".
- 6a. O ERP recusa o pedido: o sistema registra o motivo e o mostra; o pedido volta a poder ser corrigido (UC05).

## UC05 — Acompanhar o resultado e corrigir ou reenviar

**Atores:** primário Atendente; secundário ERP (MCP).

**Objetivo:** saber em que estado está o pedido e agir quando não foi aceito.

**Pré-condições:** pedido confirmado.

**Pós-condições:** pedido aceito, ou corrigido e reenviado, ou cancelado.

**Fluxo principal**
1. O Atendente abre o pedido (ou volta a ele pelo aviso).
2. O sistema mostra o estado: na fila, enviado, aceito (com o número do ERP) ou recusado (com o motivo).
3. Se foi recusado, o Atendente corrige o que o motivo apontar e reenvia.
4. O sistema reenvia com a mesma chave de idempotência, sem criar um segundo pedido.

**Fluxos alternativos e de exceção**
- 2a. Pedido parado na fila além do limite: o sistema destaca o atraso e abre o aviso na Central.
- 4a. Reenvio de pedido que o ERP já aceitou: o sistema devolve o mesmo pedido, sem duplicar.
- 5a. Cancelar o pedido: `[A DEFINIR]` quem pode e até que estado.

## Relacionamentos
- UC01 `<<extend>>` "Adicionar produto ao carrinho" (Consultar produto UC02), só para pizza.
- UC03 `<<include>>` "Gerenciar endereços" (Identificar cliente UC03), quando o cliente não tem endereço.
- UC04 `<<include>>` UC03; UC05 `<<extend>>` UC04 (recusa, atraso ou reenvio).

## Diagrama
Ver [diagrama-casos-de-uso.mmd](diagrama-casos-de-uso.mmd).

## Decisões registradas
- Atendente confirma com um clique; não há envio automático.
- Pagamento: só a forma pretendida e o troco. Sem cobrança nem link.
- Loja fora do tenant: recusa com aviso.
- O PDV não calcula preço, taxa nem total.
- Reenvio e clique duplo nunca criam um segundo pedido.

## Pendências `[A DEFINIR]`
1. **Formas de pagamento:** lista fixa (por exemplo dinheiro, cartão na entrega, PIX) ou vinda do ERP? Quais?
2. **Troco:** só quando a forma é dinheiro? Pede o valor "troco para" ou o valor do troco?
3. **Observação geral do pedido:** existe, além da observação por item? Limite de caracteres?
4. **Rascunho:** um por atendente ou vários ao mesmo tempo (ligações em paralelo)? Sobrevive a fechar o navegador, e por quanto tempo?
5. **Cancelamento depois de enviado:** quem pode e até que estado do pedido (pergunta 8 do contrato, ainda sem resposta do ERP).
6. **Meio a meio:** no máximo dois sabores? A regra de preço é do ERP (assumido).
