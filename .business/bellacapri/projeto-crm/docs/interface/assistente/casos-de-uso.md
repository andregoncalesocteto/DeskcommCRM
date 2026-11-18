# Casos de uso — Assistente do atendente

Escopo: o atendente descreve o pedido em linguagem natural, por texto ou voz, e o assistente **propõe** ações que o
servidor valida e aplica ao pedido. Regras do PRD e do ADR-005: o assistente nunca confirma o pedido, nunca envia ao ERP
e nunca grava por conta própria; CPF, telefone e e-mail do cliente não vão ao modelo. Fora deste documento: as telas
do modo manual (já definidas em "Identificar cliente", "Consultar produto" e "Fazer o pedido").

## UC01 — Pedir ao assistente

**Atores:** primário Atendente; secundários Assistente (IA) e ERP (MCP).

**Objetivo:** montar ou ajustar o pedido falando ou digitando, em vez de percorrer as telas.

**Pré-condições:** módulo PDV instalado; assistente disponível e com orçamento de IA.

**Pós-condições:** as ações válidas foram aplicadas ao pedido e o Atendente vê o que mudou; nada foi confirmado nem enviado.

**Fluxo principal**
1. O Atendente digita ou dita o pedido ("delivery para a Maria Oliveira, uma calabresa G e uma coca 2L").
2. O sistema transcreve a voz no navegador, quando houver voz, e mostra o texto.
3. O assistente devolve ações estruturadas: identificar cliente, definir tipo, loja e endereço, adicionar ou remover item, ou consultar pendências.
4. O sistema valida cada ação contra o ERP (cliente existe, item existe e está disponível, loja entrega no endereço, preço atual).
5. O sistema aplica as válidas ao pedido e destaca o que mudou.
6. O Atendente confere e segue pelo fluxo normal.

**Fluxos alternativos e de exceção**
- 3a. Mais de um cliente possível: o sistema mostra as opções e o Atendente escolhe.
- 3b. Cliente não encontrado: o sistema oferece a busca ou, quando houver, o cadastro.
- 3c. Item ambíguo ou indisponível: o assistente pergunta ou sugere uma alternativa, sem inventar.
- 4a. Ação recusada na validação: nada é aplicado e o sistema mostra o motivo.
- 4b. ERP fora do ar: o sistema não aplica nada e informa.
- 1a. Assistente indisponível, falha do provedor ou orçamento esgotado: o PDV segue no modo manual e o sistema diz por quê.
- 2a. Sem suporte a voz no navegador: o sistema esconde a voz e deixa só o texto.
- 5a. Interpretação errada de sabor ou quantidade: o Atendente corrige pelo modo manual ou pedindo de novo; a ação anterior pode ser desfeita (`[A DEFINIR]`).

## UC02 — Ver o que falta para finalizar

**Atores:** primário Atendente; secundário Assistente (IA).

**Objetivo:** saber o que impede a finalização e resolver com um clique.

**Pré-condições:** pedido em montagem.

**Pós-condições:** o Atendente conhece as pendências e pode resolvê-las.

**Fluxo principal**
1. O Atendente pergunta "O que falta?" (digitando, dizendo ou acionando o botão).
2. O sistema lista as pendências do pedido (cliente, tipo, loja, endereço, itens, forma de pagamento).
3. Cada pendência traz um botão que leva à tela que a resolve.

**Fluxos alternativos e de exceção**
- 2a. Nada falta: o sistema diz que o pedido está pronto para confirmar.
- 1a. Assistente indisponível: a lista de pendências continua disponível sem IA.

## UC03 — Acompanhar o uso e o custo do assistente

**Atores:** primário Gerente.

**Objetivo:** saber quanto o assistente é usado e o que custa, e o que ele propôs, aplicou e recusou.

**Pré-condições:** papel de gerente ou acima.

**Pós-condições:** nenhuma alteração.

**Fluxo principal**
1. O Gerente abre o painel do assistente.
2. O sistema mostra, por atendente e por período, as ações propostas, aplicadas e recusadas, o custo de IA e a origem dos itens (manual ou assistente).

**Fluxos alternativos e de exceção**
- 2a. Sem uso no período: o sistema mostra o estado vazio.
- 2b. Orçamento perto do teto: o sistema destaca o aviso `[A DEFINIR]` quanto ao teto e a quem é avisado.

## Relacionamentos
- UC01 `<<include>>` validação contra o ERP e aplicação ao pedido (as mesmas regras do modo manual).
- UC02 `<<extend>>` UC01 (pode ser pedido ao assistente ou pelo botão).

## Diagrama
Ver [diagrama-casos-de-uso.mmd](diagrama-casos-de-uso.mmd).

## Decisões registradas
- O assistente só propõe; o servidor valida e aplica; quem confirma é sempre o atendente (ADR-005).
- O que o modelo recebe: primeiro nome e o necessário para montar o pedido; nunca CPF, telefone nem e-mail.
- Cada item guarda se entrou manualmente ou pelo assistente.
- Sem assistente, o PDV funciona inteiro no modo manual.

## Pendências `[A DEFINIR]`
1. **Desfazer** a última aplicação do assistente: existe? Como?
2. **Teto de orçamento de IA** do assistente: por atendente, por dia ou por mês, e quem é avisado ao chegar perto.
3. **Voz:** só transcrição do navegador (assumido pelo PRD) em português? Outros idiomas?
4. **Quem vê o painel (UC03):** gerente e administrador, ou também o atendente o próprio uso?
