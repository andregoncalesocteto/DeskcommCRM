# Prova ao vivo do webhook de entrada com valor e JSON (US-035)

**Data:** 29/10/2026 · **Ambiente:** stack local (banco da instalação, funil **Pedidos** da organização de teste), app da branch servido pelo servidor de desenvolvimento do Next na porta 3100. **Fonte temporária** com etapa padrão **Compras** (ganho), campo do valor `pedido.total` em reais, JSON em `pedido_json` e «reaproveitar o card aberto» ligado (pelo banco, porque essa opção exige assinatura pela API). Cada envio é um `curl` real ao endereço da fonte; o estado abaixo é lido do banco depois de cada passo.

> Antes da prova foi preciso aplicar no banco local a migration 9028 (`recurring_months`), que vinha do `main` e não estava lá; sem ela **toda** criação de card por webhook devolvia 500, com ou sem esta mudança. Aditiva (`add column if not exists`).

| # | Passo | Resposta | Estado do card no banco |
|---|---|---|---|
| 1 | Cliente **novo** (telefone sem contato nem card) manda um pedido finalizado: `pedido.total = 73.9` e uma lista `itens` | `200` `{"data":{"lead_id":"4aea04b5…"}}` | **1 card**, etapa **Compras**, `won`, `value_cents` **7390**, `pedido_json` presente (lista `itens` e bloco `pedido`, como vieram), origem `webhook` |
| 2 | Cliente **com card da Bella** em **Revisão** (aberto, sem valor, origem `whatsapp`) manda o pedido finalizado: `pedido.total = 59.9` | `200` com o **mesmo** `lead_id` (`84432378…`) | **1 card só** (continua 1 para o contato): foi de Revisão a **Compras** em um envio, `won`, `value_cents` **5990**, `pedido_json` presente, origem segue `whatsapp` |
| 3a | **Reenvio idêntico** do passo 2 (mesmo `external_id`) | `200`, mesmo `lead_id` | estado **idêntico** ao do passo 2 (etapa, status, valor, JSON e contagem de atividades) |
| 3b | **Reenvio idêntico** do passo 1 | `200`, mesmo `lead_id` | estado **idêntico** ao do passo 1; continua 1 card |

JSON guardado no passo 1: `{"itens": [{"qtd": 2, "nome": "Pizza grande", "item_id": "pizza-1"}], "pedido": {"forma": "pix", "total": 73.9}}`.

## Limpeza

Fonte, cards, atividades, capturas e contatos temporários apagados. Sobras conferidas: **0 | 0 | 0 | 0**; o banco voltou a 1 organização e 1 usuário.

## O que esta prova não cobre

- A fonte **sem assinatura** (a opção de reaproveitar o card foi ligada pelo banco). Em produção ela só liga com assinatura configurada.
- Pico de envios simultâneos do mesmo `external_id` (a corrida é coberta pelos testes de rota, não aqui).
- O `value_cents` do passo 2 só aparece porque o card estava aberto; se a equipe já tivesse fechado o card, o envio abriria outro (comportamento anterior, não alterado).
