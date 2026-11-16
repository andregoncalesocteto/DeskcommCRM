# Briefing de atendimento — Bella Capri · loja piloto RPA - Abrão Thomé

> **Para quem é:** o dono ou o gerente da loja. Quem responde sabe como o atendimento funciona hoje; a
> implantação não inventa regra, só registra a sua.
> **Estado:** modelo para preencher. Nada aqui foi respondido.
> **Nunca escreva neste documento** chave de IA, token `dsk_`, senha ou dado pessoal de cliente.
> **Como usar:** responda na coluna **Resposta**. Se não souber, escreva "não sei", que também é resposta.
> Se a regra muda por loja, diga qual é a da piloto e quais lojas diferem.

**Origem do método:** aula "Deskcomm CRM" (o briefing vem antes da implantação: fluxo de trabalho →
sistema de treinamento → orquestração). A estrutura em blocos segue o documento de exemplo da aula;
as perguntas específicas de pizzaria e de rede são sugestões, não vieram da aula.

**O que já está decidido** (não precisa perguntar de novo; está em `pacote-bellacapri-rpa.md`):
número de WhatsApp da piloto, agente 24 h, atendimento humano todos os dias 18h–23h, funil
"Pedidos — Cardápio Digital" movido pelo cardápio via MCP, teto de IA de US$ 10/mês, provedor OpenAI.

**O que trava a implantação** (marcado com 🔴): razão social, chave de IA, modelo do atendimento,
motivos de perda. O resto pode ser respondido depois, mas cada lacuna vira uma suposição no prompt.

---

## Bloco 1 — Identidade da loja

| # | Pergunta | Resposta |
|---|---|---|
| 1.1 | 🔴 Razão social e CNPJ da loja (nomeia o controlador de dados na LGPD) | |
| 1.2 | Nome fantasia como o cliente conhece | |
| 1.3 | Endereço completo, bairro e ponto de referência | |
| 1.4 | Horário de funcionamento por dia da semana (salão, retirada e entrega) | |
| 1.5 | O fuso é America/Sao_Paulo? | |
| 1.6 | Quem atende no WhatsApp hoje (nomes, turnos)? Essas pessoas serão os atendentes no sistema | |
| 1.7 | Quem é o responsável por decidir regra de atendimento (nome e papel)? | |
| 1.8 | Existe site, Instagram ou cardápio impresso que a IA pode citar? Quais endereços? | |

## Bloco 2 — Tom de voz e público

| # | Pergunta | Resposta |
|---|---|---|
| 2.1 | Como a loja fala com o cliente: formal, descontraído, com apelido ("amigo", "querido")? | |
| 2.2 | Pode usar emoji? Quais, e com que frequência? | |
| 2.3 | Há palavras ou frases que a marca usa sempre? E as que nunca usa? | |
| 2.4 | Quais são os tipos de cliente (família no fim de semana, pedido de almoço, empresa, festa)? | |
| 2.5 | Existe promoção que se repete (terça, combo, aniversário)? Como é dita ao cliente? | |
| 2.6 | A IA deve se apresentar como atendente virtual ou usar um nome? Qual? | |

## Bloco 3 — Cardápio, preço e pagamento

O cardápio digital já é a fonte dos itens. Aqui entra o que o cardápio não diz.

| # | Pergunta | Resposta |
|---|---|---|
| 3.1 | O preço é igual em todas as lojas ou muda por loja? | |
| 3.2 | O cardápio da piloto é o mesmo das outras? Há itens exclusivos de loja? | |
| 3.3 | Formas de pagamento aceitas (PIX, cartão, dinheiro, voucher) e como o cliente paga (online, na entrega) | |
| 3.4 | Dinheiro: pergunta troco? Há valor máximo de troco? | |
| 3.5 | Taxa de entrega: valor fixo, por bairro ou por distância? Pedido mínimo? | |
| 3.6 | Área de entrega: lista de bairros ou raio? O que fazer com cliente fora da área? | |
| 3.7 | Tempo estimado de entrega e de retirada, em dia normal e em dia de pico | |
| 3.8 | Personalização (meio a meio, borda, retirar ingrediente, observações): o que pode e o que não pode? | |
| 3.9 | Item esgotado: a loja avisa o cliente e sugere troca? Quem decide a troca? | |

## Bloco 4 — Regras e limites (o que a IA nunca pode fazer)

Estas respostas viram os guardrails. Seja específico: "nunca prometer prazo" é melhor que "ser cuidadoso".

| # | Pergunta | Resposta |
|---|---|---|
| 4.1 | A IA pode dar desconto? Quanto, em que caso e quem autoriza? | |
| 4.2 | A IA pode prometer prazo de entrega? Se sim, qual margem? | |
| 4.3 | A IA pode cancelar ou alterar um pedido já pago? Até quando? | |
| 4.4 | A IA pode devolver dinheiro? Quem decide reembolso? | |
| 4.5 | O que fazer com reclamação (pizza fria, item faltando, atraso)? Quem resolve e em quanto tempo? | |
| 4.6 | Assuntos que a IA não deve comentar (concorrentes, política, saúde, alergia e ingrediente sem confirmação) | |
| 4.7 | Alergia ou restrição alimentar: a IA pode afirmar que um item "não tem" um ingrediente? | |
| 4.8 | Dados do cliente (endereço, telefone): a IA pode repetir para o cliente confirmar? Há algo que nunca deve pedir? | |

## Bloco 5 — Fluxo de trabalho

| # | Pergunta | Resposta |
|---|---|---|
| 5.1 | Descreva, passo a passo, o que acontece desde o "oi" do cliente até a pizza entregue | |
| 5.2 | Em que ponto o cliente é mandado para o cardápio digital? Em que ponto a IA ajuda no pedido pelo chat? | |
| 5.3 | Quando o pedido é feito fora do cardápio (pelo chat), quem registra e como? | |
| 5.4 | Primeira resposta: em quanto tempo a loja considera aceitável hoje? (SLA) | |
| 5.5 | Fora do horário humano (antes das 18h), o que a IA deve dizer a quem pede algo que só um humano resolve? | |
| 5.6 | Loja fechada ou sem entrega no momento: o que a IA responde e até quando aceita pedido? | |
| 5.7 | Quantas conversas chegam por dia na piloto e em que horários há pico? | |
| 5.8 | O que significa "pedido concluído" para a loja (pago, entregue, avaliado)? | |

## Bloco 6 — Ramificações do atendimento

Para cada situação, responda: **o que a IA faz, quando passa para humano e o que registra.**

| # | Situação | Resposta |
|---|---|---|
| 6.1 | Cliente pergunta o cardápio sem querer pedir ainda | |
| 6.2 | Cliente quer pedir pelo chat e não pelo cardápio | |
| 6.3 | Cliente fora da área de entrega | |
| 6.4 | Item esgotado ou loja fora do ar | |
| 6.5 | Pedido atrasado (cliente pergunta "cadê minha pizza?") | |
| 6.6 | Pedido errado, faltando item ou pizza fria | |
| 6.7 | Cliente quer alterar ou cancelar depois de pagar | |
| 6.8 | Cliente só manda áudio ou foto | |
| 6.9 | Cliente já pediu antes (recompra): a IA deve lembrar o último pedido? | |
| 6.10 | Cliente irritado ou ofensivo | |
| 6.11 | Cliente pede para falar com uma pessoa | |
| 6.12 | Pedido para evento, festa ou grande quantidade | |

## Bloco 7 — Objeções

| # | Objeção do cliente | Resposta aprovada pela loja |
|---|---|---|
| 7.1 | "Está caro" | |
| 7.2 | "Demora muito" | |
| 7.3 | "Vou ver em outro lugar" | |
| 7.4 | "Prefiro pagar na entrega" | |
| 7.5 | "Vocês entregam no meu bairro?" | |
| 7.6 | Outras que a loja ouve com frequência | |

## Bloco 8 — Follow-up e handoff

O funil é movido pelo cardápio (visita, visualização, carrinho, revisão, compra). Estas respostas dizem
quando a IA reabre a conversa e quando entrega a um humano.

| # | Pergunta | Resposta |
|---|---|---|
| 8.1 | Carrinho parado: a IA deve chamar o cliente? Depois de quantos minutos? Quantas tentativas? | |
| 8.2 | Pedido na etapa de revisão sem pagamento: lembrar? Depois de quanto tempo? | |
| 8.3 | Cliente em silêncio depois de uma pergunta da IA: esperar quanto tempo antes de retomar? | |
| 8.4 | Pós-compra: pedir avaliação ou oferecer novo pedido? Quando? | |
| 8.5 | Reativação: cliente que não pede há N dias, a IA chama? Há restrição (domingo, horário)? | |
| 8.6 | Quando a IA deve passar para um humano? (lista de situações) | |
| 8.7 | Para qual pessoa vai cada tipo de caso (reclamação, reembolso, evento, dúvida)? | |
| 8.8 | 🔴 Motivos de perda que a Bella Capri quer registrar (o campo está em branco por decisão do dono) | |

## Bloco 9 — Rede de 50 lojas

| # | Pergunta | Resposta |
|---|---|---|
| 9.1 | Cada loja tem o seu WhatsApp e o seu atendimento, ou algumas compartilham número? | |
| 9.2 | As regras deste briefing valem para todas as lojas? Quais itens mudam por loja? | |
| 9.3 | Quem precisa ver mais de uma loja (gestor regional, diretoria)? Quais lojas cada um vê? | |
| 9.4 | Precisam de um relatório consolidado da rede? Com quais números e com que frequência? | |
| 9.5 | Qual a ordem de entrada das lojas depois da piloto? Há prazo? | |

## Bloco 10 — Dados técnicos (responsável: quem implanta)

| # | Item | Estado |
|---|---|---|
| 10.1 | 🔴 Chave de IA cadastrada em IA › Credenciais e marcada "validada" | pendente |
| 10.2 | 🔴 Modelo do atendimento (um que use ferramentas), escolhido em IA › Provedores | pendente |
| 10.3 | Teto de gasto confirmado (US$ 10/mês) | decidido |
| 10.4 | Endereço, horário e pagamento na memória da organização (vêm dos blocos 1 e 3) | depende do briefing |
| 10.5 | Documentos para a base de conhecimento (cardápio em PDF, regras, perguntas frequentes) | pedir ao dono |

---

## Depois de preenchido: para onde cada bloco vai

| Bloco | Vira |
|---|---|
| 1 e 3 | memória da organização e base de conhecimento |
| 2 | prompt do agente (identidade e tom de voz) |
| 4 e 6 | prompt do agente (regras) e guardrails |
| 5 | prompt do agente e desenho do funil |
| 7 | prompt do agente (matriz de objeções) |
| 8 | fluxos de follow-up, regras de handoff e motivos de perda |
| 9 | decisão de acesso por usuário e relatórios (`deskcomm-metricas`) |
| 10 | configuração do sistema |

Referências: `pacote-bellacapri-rpa.md` (o que já está decidido), `manual-rastreador-cardapio.md`
(integração do cardápio) e as skills `deskcomm-cliente-novo` e `deskcomm-prompt`.
