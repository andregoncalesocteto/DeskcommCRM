# Handoffs para o repositório do ERP

O ERP da rede fica em outro repositório. Tudo o que precisa ser construído nele sai daqui como **um documento de handoff**, e volta como uma **devolutiva**. Cada handoff é lido por uma sessão que **não tem o contexto da conversa em que foi escrito**, então precisa se bastar.

Relacionados: [contrato-mcp-erp.md](../contrato-mcp-erp.md) (as ferramentas) e [plano-migracao-pdv-para-deskcommcrm.md](../plano-migracao-pdv-para-deskcommcrm.md) (a ordem das fases e a "Trilha do ERP e homologação").

## Regras

1. **Um handoff por fatia**, pequena o bastante para uma sessão concluir. Ele nomeia as ferramentas do contrato que entrega.
2. **Autossuficiente:** traz o contexto mínimo, o que construir, o que **não** fazer, o contrato exato (entrada e saída) e critérios de aceitação **verificáveis por comando**.
3. **Sem segredo:** chaves, senhas e URLs internas nunca entram no documento. Passam por canal seguro.
4. **Sem dado pessoal real:** a homologação só tem dados fictícios.
5. **Agnóstico de stack:** o documento diz o comportamento, não a tecnologia. A sessão do ERP escolhe e registra a stack na devolutiva.
6. **Mudou o contrato, muda aqui primeiro:** se a sessão do ERP precisar divergir do contrato, registra na devolutiva e o contrato do CRM é atualizado antes de a fatia seguinte começar.
7. **A devolutiva fecha o handoff:** o CRM só começa a tarefa que depende da fatia depois de receber a devolutiva e as amostras de resposta reais.

## Estados

`a escrever` → `pronto para enviar` → `enviado` → `em andamento` → `devolvido` → `aceito`

## Índice

| Handoff | Entrega (ferramentas) | Desbloqueia no CRM | Estado |
| --- | --- | --- | --- |
| [E0](E0-homologacao-e-listar-lojas.md) | Homologação do ERP e `listar_lojas` | 0.4, 1.3, 1.4 | pronto para enviar |
| [E1](E1-buscar-e-obter-cliente.md) | `buscar_cliente`, `obter_cliente` e dados fictícios de cliente | 2.2, 2.3 | pronto para enviar (depende do E0 devolvido) |
| E2 | `consultar_cep`, `loja_do_endereco`, `salvar_endereco`, `remover_endereco`, `definir_endereco_principal` | 2.4 | a escrever |
| E3 | `cadastrar_cliente`, `atualizar_cliente` | 2.5 | a escrever |
| E4 | `consultar_cardapio`, `consultar_disponibilidade` e cardápio fictício | 3.1 | a escrever |
| E5 | `calcular_total` | 3.2 | a escrever |
| E6 | `criar_pedido` (com chave de idempotência obrigatória), `consultar_pedido`, `cancelar_pedido` | 4.1 a 4.4 | a escrever |
| E7 | `consultar_historico_do_cliente` | 5.1 | a escrever |
| E8 | `obter_link_de_pagamento`, `consultar_funcionamento` (se confirmadas) | a definir | a escrever |

Cada handoff novo parte de [_modelo.md](_modelo.md). Os formatos exatos (JSON de entrada e saída) de cada fatia ficam em [contrato-mcp-erp-formatos.md](../contrato-mcp-erp-formatos.md) e entram lá **antes** de o handoff ser escrito. Hoje cobrem E0 e E1.
