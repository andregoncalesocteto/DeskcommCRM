# Rastreador v2: eventos do visitante anônimo, associados ao contato quando ele se identifica

**Data:** 30/10/2026 · **Status:** ideia registrada, **sem desenho fechado e sem implementação**. É uma feature nova, separada de
"Eventos do funil" (etapas 1 a 3, já entregues). Este texto guarda o debate para a próxima sessão não recomeçar do zero; o desenho
final (contrato, tela, testes) ainda precisa ser feito e aprovado.
**Origem:** conversa de 30/10/2026 sobre o cardápio da Bella Capri aberto fora do WhatsApp (Instagram, Google, link direto).

## Problema

O rastreador de hoje (`public/rastreador/v1.js`) só conta o que faz quem chegou com `?idtrack=<id do contato>` na URL. Esse código
nasce na conversa do WhatsApp: o agente manda o link do cardápio já com ele. Quem chega por outro caminho não tem `idtrack`:

- o script **não envia nada** e descarta o evento, sem segunda chance (`docs/integracao/rastreador-do-cardapio.md`);
- o servidor **nunca cria** contato nem pedido (`lib/tracker/identificar-pedido.ts`): só acha o pedido aberto de um contato que já
  existe, no funil da chave;
- então a navegação de quem entra direto (viu item, montou o carrinho) se perde, mesmo que ele acabe comprando.

Hoje a compra de quem entra direto só chega pelo **webhook de entrada** (`docs/integracao/webhook-ou-rastreador.md`), sem a
navegação que veio antes.

## A ideia

Registrar os eventos de **todo visitante, anônimo ou logado**. Quando ele se identifica (login, telefone no fechamento do pedido),
uma etapa de **identify** associa o que ele já fez ao contato. **O evento de compra nunca é anônimo**: ele só existe depois da
identificação, então já nasce com contato.

## Decisões já tomadas na conversa

1. **É uma feature nova**, tratada à parte. Não reabre as etapas 1 a 3 de "Eventos do funil".
2. **Compra nunca é anônima.** O `purchase` não entra em nenhuma fila de anônimo.
3. **Quem entra por outro caminho precisa de um `identify`**, equivalente ao que o "pedido" já faz hoje quando o cliente é
   conhecido.
4. **Vai numa versão nova do script (`public/rastreador/v2.js`).** A `v1` continua como está: o contrato dela ("sem `idtrack`,
   nada é enviado") é parte do que já foi instalado e não pode mudar por baixo de quem o usa. A pasta `public/rastreador/` existe
   justamente para isso.

## Pontos em aberto (a decidir no desenho)

### A. Onde os eventos anônimos ficam até a identificação

| | A. No servidor | B. No navegador, enviado depois (**recomendada**) |
|---|---|---|
| Antes do login | Tabela nova no CRM, ligada a um `anon_id` | Fila local do script (`localStorage`) |
| Identificação | O backend avisa "este `anon_id` é o contato X" e o CRM reproduz os eventos | O backend do cardápio acha ou cria o contato e o pedido; a página passa a ter o `idtrack` e envia a fila pela coleta de hoje |
| Mudança no CRM | Tabela nova (migration + baseline), RLS, expurgo, limite por visitante, endpoint de junção | Quase nenhuma: garantir contato e pedido pelo backend (MCP) |
| LGPD | Pesada: o CRM guarda comportamento de quem não se identificou | Leve: nada sai do navegador antes da identificação |
| Troca de aparelho | Preserva o histórico se identificar nos dois | Perde |
| Ruído | Todo `page_view` anônimo vira linha | Só chega o que valeu a identificação |

**Recomendação registrada: começar pela B.** Ela atende o caso pedido sem o CRM guardar dados de quem não se identificou, e dá para
migrar para a A depois se o cardápio precisar do histórico entre aparelhos. Esta escolha ainda não foi confirmada pelo dono do
produto.

### B. Quem faz o `identify` (decisão de segurança)

Se o **navegador** mandar o telefone ao CRM, duas coisas dão errado: qualquer um descobre quem é cliente (oráculo de existência,
que hoje o servidor evita respondendo igual para `idtrack` existente e inexistente) e qualquer um pode encher o pedido de um
desconhecido com eventos falsos. Portanto o `identify` que liga telefone a contato deve ser feito pelo **servidor do cardápio**,
autenticado com token `dsk_` (MCP ou webhook), e o navegador só recebe de volta o `idtrack`. Dentro da B, o que o navegador faz é
enviar a fila acumulada, já com o `idtrack`, pela porta pública de coleta.

### C. Criação de contato e de pedido na identificação

Hoje o rastreador nunca cria. Quem acaba de se identificar e nunca falou no WhatsApp não tem contato nem pedido aberto, e a coleta
descartaria o evento. É preciso decidir se identificar-se cria o pedido (na proposta: sim, em "Carrinho", se houver carrinho na
fila) e quem o cria (o backend, pelo MCP: `crm_create_lead` já existe, e `crm_add_lead_events` para o histórico).

### D. Limites da coleta que a fila precisa respeitar

- no máximo **20 eventos por chamada** (`MAX_EVENTOS_DO_NAVEGADOR`) e **64 KB** (`MAX_BYTES_DA_CHAMADA`): a fila é enviada em lotes;
- evento com mais de **30 dias** é recusado (`hora_fora_da_janela`): a fila precisa ter validade igual ou menor;
- `event_id` estável: reenviar não duplica, o que torna o envio da fila seguro de repetir;
- o movimento do pedido só avança, e o navegador não perde pedido nem fecha compra sem estado anterior: isso continua valendo.

### E. Casos de borda

- **Mesmo aparelho, duas pessoas** ou **uma pessoa, dois aparelhos**: regra simples proposta, a primeira identificação vale; o que
  vier depois da identificação vai direto para o contato.
- **Consentimento e opt-out:** o `optOut` do script já existe e passa a apagar também a fila local.
- **Origem do visitante:** enviar `origem` (por exemplo lida de `?utm_source=`) dentro do `data` do evento já funciona, porque o
  `data` é livre. Só passa a valer para quem for identificado.
- **Mesma compra por duas portas:** vale o aviso de `webhook-ou-rastreador.md`. O rastreador conta a navegação e **não** envia
  `purchase`; a compra vem por uma porta só.

## Destino da mudança (DoD 18)

A confirmar no desenho. A forma B é quase toda no script e no contrato com o cardápio, e o núcleo continua inteiro sem ela; a
forma A mexe no banco do núcleo. Aplicar a pergunta de `docs/doctrine/extensoes.md`: "se nenhuma organização ativar isto, a operação
comum continua inteira?".

## Esforço (estimativa, sem medição)

- **B:** pequena. A `v2.js` com fila e `identify`, o contrato para o backend do cardápio, os testes e o guia.
- **A:** duas a três vezes maior. Uma etapa nova com tabela, RLS, expurgo, limites por visitante e endpoint de junção.

## Próximos passos

1. Confirmar a forma (A ou B) com o dono do produto.
2. Escrever o desenho completo: contrato do `identify` para o backend, regras da fila e do pedido novo, modelo de erro, testes
   (integração e e2e pela tela, DoD 12) e o Living System Checklist.
3. Só então abrir a feature (PRD, `prd.json`, cenários de teste) e implementar.

## Referências

- `docs/superpowers/specs/2026-10-29-eventos-do-funil-design.md` (etapa 1) e `docs/design/eventos-do-funil.md` (etapas 2 e 3).
- `docs/integracao/rastreador-do-cardapio.md` e `docs/integracao/webhook-ou-rastreador.md`.
- `lib/tracker/identificar-pedido.ts` (como o pedido é achado hoje) e `lib/tracker/coleta.ts` (limites da porta pública).
- `public/rastreador/v1.js` (o script atual, a versão que esta feature não altera).
