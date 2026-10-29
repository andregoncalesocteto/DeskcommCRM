# Verificação no navegador: cadastro de eventos do funil (US-016 e US-017)

**Data:** 29/10/2026 · **Como:** `dev-browser` (Playwright) dirigindo a tela real de **Configurações › Funis**, servida por `next dev -p 3100` com o código da branch `ralph/eventos-do-funil`, contra o banco da stack local (organização RPA - Abrão Thomé, funil **Pedidos**). Entrada com um **usuário gerente temporário**, criado e apagado no fim (conferido). Cada passo foi confirmado também no banco.

## O que foi feito, como uma pessoa faria

| # | Passo na tela | Resultado observado | Captura |
|---|---|---|---|
| 1 | Abrir o funil Pedidos e rolar até "Para onde o card vai em cada evento" | Estado vazio: "Este funil ainda não tem eventos cadastrados…" e o botão "Cadastrar um evento" | `us016-01-vazio.png` |
| 2 | Cadastrar "Compra concluída" (`purchase`) → etapa Compras; opções avançadas: guardar em `pedido`, valor em `value`, repetição por `order_id`, desligar "Respeitar o que a equipe moveu à mão" | Formulário preenchido e salvo; o banco gravou etapa Compras, `reais`, `respects_manual_move = false` | `us016-02-formulario-preenchido.png`, `us016-03-evento-criado.png` |
| 3 | Cadastrar um segundo evento guardando no **mesmo lugar** (`pedido`) | Aviso na resposta e nas duas linhas: "…guarda o conteúdo no mesmo lugar: o último que chegar sobrescreve o outro." O evento foi salvo (aviso não bloqueia) | `us017-01-avisos.png` |
| 4 | Cadastrar um evento que leva à etapa **Compras sem o campo do valor** | Aviso na linha: "Esta etapa fecha a venda, mas o evento não define o valor, então a venda não será enviada como conversão." | `us017-01-avisos.png` |
| 5 | Digitar `cupom` (campo declarado da ficha) em "Guardar o último conteúdo recebido em" | Erro de bloqueio "«cupom» já é um campo da ficha deste funil…" e o botão Salvar **desabilitado** | `us017-02-bloqueio.png` |
| 6 | Digitar a chave `Chave Ruim` | Erro "A chave usa minúsculas, números e _…" antes de enviar | — |
| 7 | Editar o evento que **nunca recebeu nada** | Chave editável; renomear para "Compra finalizada" enviou só o nome | — |
| 8 | Editar o evento que **já recebeu registros** (`page_view`) | Chave trancada, com a explicação "…já recebeu registros, então a chave não pode mais mudar."; salvar sem mudar nada fecha sem chamar a API | `us016-04-chave-trancada.png` |
| 9 | Desativar e ativar um evento | Selo "Desativado" aparece e some; com o outro evento desativado, o aviso de "mesmo lugar" some da linha da compra | `us016-05-desativado.png` |
| 10 | Enviar uma compra pela ferramenta `crm_track_event` (token temporário) e recarregar a tela | O card foi a Compras (`won`, `value_cents` 7390); a tela passou a mostrar "Visto pela última vez em 29/10/2026, 18:28 · 1 nos últimos 7 dias" e a chave de `purchase` ficou trancada | `us016-06-uso-apos-evento.png` |

Os sinais de uso vêm do histórico real: o evento `page_view` já mostrava a última vez e "3 nos últimos 7 dias" por causa dos registros de teste do dia anterior neste funil.

## Conferência no banco e na auditoria

Ao final dos passos 1 a 9, `api_audit_log` tinha `pipeline_event.created` ×3, `pipeline_event.updated` ×2 e `pipeline_event.deactivated` ×1.

## Limpeza

Pedido de teste, atividades, os eventos cadastrados, o token temporário, o vínculo e o **usuário temporário** (apagado pela API de administração do Auth) foram removidos. Sobras conferidas por consulta: **0 | 0 | 0 | 0 | 0**.

## O que esta verificação não cobre

- Só **um viewport** (1400 × 1000). Não foi medido em celular nem com leitor de tela.
- Não foi exercitado o caso de uma etapa de destino arquivada **na tela real** (coberto em teste de componente e nas rotas).
- O estilo (cores, espaçamento) foi olhado pelas capturas, não medido por ferramenta.
