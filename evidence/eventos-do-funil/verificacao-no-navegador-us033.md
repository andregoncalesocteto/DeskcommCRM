# Verificação no navegador: valor e itens do pedido na fonte do webhook (US-033)

**Data:** 29/10/2026 · **Como:** `dev-browser` dirigindo **Webhooks › a fonte** (painel lateral), com `next dev -p 3100` e a branch, contra o banco da stack local (funil **Pedidos**), com um **gerente temporário** (criado e apagado). Fonte temporária com a etapa padrão **Compras** (etapa de ganho). As migrations 9042 e 9043 foram aplicadas no banco local antes.

| # | Passo | Resultado observado | Captura |
|---|---|---|---|
| 1 | Abrir a fonte | Seção «Valor e itens do pedido» com explicação em linguagem simples (sem nome de coluna). Aviso: «A etapa padrão desta fonte «Compras» fecha a venda, mas nenhum campo do valor foi configurado…». Aviso fixo: «Todo envio desta fonte leva o card para a etapa «Compras». Para o pedido andar por várias etapas…, use os eventos do funil.» | `us033-01-avisos.png` |
| 2 | Preencher `pedido.total` (reais) e `pedido_json`, salvar | PATCH 200; o banco guardou `pedido.total reais pedido_json`; o aviso de ganho sem valor **sumiu** | `us033-02-salvo.png` |
| 3 | Trocar a chave do JSON para `cupom` (campo da ficha do funil) e salvar | A API recusa e a tela mostra ««cupom» já é um campo da ficha deste funil: escolha outro nome para guardar o JSON do pedido.»; nada gravado | `us033-03-chave-igual-a-campo.png` |
| 4 | Envio real ao endereço da fonte (corpo com `pedido.total = 73.9` e uma lista `itens`) | HTTP 200; o card aberto do contato foi a Compras com `value_cents = 7390` e `pedido_json` guardando a lista e o bloco `pedido` | — |
| 5 | Envio com `pedido.total = "abc"` | HTTP 200; o card foi a Compras **sem valor**; o motivo (`nao_numerico`) ficou no log | — |

## Limpeza

Fonte, card, contato, capturas, vínculo e **usuário temporário** removidos. Sobras: **0 | 0 | 0 | 0**; o banco voltou a 1 organização e 1 usuário.

## O que esta verificação não cobre

- **Criação de card pelo webhook** não foi exercitada ao vivo: o banco local da stack está atrás do código (falta a migration 9028, `recurring_months`), o que faz **qualquer** criação de card por webhook responder 500 nesse banco, com ou sem esta mudança. A criação é coberta pelos testes de rota (valor em `value_cents` e JSON em `custom_fields` no `leadInput`); o caminho provado aqui foi o do card aberto reaproveitado. Quem atualiza a stack local aplica a 9028.
- Um viewport (1400 × 1100), um navegador.
- Reenvio com o mesmo `external_id` só nos testes de rota.
