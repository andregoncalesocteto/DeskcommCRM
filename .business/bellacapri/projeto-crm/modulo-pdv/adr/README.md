# ADRs do módulo PDV

Numeração própria do projeto Bella Capri (ADR-001 em diante), separada dos ADRs do DeskcommCRM em `docs/adr/`. Um ADR documenta **uma** decisão; depois de **Aceito**, não se edita: cria-se outro que o substitua.

Origem: [design-modulo-pdv.md](../design-modulo-pdv.md), seção 10. O arquivo `design-docs/templates/ADR_TEMPLATE.md` não existe neste repositório; usei as quatro seções do comando `gen-adr` mais um cabeçalho de status.

| ADR | Decisão | Status |
| --- | --- | --- |
| [ADR-001](ADR-001-tenants-e-lojas.md) | Tenants por unidade operacional, lojas como dado do módulo | **Aceito** (2026-11-16) |
| [ADR-002](ADR-002-cliente-mestre-no-erp.md) | ERP como cadastro mestre de cliente, contato espelho no CRM | **Aceito** (2026-11-16) |
| [ADR-003](ADR-003-pedido-em-tabelas-de-modulo.md) | Pedido do PDV em tabelas próprias do módulo | **Aceito** (2026-11-16) |
| [ADR-004](ADR-004-transporte-do-erp.md) | Camada única para o ERP, começando por MCP | Proposto, condicionado à prova 0.4 |
| [ADR-005](ADR-005-assistente-propoe-servidor-valida.md) | Assistente propõe ações, o servidor valida e aplica | **Aceito** (2026-11-16) |
| [ADR-006](ADR-006-envio-do-pedido-ao-erp-pelo-event-log.md) | Envio do pedido ao ERP por handler do `event_log` | **Aceito** (2026-11-16) |
| [ADR-007](ADR-007-vinculo-do-contato-por-acao-do-atendente.md) | Vínculo cliente do ERP e contato do CRM por botão, pelo telefone | **Aceito** (2026-11-18); a recusa do telefone de outro cliente foi alterada pelo ADR-008 |
| [ADR-008](ADR-008-um-contato-varias-fichas-do-erp.md) | Um contato com várias fichas do ERP; o atendente escolhe se sobrescreve | **Aceito** (2026-11-18) |

**Estados:** Proposto, Aceito, Rejeitado, Substituído por ADR-NNN.

## Notas de revisão (fora dos ADRs aceitos)

- **ADR-006, idempotência do ERP (2026-11-16):** o ADR deixou como obrigação confirmar que o ERP aceita chave de idempotência em `criar_pedido`. O dono do projeto confirmou que **consegue implementar**: a mesma chave repetida devolve o mesmo pedido, sem criar outro. Entra como requisito do handoff E6 e a pergunta 5 do contrato está respondida.
- **ADR-005, evolução desejada (2026-11-16):** o ADR aceito proíbe o assistente de propor `confirmar` o pedido. Perguntado se isso poderia mudar no futuro, o dono do projeto respondeu que **sim, desde que haja confirmação explícita na tela** (o assistente propõe, e o atendente clica para confirmar). Isso contradiz uma proibição do ADR-005 e, por ele estar aceito, exige um **ADR novo que o substitua**. Ainda **não foi escrito**: fica como item de backlog, para quando o assistente estiver em uso e o piloto mostrar a necessidade.
- **ADR-004, prova 0.4 (2026-11-16):** o dono do projeto manteve o ADR **Proposto** até a prova rodar. A prova cobre exatamente quatro pontos: (1) o cliente MCP externo do CRM funciona fora de um turno de conversa, chamado de uma rota e de um worker; (2) a latência cabe nas metas (busca em até 3 segundos, preço do item em até 1 segundo); (3) o tempo limite padrão de 15 segundos serve ao `criar_pedido`; (4) o tenant de origem chega ao ERP em toda ferramenta. Com o resultado, o ADR é aceito ou substituído por outro.
- **ADR-003, pedido dos outros canais (2026-11-16):** o ADR deixou em aberto se o pedido de WhatsApp e app ficaria num módulo opcional. O dono do projeto confirmou que **sim**: todo o programa Bella Capri é um módulo opcional no fork da rede, e os outros canais (FR-003, FR-007, FR-011 a FR-013) usam as mesmas tabelas `pdv_*`. Não há plano de mover a entidade para o núcleo.
- **ADR-002, contingência (2026-11-16):** o ADR deixou em aberto o que o PDV faz com o ERP fora do ar ao identificar cliente. O dono do projeto decidiu **avisar e esperar**: a busca mostra erro com botão de tentar de novo, não há cadastro provisório de contatos do CRM, e o atendente não registra o pedido até o ERP voltar.
- **ADR-001, esclarecimento do dono do projeto em 2026-11-16:** "o tenant do call center nada mais é que um agrupador de todas as lojas; Rio Preto agrupa RPA, RPI etc., o call center agrupa RPA, RPI, CAS etc." Leitura: a mesma loja pode constar em mais de um tenant, como uma linha de `pdv_stores` em cada um (a unicidade é por tenant e sigla). Isso é compatível com o texto aceito. **Resolvido em 2026-11-16** (o dono do projeto confirmou que basta): o pedido que o call center registra para uma loja de outro tenant fica **só no tenant do call center**; os números por loja saem do ERP, e **não há cópia** no tenant da loja. Como o CRM isola os dados por tenant, "agrupador" não cria visão compartilhada de pedidos.
