# Contrato do MCP do ERP: levantamento das ferramentas

Versão: 0.3 (rascunho para discussão; os formatos de entrada e saída, por fatia, estão em [contrato-mcp-erp-formatos.md](contrato-mcp-erp-formatos.md))
Data: 2026-11-16
Relacionado: [prd-call-center-pdv-visao-geral.md](prd-call-center-pdv-visao-geral.md), [prd-fr-010-pdv-balcao-e-telefone.md](prd-fr-010-pdv-balcao-e-telefone.md), [plano-migracao-pdv-para-deskcommcrm.md](plano-migracao-pdv-para-deskcommcrm.md)

> **Natureza deste documento.** É um levantamento do que o CRM precisa que o MCP do ERP ofereça, derivado dos requisitos já escritos. Nada foi acordado nem implementado. O ERP é domínio do dono do projeto e pode ser ajustado, então o contrato nasce **do que o CRM precisa**, e o ERP se adapta. As perguntas sobre o que o ERP já tem estão na seção 5.

---

## 1. Quem usa o MCP

| Consumidor | Usa para | Escreve no ERP? |
| --- | --- | --- |
| **PDV** (atendente de balcão e de telefone) | Identificar cliente, montar o pedido, consultar loja e taxa | Sim, por meio do worker de envio |
| **Assistente do PDV** (FR-010.8) | Nada direto: propõe ações, e o PDV valida chamando as ferramentas de leitura | Não |
| **IA do WhatsApp e do app-chat** (FR-003, FR-007) | Consultar cardápio, preço, entrega e cliente durante a conversa | Não. O CRM recusa escrita remota dentro da conversa; a IA grava o rascunho no CRM |
| **Recuperação de carrinho** (FR-012) | Conferir se os itens do carrinho ainda existem e o preço atual | Não |
| **Worker de envio** (FR-002, FR-010.6) | Criar, consultar e cancelar pedido | Sim |
| **App da rede** | Finaliza o pedido dentro do app e envia eventos ao CRM por webhook | Hipótese: o app fala com o ERP pelo caminho que já usa, fora deste MCP |

Consequência: **todas as ferramentas de leitura precisam servir à IA em conversa**, com resposta rápida e curta; as de escrita são chamadas pelo worker, não pela IA.

---

## 2. Regras gerais do contrato

1. **Loja explícita.** Toda ferramenta que depende de cardápio, preço, entrega ou pedido recebe a loja. Nenhuma assume loja implícita.
2. **Identidade do cliente vem do CRM, não do argumento.** O CRM envia o contato nos cabeçalhos `X-Deskcomm-*`, e o ERP não deve confiar no corpo para saber quem é o cliente.
3. **Leitura e escrita declaradas.** Cada ferramenta declara `readOnlyHint` corretamente. O CRM só trata uma ferramenta remota como leitura se o servidor declarar isso e o administrador marcar.
4. **Escritas idempotentes.** Recebem chave de idempotência e devolvem o mesmo resultado numa repetição.
5. **Preço, taxa, tempo e total são do ERP.** O ERP devolve tudo precificado e calculado, inclusive o meio a meio e os adicionais. O CRM grava o que o ERP informou e nunca recalcula; a regra de preço do protótipo (maior valor dos dois sabores) não migra.
5a. **Identificadores estáveis.** O ERP devolve identificadores para produto, tamanho, adicional e ingrediente, e os aceita de volta em `criar_pedido`. Eles precisam valer no tempo, para a recompra reconstruir pedidos antigos.
6. **Erros tipados e estáveis**, com código, mensagem curta em português e, quando existir, o identificador do registro envolvido (ex.: a ficha que já tem aquele CPF).
7. **Listas paginadas** e com limite, para a resposta caber no contexto da IA.
8. **Resposta enxuta.** Campos que a IA e o PDV não usam ficam de fora.
9. **Sem dado pessoal desnecessário** nas respostas de leitura usadas pela IA (CPF, por exemplo, só onde o PDV precisa).
10. **Tenants e lojas.** Cada tenant do CRM atende um conjunto de lojas, e o CRM restringe as chamadas às lojas do tenant. **O ERP identifica o tenant pela chave:** no CRM o servidor MCP é registrado por tenant (organização), cada um com a sua chave, então a chave autentica e identifica quem chama. O ERP grava no pedido o tenant de origem derivado da chave, para reportar por loja os pedidos que o call center registra. O tenant não viaja como argumento.
11. **O ERP é a camada comum entre tenants.** O CRM não cruza tenants; por isso o histórico do cliente e o cadastro mestre vêm do ERP, de qualquer loja.

Erros comuns a todas: `loja_invalida`, `nao_encontrado`, `tempo_esgotado`, `erp_indisponivel`, `nao_autorizado`.

---

## 3. Catálogo de ferramentas

**Legenda de origem:** PRD = já previsto no PRD pai ou no debate; PDV = nasce do PDV; NOVA = proposta deste levantamento, a confirmar.

### 3.1 Lojas

| Ferramenta | Tipo | Entrada | Saída | Para quê | Origem |
| --- | --- | --- | --- | --- | --- |
| `listar_lojas` | leitura | (filtro opcional) | código, sigla, nome, endereço, ativa | Alimenta a aba Lojas da configuração do tenant (`pdv_stores`) e a escolha no balcão | PDV |
| `consultar_funcionamento` | leitura | loja | aberta agora, horário do dia, próxima abertura | A IA não prometer pedido para loja fechada | NOVA |

### 3.2 Cardápio e preço

| Ferramenta | Tipo | Entrada | Saída | Para quê | Origem |
| --- | --- | --- | --- | --- | --- |
| `consultar_cardapio` | leitura | loja, busca livre ou categoria, página | lista por loja, já precificada pelo ERP: produto com identificador, código, nome, descrição, URL da foto (CDN), categoria, tamanhos com preço, ingredientes, adicionais permitidos com preço e disponibilidade | Busca de produtos do PDV (UC01), configurador de pizza, IA | PRD |
| `consultar_disponibilidade` | leitura | loja, itens | por item: disponível ou não e motivo | Antes de adicionar, na recuperação de carrinho | PRD |
| `calcular_total` | leitura | loja, tipo, CEP e endereço (se entrega), itens com composição (inclusive meio a meio) | subtotal, taxa de entrega, tempo estimado, total, avisos (item indisponível, preço mudou). Também precifica um item isolado, para o configurador de pizza | Resumo do pedido e preço do item enquanto o atendente configura | PRD |

### 3.3 Entrega e CEP

| Ferramenta | Tipo | Entrada | Saída | Para quê | Origem |
| --- | --- | --- | --- | --- | --- |
| `loja_do_endereco` | leitura | CEP | loja que entrega (código e sigla), ou "nenhuma"; taxa de entrega e tempo estimado, calculados pelo ERP | Loja automática em pedido de entrega; selo "nenhuma loja entrega" | PRD |
| `consultar_cep` | leitura | CEP | UF, cidade, bairro, logradouro, ou "não encontrado" | Preenchimento do endereço | PDV |

### 3.4 Cliente

| Ferramenta | Tipo | Entrada | Saída | Para quê | Origem |
| --- | --- | --- | --- | --- | --- |
| `buscar_cliente` | leitura | modo (telefone, nome, CPF), termo, limite | lista com id, nome e endereço principal (sem CPF, telefone nem e-mail); total encontrado e se foi truncada | UC01 de identificar cliente | PDV |
| `obter_cliente` | leitura | cliente, `campos_sensiveis` (padrão falso) | dados pessoais e todos os endereços (principal, loja entregadora); CPF e nascimento só com `campos_sensiveis` | Ficha do cliente | PDV |
| `consultar_historico_do_cliente` | leitura | cliente, limite | pedidos anteriores com itens, valores, loja, origem, data | Recompra e histórico (FR-010.7) | PDV |
| `cadastrar_cliente` | escrita | nome, telefone ou e-mail, CPF, nascimento, endereço opcional, chave de idempotência | id do cliente | UC02 de cadastrar cliente | PDV |
| `atualizar_cliente` | escrita | cliente, nome, CPF, nascimento | cliente atualizado | Edição pelo atendente (só esses três campos) | PDV |

Regra específica: `cadastrar_cliente` e `atualizar_cliente` devolvem o erro `duplicado` com o **identificador da ficha existente** quando o CPF ou o telefone já pertencem a outra ficha.

### 3.5 Endereços

| Ferramenta | Tipo | Entrada | Saída | Para quê | Origem |
| --- | --- | --- | --- | --- | --- |
| `salvar_endereco` | escrita | cliente, endereço (CEP, UF, cidade, bairro, endereço com número, complemento), id se for alteração | endereço, com loja entregadora | Adicionar e alterar endereço (UC03) | PDV |
| `remover_endereco` | escrita | cliente, endereço, novo principal se era o principal | confirmação | Remoção definitiva | PDV |
| `definir_endereco_principal` | escrita | cliente, endereço | confirmação | Trocar o principal | PDV |

Regra: alterar ou remover um endereço **não altera pedidos anteriores**; o pedido guarda o endereço que usou.

### 3.6 Pedido

| Ferramenta | Tipo | Entrada | Saída | Para quê | Origem |
| --- | --- | --- | --- | --- | --- |
| `criar_pedido` | escrita | loja, cliente, origem, tipo, endereço, itens com composição, observações, chave de idempotência | id do pedido no ERP, número, total, taxa, estado, link de pagamento se houver | Envio pelo worker (FR-002, FR-010.6) | PRD |
| `consultar_pedido` | leitura | pedido | estado, itens, valores, histórico de estados | Acompanhar e conferir o envio | PRD |
| `cancelar_pedido` | escrita | pedido, motivo, chave de idempotência | estado | Cancelamento após o envio | PRD |
| `obter_link_de_pagamento` | leitura | pedido | URL e validade | Repassar ao cliente, se não vier em `criar_pedido` | NOVA |

---

## 4. Rastreabilidade: requisito para ferramenta

| Requisito | Ferramentas |
| --- | --- |
| FR-001 Integração com o ERP | todas |
| FR-002 Pedido no CRM | `criar_pedido`, `consultar_pedido`, `cancelar_pedido`, `calcular_total`, `obter_link_de_pagamento` |
| FR-003 IA no WhatsApp | `consultar_cardapio`, `consultar_disponibilidade`, `calcular_total`, `loja_do_endereco`, `consultar_funcionamento`, `buscar_cliente`, `obter_cliente` |
| FR-007 App-chat | as mesmas do FR-003 |
| FR-010.1 a FR-010.3 Cliente e endereços | `buscar_cliente`, `obter_cliente`, `cadastrar_cliente`, `atualizar_cliente`, `salvar_endereco`, `remover_endereco`, `definir_endereco_principal`, `consultar_cep`, `loja_do_endereco` |
| FR-010.4 Cardápio e carrinho | `consultar_cardapio`, `consultar_disponibilidade`, `calcular_total` |
| FR-010.5 Tipo e loja | `listar_lojas`, `loja_do_endereco` |
| FR-010.6 Envio ao ERP | `criar_pedido`, `consultar_pedido` |
| FR-010.7 Histórico e recompra | `consultar_historico_do_cliente`, `consultar_disponibilidade`, `calcular_total` |
| FR-010.8 Assistente do atendente | as de leitura, chamadas pelo PDV para validar |
| FR-012 Recuperação de carrinho | `consultar_disponibilidade`, `calcular_total`, `consultar_funcionamento` |

---

## 5. Perguntas ao ERP

### 5.1 Respondidas (2026-11-16)

| Tema | Resposta | Efeito no contrato |
| --- | --- | --- |
| Tamanho, meio a meio, adicionais, ingredientes | Tudo é calculado no ERP, que devolve a lista, os tamanhos, os ingredientes e os adicionais | `consultar_cardapio` devolve a composição completa; o CRM não calcula preço; `consultar_produto` deixou de ser necessária e saiu do catálogo |
| Preço por loja | O ERP devolve tudo precificado e calculado | Toda ferramenta recebe a loja; o CRM nunca recalcula |
| Foto | Sim; o ERP devolve a URL, e a foto fica em um CDN | O CRM guarda e exibe a URL; conferir se o domínio do CDN é permitido para imagens no Next |
| Código de produto estável | Pergunta devolvida: ver a regra 5a | O ERP define os identificadores; o CRM os guarda no item do pedido |
| Área de entrega | Uma API do ERP devolve a loja pelo CEP | `loja_do_endereco` recebe o CEP |
| Taxa de entrega | O ERP calcula e devolve | A taxa vem de `loja_do_endereco` e de `calcular_total` |
| Tempo de entrega | O ERP fornece | O tempo estimado vem de `loja_do_endereco` e de `calcular_total` |
| Identificador da loja | Sim: código e sigla | `listar_lojas` devolve os dois; a sigla é a chave do mapeamento conexão para loja |

### 5.2 Ainda em aberto

**Cliente e endereço**
1. O ERP tem cadastro de cliente com vários endereços e endereço principal? CPF e telefone são únicos?
2. O cliente do ERP tem identificador estável que o CRM possa guardar no contato espelho?
3. Além de devolver a loja pelo CEP, o ERP consulta o CEP (UF, cidade, bairro, logradouro)? Ou o CRM usa outra fonte para preencher o endereço?

**Identificadores**
4. O ERP devolve identificadores estáveis de produto, tamanho, adicional e ingrediente, e os aceita de volta no pedido? Ou devolve um "item configurado" opaco, e por quanto tempo ele vale?

**Pedido e pagamento**
5. **Respondida em 2026-11-16:** sim, o ERP implementa a chave de idempotência na criação do pedido (a mesma chave repetida devolve o mesmo pedido, sem criar outro). É requisito do handoff E6.
6. Quais são os estados do pedido no ERP, e o CRM pode consultá-los?
7. Como o pagamento entra: o pedido nasce com a forma de pagamento pretendida? O link de pagamento é gerado na criação?
8. Regras de cancelamento: até que estado, e quem pode?
9. O pedido finalizado no app passa pelo mesmo ERP? O CRM precisa receber um evento disso?

**Operação**
10. Tempo de resposta esperado das leituras. O configurador de pizza chama o cálculo de preço a cada mudança (a IA responde em até 10 segundos no p95 e o envio do pedido em até 60 segundos).
11. O ERP tem horário de funcionamento por loja e indicação de loja aberta?
12. O ERP tem o conceito de canal ou origem do pedido (call center, balcão, WhatsApp, app) e consegue reportar por loja os pedidos registrados por outro tenant?

---

## 6. Como o CRM chama o ERP (lido no código)

Lido em `lib/mcp/servidor-externo/` e `docs/features/servidor-mcp-externo.md`; nada foi executado.

- **Registro por organização (tenant):** um servidor por organização, com endereço e chave Bearer cifrada. Quem grava é o dono da instalação, por uma tela em Configurações (`servidor-mcp-externo`). Para a rede: **três cadastros** (Campinas, Rio Preto, Call Center), cada um com a sua chave.
- **Transporte:** Streamable HTTP, pelo SDK oficial do MCP, com `Authorization: Bearer <chave>` em toda requisição. **Um handshake novo a cada chamada**, sem reuso de sessão.
- **Tempo limite:** 15 segundos por padrão, **definido por chamada** pelo código (`timeoutMs`).
- **Endereço aceito:** HTTP ou HTTPS no cadastro, mas **HTTPS obrigatório em produção**; sem usuário, senha, querystring nem fragmento; **hosts privados recusados** (localhost, 10., 172.16 a 31., 192.168., 169.254., IPv6 literal e nomes que resolvam para esses endereços); redirecionamento para outro host é recusado. Consequência: o ERP, inclusive a homologação, precisa de **HTTPS em nome público**. **Decisão (2026-11-16):** a homologação roda na rede local em HTTP e é publicada por um **túnel HTTPS**; uma exceção no guard do CRM fica como plano B.
- **Descoberta:** o CRM lista as ferramentas (`tools/list`). Uma ferramenta só conta como leitura se declarar `readOnlyHint: true` **exatamente**; qualquer outra coisa vale como escrita.
- **Uso pela IA de conversa:** o administrador escolhe, por agente, as ferramentas (`mcp_externo:leitura:<nome>`) e liga "usar o servidor externo durante o atendimento"; o CRM envia `X-Deskcomm-Contato-Id`, `X-Deskcomm-Contato-Telefone` e `X-Deskcomm-Canal`. Ferramentas de escrita são recusadas durante a conversa.
- **Uso pelo PDV e pelo worker:** as funções `listarFerramentasDoServidor` e `chamarFerramentaRemota` recebem o servidor (endereço e chave) e não dependem de turno de conversa. O PDV lê o registro da organização e chama direto, sem o carregador do turno, que lista as ferramentas a cada carga.

**Como o CRM lê a resposta (isto define o formato):**
- **Sucesso:** o CRM lê o `structuredContent` como o dado e o texto como complemento. As ferramentas devolvem o JSON do contrato em `structuredContent`.
- **Erro:** o CRM só lê o **texto** quando `isError` é verdadeiro, e o transforma em exceção. Para o erro ser tipado, o ERP devolve `isError: true` com o texto sendo um **JSON** `{ "codigo": "...", "mensagem": "...", "detalhes": {...} }`, e o CRM o interpreta.

**Ainda a medir (prova 0.4):** a latência real com um handshake por chamada, e se o tempo limite escolhido para `criar_pedido` basta.

---

## 7. Próximo passo

1. **Fatias com formato fechado:** E0 (`listar_lojas`) e E1 (`buscar_cliente`, `obter_cliente`), em [contrato-mcp-erp-formatos.md](contrato-mcp-erp-formatos.md). Os handoffs [E0](handoff-erp/E0-homologacao-e-listar-lojas.md) e [E1](handoff-erp/E1-buscar-e-obter-cliente.md) estão prontos para enviar à sessão do ERP, nessa ordem.
2. **Premissas do E1** a serem confirmadas na devolutiva: cliente com vários endereços e um principal, identificadores estáveis, e o tratamento do nono dígito do celular. Elas respondem as perguntas 1 e 2 da seção 5.2.
3. **Próximas fatias a formatar** antes do handoff: E2 (`consultar_cep`, `loja_do_endereco`, endereços), E3 (cadastro), E4 (`consultar_cardapio`, `consultar_disponibilidade`), E5 (`calcular_total`) e E6 (pedido, com idempotência).
4. Você responde as perguntas da seção 5.2 que já souber; as demais viram trabalho no ERP.
