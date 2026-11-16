# ADR-006: O envio do pedido ao ERP por handler do `event_log`

Status: Aceito
Data: 2026-11-16
Aceito em: 2026-11-16, pelo dono do projeto, sem alterações no texto
Origem da decisão: o pedido rascunho no CRM, enviado por worker idempotente, é decisão do PRD pai. O uso do `event_log` e o desenho da retentativa são proposta do Design Doc.

## 1. Contexto

- O PRD pai exige que o pedido confirmado chegue ao ERP em até 60 segundos, sem duplicar, e que o ERP fora do ar não perca o pedido: ele fica como rascunho, com aviso a um humano.
- A doutrina do CRM: um trigger de banco nunca faz HTTP; ele emite uma linha em `event_log`, e um worker consome e dispara o efeito externo. Toda criação aceita `Idempotency-Key`, com recibo no Postgres.
- Pelo que foi lido no CRM:
  - o `worker` do compose de produção drena o `event_log` em 2 segundos com fila e até 10 segundos parado; o cron de 1 minuto continua como rede de segurança;
  - cada linha é reivindicada com um claim otimista, o que torna seguro rodar worker e cron juntos;
  - há retentativa com atraso e, quando o evento esgota as tentativas, um aviso na Central (`event_dead`).
- O ERP ainda não tem API: **não está confirmado** que ele aceite chave de idempotência na criação do pedido (pergunta 5 do contrato).

## 2. Decisão

Vamos enviar o pedido confirmado ao ERP por um **handler do `event_log`**, de forma **idempotente e com retentativa**, em vez de dentro da requisição da tela, usando a mesma chave de idempotência do CRM até o ERP.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | Chamar o ERP de forma síncrona no `confirmar` | Resposta imediata ao atendente | ERP fora do ar vira erro na tela; sem retentativa nem rastro; efeito externo dentro da requisição | Rejeitada |
| 2 | Rotina agendada própria só para o PDV | Controle total do ritmo | Duplica o mecanismo que o CRM já tem; mais um processo para operar | Rejeitada |
| 3 | **Handler do `event_log` drenado pelo worker** | Reaproveita fila, retentativa, claim otimista e aviso; envio em segundos; segue a doutrina | Depende de o worker estar de pé (o cron cobre a falha); precisa de idempotência de ponta a ponta | **Escolhida** |

## 4. Consequências

**Positivas**
- O envio em até 60 segundos é viável sem mudar a infraestrutura.
- O pedido nunca se perde: fica `confirmado`, com tentativas registradas e aviso ao esgotar.
- Cada tentativa fica registrada, com resultado, erro e duração.

**Negativas e trade-offs**
- O atendente vê o pedido como "na fila" por alguns segundos, e a tela precisa acompanhar o estado (Realtime ou consulta curta).
- Sem idempotência no ERP, uma retentativa depois de um timeout pode duplicar o pedido.
- O estado `recusado` exige tela de correção, porque recusa do ERP não se resolve por retentativa.

**Obrigações criadas**
- Evento `pdv.pedido_confirmado` com payload sem dado pessoal, e handler registrado no ponto central de handlers.
- Tipo novo de aviso na Central ("pedido não enviado ao ERP"), com migration, texto e política de destino, e o invariante de vocabulário do CRM.
- Confirmar com o ERP a idempotência de `criar_pedido`; se não houver, definir outra forma de evitar duplicidade antes de implementar o handler.
- Medir o tempo de `confirmado` até `enviado` com o handler real, contra a meta de 60 segundos.
