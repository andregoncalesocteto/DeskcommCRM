# Design Doc: Módulo PDV do DeskcommCRM (balcão, telefone e assistente do atendente)

Versão: 0.2 (rascunho)
Data: 2026-11-16
Status: proposto; ADR-001, 002, 003, 005 e 006 aceitos; ADR-004 proposto (aguarda a prova 0.4)
Escopo deste documento: o módulo `pdv` (FR-010 do PRD pai) e a entidade de pedido que ele cria (base do FR-002)

Documentos de origem
- [prd-call-center-pdv-visao-geral.md](../prd-call-center-pdv-visao-geral.md) (v0.7)
- [prd-fr-010-pdv-balcao-e-telefone.md](../prd-fr-010-pdv-balcao-e-telefone.md) (v0.7)
- [plano-migracao-pdv-para-deskcommcrm.md](../plano-migracao-pdv-para-deskcommcrm.md) (v0.8)
- [contrato-mcp-erp.md](../contrato-mcp-erp.md) (v0.2) e [handoff-erp/](../handoff-erp/README.md)
- [adr/](adr/README.md): ADR-001 a ADR-006, uma por decisão da seção 10
- Protótipo no Lovable: https://github.com/andregoncalesocteto/cart-craft-counter (commit 452cfd9)

> **Como ler.** Marquei cada afirmação sobre o CRM como **(lido)** quando foi conferida por leitura de arquivos, e como **(proposto)** quando é decisão deste desenho. Nada foi executado: nem o protótipo, nem o CRM, nem os testes. O arquivo `design-docs/templates/DESIGN_TEMPLATE.md` não existe neste repositório; segui a estrutura de nove seções do comando `gen-design`.

---

## 1. Contexto

A Bella Capri opera um call center de 17 atendentes com um software de baixa qualidade. O PRD pai transforma o DeskcommCRM num call center com ponto de venda. Este desenho cobre a parte em que **um atendente humano registra o pedido**: no balcão da loja ou por telefone (a ligação é atendida na telefonia atual, fora do CRM). Ele identifica o cliente, monta o carrinho a partir do cardápio da loja, escolhe tipo (balcão ou entrega) e loja, confirma, e o pedido segue ao ERP. Um assistente de IA acelera o registro propondo ações.

**Restrições que moldam a solução**
- **O ERP é a fonte única** de cardápio, preço, taxa, tempo de entrega, cadastro de cliente e histórico. O CRM nunca calcula preço. O ERP é um sistema em **outro repositório**, ainda **sem API, sem MCP e sem homologação**; é construído em paralelo, por fatias (handoffs).
- **Tenants por unidade operacional** (Campinas atende CAS; Rio Preto atende RPA, RPV, RPR e RPI; o Call Center atende todas). Cada tenant tem conexões, agentes e configuração próprios. O CRM não cruza tenants; o ERP é a camada comum. Todos os operadores de um tenant atuam em todas as lojas dele.
- **Módulo opcional, desligado por padrão, código só no fork da rede**, instalado por instância (ADR-0002 do CRM) (lido).
- **Doutrina do CRM**: `organization_id` e RLS em toda tabela; service role filtra organização manualmente; trigger nunca faz HTTP (emite linha em `event_log`); toda criação aceita `Idempotency-Key`; toda mutação gera `api_audit_log`; função nova em `public` revoga `PUBLIC` e `anon`; mudança de schema sai como migration, apêndice no baseline e linha `-- manifest:` (lido, `CLAUDE.md`).
- **A IA não escreve no ERP dentro de uma conversa** (`escrita_sem_escopo_do_turno`) (lido). O assistente do PDV não é uma conversa com contato, mas segue o mesmo princípio: o modelo propõe, o servidor valida e aplica.

**Fora deste desenho:** IA de atendimento no WhatsApp e app-chat (FR-003, FR-007), eventos do app e carrinho (FR-011), recuperação de carrinho (FR-012), carrinho no inbox (FR-013), painel de metas (FR-005). Cada um terá o seu. Este desenho deixa a entidade de pedido pronta para eles.

---

## 2. Solução proposta

Um **módulo oficial `pdv`** dentro do CRM, com tabelas próprias criadas por uma função provisionadora (`fn_pdv_provisionar`), telas em `app/app/pdv/` e rotas em `app/api/v1/pdv/`, seguindo o caminho dos módulos Honorários e Comandas (lido). O servidor do CRM fala com o ERP por uma **camada única `lib/pdv/erp`**, que esconde o transporte (MCP ou API). O pedido nasce como **rascunho no CRM** e é enviado ao ERP por um **handler do `event_log`**, de forma idempotente. O assistente é um **ponto de IA** que devolve ações propostas, e o servidor as valida contra o ERP antes de aplicar.

```
                          ┌───────────────────────────── CRM (um tenant) ────────────────────────────┐
 Atendente                │                                                                          │
 (balcão / telefone)      │  UI PDV (Next.js, app/app/pdv)                                           │
      │  voz/texto        │     │                                                                    │
      ├──────────────────►│     ├── Rotas /api/v1/pdv/* ── requireRole(agent) ── Idempotency-Key     │
      │                   │     │        │                          audit ── requireSupportWrite      │
      │                   │     │        ▼                                                           │
      │                   │     │   lib/pdv/erp  ◄── cache curto do cardápio (por loja)              │
      │                   │     │        │ leitura síncrona                                          │
      │                   │     │        │                                                           │
      │                   │     ├── Pedido (rascunho→confirmado) ──► event_log: pdv.pedido_confirmado │
      │                   │     │                                        │ (worker drena em 2–10 s)  │
      │                   │     │                                        ▼                           │
      │                   │     │                              handler de envio ──► lib/pdv/erp     │
      │                   │     │                                        │ falha esgotada            │
      │                   │     │                                        ▼                           │
      │                   │     │                       Central de avisos (pedido não enviado)       │
      │                   │     │                                                                    │
      │                   │     └── Assistente (ponto de IA pdv_assistant) ──► ações propostas ──┐    │
      │                   │                  ▲ valida cada ação em lib/pdv/erp  ◄────────────────┘    │
      │                   └──────────────────────────────────┬───────────────────────────────────────┘
      │                                                      │ MCP (ou API)
      │                                                      ▼
      │                                          ERP da rede (outro repositório)
      │                                          cliente · cardápio · preço · loja · pedido
```

**Princípios do desenho**
1. **O ERP decide, o CRM registra.** Preço, taxa, tempo, total e loja entregadora são gravados como o ERP informou.
2. **Rascunho primeiro, envio depois.** Nenhum efeito externo acontece dentro da requisição da tela.
3. **O modelo nunca fala com o ERP.** O assistente propõe; o servidor valida e aplica.
4. **O módulo desligado não deixa rastro:** sem tela, sem rota, sem ferramenta, sem aviso.
5. **Tecnologia comum:** Postgres, `event_log`, Next.js. Nada novo na infraestrutura.

---

## 3. Arquitetura

### 3.1 Componentes

| Componente | Responsabilidade | Tecnologia | Estado |
| --- | --- | --- | --- |
| **Módulo `pdv`** (registro) | Flag desligada por padrão, texto no catálogo de recursos, porta no `NAV_CATALOG`, layout com `notFound()`, gate de ferramentas | TypeScript; `lib/instalacao/modulos.ts`, `lib/recursos-opcionais/catalogo.ts`, `lib/modulos/catalogo.ts`, `lib/navigation/catalogo.ts` | (lido) mecanismo; (proposto) slug `pdv` |
| **Provisionadora** | Cria as tabelas `pdv_*` com RLS e revogações ao instalar o módulo | SQL, `fn_pdv_provisionar()` `security definer`, executável só por `service_role` | (lido) padrão; (proposto) função |
| **Aba Lojas** | Lojas do tenant, código e sigla do ERP, conexão de WhatsApp de cada uma | Next.js, entrada `NAV_CATALOG` com `modulo: "pdv"` no grupo `organizacao` | (proposto) |
| **Telas do PDV** | Identificação, ficha, endereços, cadastro, busca de produtos, configurador de pizza, carrinho, fechamento, histórico | Next.js 16 App Router, shadcn/ui, Tailwind 4; portado do protótipo | (proposto) |
| **Rotas `/api/v1/pdv/*`** | Casos de uso de servidor: leitura do ERP, rascunho, confirmação, reenvio, cancelamento | Route Handlers; `ok()`/`fail()`; Zod; `requireRole`; `Idempotency-Key`; `audit()` | (proposto) |
| **`lib/pdv/erp`** | Cliente tipado do ERP: uma função por ferramenta do contrato, erros tipados, tempo limite, chave do tenant, cache de cardápio | TypeScript; transporte escondido (MCP via `lib/mcp/servidor-externo` ou HTTP) | (proposto) |
| **Máquina de estados do pedido** | Transições válidas e invariantes (`rascunho→confirmado→enviado`, `recusado`, `cancelado`) | TypeScript puro, testado | (proposto) |
| **Handler `pdv.pedido_confirmado`** | Envia o pedido ao ERP, registra a tentativa, agenda retentativa, abre aviso ao esgotar | Handler do `event_log` registrado em `register-handlers.ts` | (lido) mecanismo; (proposto) handler |
| **Aviso na Central** | "Pedido não enviado ao ERP" | Novo `kind` em `agent_inbox_items`, com texto e política de destino | (lido) mecanismo; (proposto) tipo |
| **Assistente `pdv_assistant`** | Interpreta a fala do atendente e devolve ações estruturadas | Ponto de IA no estilo de `conversa-do-caso`, em `lib/agent-engine/`; Zod no esquema das ações | (lido) precedente; (proposto) ponto |
| **Servidor MCP do ERP** | As 19 ferramentas do contrato | Em outro repositório; handoffs E0 a E8 | fora deste repositório |

### 3.2 Fluxo principal: do cliente ao pedido no ERP

```
Atendente        UI/Rotas PDV            lib/pdv/erp          ERP                event_log / worker
   │ busca cliente   │                        │                  │                        │
   ├────────────────►│ GET clientes?q=        │ buscar_cliente   │                        │
   │                 ├───────────────────────►├─────────────────►│                        │
   │◄── candidatos ──┤◄───────────────────────┤◄─────────────────┤                        │
   │ seleciona + vê ficha/endereços (obter_cliente)               │                        │
   │ busca/configura produto ─► cardápio (cache) e calcular_total por mudança              │
   │ monta carrinho ─► POST rascunho (servidor grava itens com o preço do ERP)             │
   │ confirma        │ POST confirmar (Idempotency-Key)                                     │
   ├────────────────►│ recalcula total no ERP; compara com o da tela                        │
   │                 │ grava status=confirmado + emit_event pdv.pedido_confirmado ─────────►│
   │◄─ "enviando" ───┤                                                                      │
   │                 │                                    claim otimista da linha ◄─────────┤
   │                 │                        criar_pedido (idempotente) ◄──── handler ─────┤
   │                 │                                  ├──────────────►│                   │
   │                 │             grava tentativa, erp_order_id, status=enviado ◄───────────┤
   │◄─ nº do pedido ─┤ (tela consulta o estado; Realtime ou polling curto)                  │
   │                 │         falha → retentativa com atraso; esgotou → aviso na Central    │
```

### 3.3 Estados do pedido

```
rascunho ──confirmar──► confirmado ──envio ok──► enviado ──cancelar──► cancelado
   │                        │  ▲                    
   └──descartar──► (apagado)│  └─ reenvio manual ─┐   recusado (o ERP recusou; volta a rascunho editável)
                            └─ envio falha/esgota ─► confirmado com aviso (não perde)
```

O PRD pai lista quatro estados (rascunho, confirmado, enviado, cancelado). Acrescento **`recusado`**, porque a recusa do ERP precisa ser distinguível de uma falha de rede, com motivo visível e caminho de correção.

---

## 4. Modelo de dados

Todas as tabelas são criadas pela provisionadora, têm `organization_id uuid not null references organizations(id) on delete cascade`, RLS `tenant_isolation_<tabela>_all` via `fn_user_org_ids()`, dinheiro em `_cents` com `currency`, e `type` como `text` mais `check` (não enum) (lido, doutrina). Nomes e colunas são **propostos**.

```
organizations ──< pdv_stores ──< pdv_orders >── contacts (opcional)
                                   │
                                   ├──< pdv_order_items ──< pdv_order_item_options
                                   └──< pdv_order_attempts

contacts ──< pdv_customer_links  (vínculo com o cliente do ERP)
```

**`pdv_stores`** (as lojas que o tenant atende)
`id`, `organization_id`, `erp_store_code`, `sigla`, `nome`, `ativa`, `channel_session_id` (nullable, conexão de WhatsApp da loja), `created_at`, `updated_at`. Único `(organization_id, sigla)` e `(organization_id, erp_store_code)`.

**`pdv_customer_links`** (contato espelho)
`id`, `organization_id`, `contact_id` (FK `contacts`), `erp_customer_id`, `linked_at`. Único `(organization_id, erp_customer_id)` e `(organization_id, contact_id)`.

**`pdv_orders`**
`id`, `organization_id`, `store_id` (FK), `contact_id` (nullable, FK), `erp_customer_id`, `origin` (`telefone` | `balcao`), `order_type` (`balcao` | `entrega`), `status` (`rascunho` | `confirmado` | `enviado` | `recusado` | `cancelado`), endereço de entrega **copiado no momento do pedido** (`delivery_cep`, `delivery_uf`, `delivery_city`, `delivery_district`, `delivery_street_number`, `delivery_complement`), `subtotal_cents`, `delivery_fee_cents`, `total_cents`, `currency`, `estimated_minutes`, `idempotency_key uuid`, `erp_order_id`, `erp_order_number`, `payment_link_url` (nullable), `attendant_user_id` (FK), `confirmed_at`, `sent_at`, `cancelled_at`, `created_at`, `updated_at`.
Único `(organization_id, idempotency_key)` e `(organization_id, erp_order_id)` onde não nulo.

**`pdv_order_items`**
`id`, `organization_id`, `order_id`, `erp_product_id`, `erp_size_id`, `name` (cópia), `size_label` (cópia), `quantity int check (> 0)`, `unit_price_cents` (como o ERP informou), `line_total_cents`, `note`, `entered_by` (`manual` | `assistente`).

**`pdv_order_item_options`** (composição normalizada, sem `jsonb` lido pela tela)
`id`, `organization_id`, `item_id`, `kind` (`meio_a_meio` | `adicional` | `removido`), `erp_option_id`, `name`, `price_cents`, `quantity`.

**`pdv_order_attempts`** (rastro do envio)
`id`, `organization_id`, `order_id`, `attempt_no`, `started_at`, `finished_at`, `outcome` (`ok` | `recusado` | `erro` | `tempo_esgotado`), `error_code`, `request_summary jsonb`, `response_summary jsonb`. Os `jsonb` são **log de E/S externa**, nunca lidos por caminho de UI; **sem CPF, telefone nem e-mail** nos resumos.

**Decisões de modelagem**
- **Endereços do cliente não são guardados no CRM.** O ERP é o cadastro mestre e devolve os endereços em `obter_cliente`. O CRM guarda só a **cópia no pedido**, para o histórico não mudar quando um endereço for alterado ou removido. (Isto altera a tarefa 2.1 do plano, que previa uma tabela de endereços. Ver ADR-002.)
- **Cardápio e preço não são persistidos.** Cache curto por loja (ver 3.1), hipótese de Redis (Upstash, já na stack) com TTL de minutos.
- **Preço do item sempre vem do ERP.** `unit_price_cents` é gravado do retorno de `calcular_total`; uma conferência compara o total da tela com o total recalculado no momento de confirmar.
- **Contato espelho:** ao selecionar um cliente do ERP, o servidor procura o `contacts` por telefone (variantes brasileiras), por `cpf_hash` e por e-mail; se acha, vincula; se não, cria. Os índices únicos de CPF, telefone e e-mail por organização (lido) impedem duplicata, e o `23505` do INSERT é tratado.

### Dados do `event_log`
Evento `pdv.pedido_confirmado`, `entity_kind = 'pdv_order'`, `entity_id` = id do pedido, `payload` = `{ order_id, store_id }`. O handler relê o pedido do banco; o payload não carrega dado pessoal.

---

## 5. APIs / Interfaces

### 5.1 Rotas do CRM (`/api/v1/pdv/*`)

Convenções do CRM (lido): JSON `snake_case`, wrapper `{ data, meta? }` e `{ error: { code, message, details? } }`, dinheiro em `_cents` mais `currency`, `X-Request-Id`, `requireSupportWrite(` antes de efeito em handler mutante, auditoria de toda mutação, Zod em todo input, papel mínimo `agent`. A autenticação é por sessão (a tela); bearer `dsk_` **não** é necessário para o PDV.

| Método e caminho | Uso | ERP |
| --- | --- | --- |
| `GET /pdv/lojas` | Lojas do tenant | `listar_lojas` |
| `GET /pdv/clientes?modo=telefone\|nome\|cpf&q=` | Busca de cliente | `buscar_cliente` |
| `GET /pdv/clientes/{erp_id}` | Ficha com endereços | `obter_cliente` |
| `POST /pdv/clientes` | Cadastro (Idempotency-Key) | `cadastrar_cliente` |
| `PATCH /pdv/clientes/{erp_id}` | Nome, CPF, nascimento | `atualizar_cliente` |
| `POST /pdv/clientes/{erp_id}/enderecos` | Adicionar | `salvar_endereco` |
| `PATCH` e `DELETE /pdv/clientes/{erp_id}/enderecos/{id}` | Alterar e remover | `salvar_endereco`, `remover_endereco` |
| `POST /pdv/clientes/{erp_id}/enderecos/{id}/principal` | Tornar principal | `definir_endereco_principal` |
| `GET /pdv/cep/{cep}` | Preencher endereço | `consultar_cep`, `loja_do_endereco` |
| `GET /pdv/cardapio?loja=&q=&page=` | Busca de produtos | `consultar_cardapio` |
| `POST /pdv/precificar` | Preço do item ou do carrinho | `calcular_total` |
| `POST /pdv/pedidos` | Cria ou atualiza o rascunho | `calcular_total` |
| `POST /pdv/pedidos/{id}/confirmar` | Confirma e enfileira o envio | `calcular_total` |
| `GET /pdv/pedidos/{id}` | Estado, itens, tentativas | (banco) |
| `POST /pdv/pedidos/{id}/reenviar` | Reenvio manual | (via evento) |
| `POST /pdv/pedidos/{id}/cancelar` | Cancela | `cancelar_pedido` |
| `GET /pdv/clientes/{erp_id}/historico` | Histórico e recompra | `consultar_historico_do_cliente` |
| `POST /pdv/assistente` | Interpreta a fala e propõe ações | (leituras para validar) |

A loja e o tenant **nunca** vêm do corpo como autoridade: o tenant sai da sessão, e a loja é validada contra `pdv_stores` do tenant.

**Exemplo: precificar um item (meio a meio)**
```http
POST /api/v1/pdv/precificar
Content-Type: application/json

{
  "loja": "RPA",
  "tipo": "entrega",
  "cep": "15010-000",
  "itens": [
    { "erp_product_id": "p-calabresa", "erp_size_id": "G", "quantidade": 1,
      "opcoes": [
        { "tipo": "meio_a_meio", "erp_option_id": "p-mussarela" },
        { "tipo": "adicional", "erp_option_id": "a-bacon", "quantidade": 1 }
      ] }
  ]
}
```
```json
{
  "data": {
    "itens": [ { "linha": 1, "preco_unitario_cents": 6400, "total_linha_cents": 6400 } ],
    "subtotal_cents": 6400,
    "taxa_entrega_cents": 800,
    "tempo_estimado_minutos": 45,
    "total_cents": 7200,
    "currency": "BRL",
    "avisos": []
  }
}
```

**Exemplo: confirmar o pedido**
```http
POST /api/v1/pdv/pedidos/9f1c.../confirmar
Idempotency-Key: 3b6e0d4a-...
```
```json
{
  "data": {
    "id": "9f1c...",
    "status": "confirmado",
    "total_cents": 7200,
    "currency": "BRL",
    "envio": { "estado": "na_fila" }
  }
}
```
Erros: `409 idempotency_conflict`, `409 idempotency_in_progress` (lido), `422 preco_divergente` (o total recalculado difere do da tela; devolve o novo total), `422 loja_invalida`, `502 erp_indisponivel` (o pedido permanece rascunho).

### 5.2 Camada `lib/pdv/erp` (interface interna, proposta)

```ts
interface ErpPdv {
  listarLojas(): Promise<Loja[]>
  buscarCliente(modo: 'telefone'|'nome'|'cpf', termo: string): Promise<ClienteResumo[]>
  obterCliente(id: string): Promise<Cliente>
  consultarCep(cep: string): Promise<Endereco | null>
  lojaDoEndereco(cep: string): Promise<{ loja: LojaRef | null; taxaCents: number; minutos: number }>
  consultarCardapio(loja: string, q?: string, page?: number): Promise<Pagina<ProdutoDoCardapio>>
  calcularTotal(entrada: EntradaDeCalculo): Promise<Calculo>
  criarPedido(entrada: NovoPedido, chaveDeIdempotencia: string): Promise<PedidoNoErp>
  consultarPedido(id: string): Promise<PedidoNoErp>
  cancelarPedido(id: string, motivo: string, chave: string): Promise<void>
  // ...cadastrar/atualizar cliente, endereços, histórico (ver contrato)
}
```
Erros tipados e estáveis (`loja_invalida`, `nao_encontrado`, `duplicado` com o id da ficha existente, `tempo_esgotado`, `erp_indisponivel`), um tempo limite por chamada, e a **chave do tenant** em toda chamada (o registro é por organização). Os testes unitários e de contrato usam **amostras gravadas** das respostas reais da homologação; o CI não depende do ERP no ar.

### 5.3 Assistente: ações propostas

O corpo da requisição leva a fala, o estado do carrinho e a loja; a resposta leva uma `mensagem` e uma lista de `acoes`. O esquema (Zod) é o do protótipo, ajustado:

```json
{
  "mensagem": "Entendi: entrega para a Maria Oliveira, uma calabresa G e uma coca 2L.",
  "acoes": [
    { "tipo": "identificar_cliente", "termo": "Maria Oliveira" },
    { "tipo": "definir_tipo", "valor": "entrega" },
    { "tipo": "adicionar_item", "erp_product_id": "p-calabresa", "erp_size_id": "G", "quantidade": 1 },
    { "tipo": "adicionar_item", "erp_product_id": "b-coca", "erp_size_id": "2L", "quantidade": 1 }
  ]
}
```
O servidor **valida cada ação** (cliente existe, produto e tamanho existem no cardápio da loja, disponibilidade, loja do tenant) e devolve o que foi **aplicado** e o que foi **recusado**, com o motivo. `identificar_cliente` e outras buscas são executadas pelo servidor; **o modelo não recebe ferramenta do ERP**. Ações que o modelo não pode propor: confirmar, enviar, cancelar, remover cliente.

### 5.4 Contrato com o ERP
As 19 ferramentas, as regras gerais e as perguntas em aberto estão em [contrato-mcp-erp.md](../contrato-mcp-erp.md). A entrega é por fatias, em [handoff-erp/](../handoff-erp/README.md).

---

## 6. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| A1 | **Estender o módulo Comandas** (`sales`, `sale_items`) em vez de um módulo novo | Menos tabelas, tela de venda já existe | É de serviço, com comissão, fidelidade e agendamento; não tem origem, endereço nem envio ao ERP; acopla dois módulos com ciclos diferentes | Rejeitada |
| A2 | **Reaproveitar `orders`** (espelho de e-commerce) | Já aparece na lateral do inbox | O `check` só aceita `nuvemshop`, `vtex` e `shopify`; sem itens; escrita por tela não existe | Rejeitada |
| A3 | **A IA grava direto no ERP** durante o atendimento | Menos código | O CRM recusa escrita remota na conversa por desenho; efeito externo no meio do diálogo | Rejeitada (ver ADR-005 e ADR-006) |
| A4 | **Assistente pelo runtime de atendimento** (turno de contato, com ferramentas) | Reaproveita o motor | As escritas são limitadas ao contato do turno (`escritaCabeNoTurno`); mexer nisso é mudança de núcleo; o modelo teria acesso ao ERP | Rejeitada; ver 5.3 e ADR-005 |
| A5 | **Chamar o ERP síncrono no `confirmar`** | Resposta imediata | ERP fora do ar vira erro para o atendente; sem retentativa nem rastro; contraria a doutrina de worker | Rejeitada |
| A6 | **Cliente só no ERP, sem contato espelho** | Sem duplicação de cadastro | O pedido perde a ligação com conversas, funil e LGPD do CRM | Rejeitada (ver ADR-002) |
| A7 | **Transporte: tudo por MCP** versus **MCP só para a IA e API para o PDV** | Um contrato só versus chamada mais direta e tipada | Depende da prova 0.4 (cliente MCP fora de turno, latência, timeout) | **Em aberto**; começar por MCP, com a camada `lib/pdv/erp` permitindo trocar (ver ADR-004) |

---

## 7. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
| --- | --- | --- | --- | --- |
| R1 | O ERP atrasa uma fatia e a tarefa do CRM correspondente espera | Alta | Médio | Fatias pequenas; regra de ordem do plano; a trilha do ERP é sua e priorizada pela leitura primeiro |
| R2 | Latência do cálculo de preço no configurador (o ERP calcula a cada mudança) | Média | Alto (uso lento) | Uma chamada por item; espera curta antes de chamar; cache curto por combinação; meta de 1 s no p95 |
| R3 | O custo de um handshake novo por chamada ao ERP (o cliente MCP do CRM não reusa sessão) pesa na latência das leituras | Média | Alto | Prova 0.4 mede; a camada `lib/pdv/erp` isola o transporte; plano B: API do ERP para PDV e worker. As funções de chamada do CRM não dependem de turno (lido) |
| R4 | Tempo limite padrão de 15 s curto para `criar_pedido` | Baixa | Médio | O tempo limite se define por chamada (lido); retentativa idempotente |
| R15 | O endereço do ERP não é HTTPS público: o CRM recusa HTTP em produção e hosts privados | Média | Alto | **Decidido em 2026-11-16:** a homologação roda na rede local em HTTP e é publicada por um túnel HTTPS (só dados fictícios, só o servidor MCP exposto, chave por tenant). O ERP de produção precisa ter HTTPS em nome público. Plano B: exceção controlada no guard do CRM (mudança de núcleo) |
| R5 | Envio duplicado ao ERP | Média | Alto | `Idempotency-Key` no CRM; chave de idempotência em `criar_pedido`; único `(organization_id, idempotency_key)`; reenvio reusa a chave. O ERP implementará a chave de idempotência (confirmado em 2026-11-16, requisito do handoff E6) |
| R6 | Pedido do call center para loja de outro tenant não aparece no tenant da loja | Alta | Médio | Gravar origem e tenant de origem no ERP; números por loja vêm do ERP; sem cópia no tenant da loja (confirmado em 2026-11-16) |
| R7 | Contato espelho duplicado ou conflitante com contatos já existentes | Média | Médio | Busca por telefone (variantes), CPF (hash) e e-mail antes de criar; tratar `23505`; ERP como mestre |
| R8 | Dados pessoais no prompt, nos logs ou nos resumos de tentativa | Média | Alto (LGPD) | CPF, telefone e e-mail fora do modelo; resumos de tentativa sem dado pessoal; Sentry sanitizado |
| R9 | **Injeção de instrução** por texto do cliente, observação do pedido ou nome de produto que chega ao prompt do assistente | Média | Alto | Dados em bloco cercado e rotulado como registro de terceiros (padrão de `conversa-do-caso`); o modelo só propõe, o servidor valida; lista fechada de ações |
| R10 | Interpretação errada do assistente e pedido errado | Média | Alto | Destaque do que mudou, resumo antes de confirmar, validação contra o ERP, `entered_by` no item, avaliação com frases reais antes do piloto |
| R11 | Custo de IA do assistente acima do orçamento | Média | Médio | Propósito próprio sem isenção de orçamento; medição por atendente; desligar por loja |
| R12 | O domínio do CDN das fotos não é permitido para imagens no Next | Baixa | Baixo | Conferir a configuração de imagens; cair para `<img>` simples |
| R13 | Conflito de migration no fork a cada merge do upstream | Alta | Médio | Checagem de colisão de numeração a cada merge; tripla (migration, baseline, manifest) |
| R14 | Escrita pelo atendente sem permissão de tenant (uso do service role em rota) | Baixa | Alto | Todas as rotas resolvem o tenant da sessão e filtram `organization_id` e a loja; teste de isolamento entre dois tenants |

**Já mitigado pelo CRM (lido):** o `worker` drena o `event_log` em 2 s com fila e até 10 s parado, com o cron de 1 minuto como rede de segurança e claim otimista de cada linha. O envio em até 60 segundos exigido pelo PRD é, portanto, viável sem mudar a infraestrutura. Corrijo aqui o plano de migração, que dizia o contrário.

---

## 8. Plano de implementação

Resumo; o detalhe e a ordem das tarefas estão no [plano de migração](../plano-migracao-pdv-para-deskcommcrm.md). Cada fase depende da fatia do ERP indicada no plano.

| Fase | Entrega | Prova |
| --- | --- | --- |
| 0 | ADR-001 a ADR-006 aceitos; prova do MCP (0.4) contra o ERP; contrato v0.3; homologação do ERP (E0) | ADRs aceitos; relatório da prova |
| 1 | Módulo desligado por padrão; `pdv_stores`; aba Lojas; camada `lib/pdv/erp` | `test:db`, isolamento entre tenants; módulo desligado = 404 |
| 2 | Cliente e endereços: busca, ficha, cadastro, endereços, CEP e loja entregadora, contato espelho | Casos de uso do UC01 a UC03 pela tela |
| 3 | Cardápio e carrinho: busca de produtos, configurador de pizza, pedido rascunho e itens | Preço sempre do ERP; meta de 1 s |
| 4 | Confirmação, envio pelo `event_log`, tentativas, aviso na Central, estados na tela, teste de carga | Reenvio não duplica; envio em até 60 s; pico de 300 pedidos por dia |
| 5 | Histórico e repetir último pedido | Item indisponível ou com preço novo é avisado |
| 6 | Assistente: ponto de IA, validação das ações, painel, voz, avaliação | Nenhuma ação sem validação; nenhum dado pessoal no modelo |
| 7 | Piloto: QA por roteiro, specs de tela, fragmento `.changes/`, mapa de jornadas, prova em ambiente fresco | Definition of Done do CRM |

Cada tarefa cumpre a Definition of Done do CRM: `typecheck`, `lint` e `test:unit` sem filtro de caminho; `pnpm test:db` quando há schema; RLS testada; auditoria; Zod; prova pela tela em ambiente estilo VPS; fragmento de release.

---

## 9. Observabilidade

**Logs estruturados** (sem `console.log`), com `X-Request-Id` ligando a requisição da tela ao pedido, à tentativa e à chamada ao ERP. Nunca CPF, telefone ou e-mail.

**Auditoria** (`api_audit_log`, fire-and-forget): `pdv.order.created`, `pdv.order.confirmed`, `pdv.order.sent`, `pdv.order.rejected`, `pdv.order.cancelled`, `pdv.order.resent`, `pdv.store.updated`. Cron ou rodada sem efeito não audita (doutrina).

**Rastro por pedido** (requisito do PRD): origem, loja, atendente, itens (com `entered_by`), cada tentativa com resultado, código de erro e duração, motivo de recusa e custo de IA do assistente na sessão.

**Métricas**
| Métrica | Para quê |
| --- | --- |
| Tempo de `confirmado` até `enviado` (p50 e p95) | Meta de 60 s |
| Latência por ferramenta do ERP (p50, p95, erro) | R2, R3, R4 |
| Taxa de erro e de timeout do ERP | Disponibilidade percebida |
| Pedidos por estado e por loja | Operação |
| Pedidos parados em `confirmado` | Fila travada |
| Divergência de preço (confirmar com total diferente) | Meta de 0 |
| Ações do assistente: propostas, aplicadas, recusadas | Qualidade do assistente |
| Custo de IA por atendente e por pedido | R11 |
| Origem do pedido (telefone x balcão) e uso do assistente | Valor do módulo |

**Alertas**
- Pedido em `confirmado` há mais de 60 s sem envio: aviso na Central e alerta.
- ERP com taxa de erro acima do limite por N minutos.
- Evento `pdv.pedido_confirmado` esgotando tentativas: o aviso de `event_dead` já existe no CRM (lido) e o aviso específico de pedido não enviado se soma a ele.
- Orçamento de IA do assistente perto do teto.
- Falha de gravação de auditoria: alerta, sem bloquear a mutação (doutrina).
- Erros no Sentry com `beforeSend` sanitizado.

---

## 10. Decisões e ADRs

Cada decisão tem um ADR em [adr/](adr/README.md). Os ADRs 001, 002, 003, 005 e 006 estão **Aceitos** (2026-11-16); o ADR-004 está **Proposto**, à espera da prova 0.4. Depois de aceito, um ADR não se edita: cria-se outro que o substitua.

| ADR | Decisão | Status |
| --- | --- | --- |
| [ADR-001](adr/ADR-001-tenants-e-lojas.md) | **Tenants e lojas.** Um tenant por unidade operacional, lojas como dado do módulo, mapeamento conexão para loja, aba Lojas | **Aceito**; o pedido entre tenants fica só no ERP, sem cópia (nota no README dos ADRs) |
| [ADR-002](adr/ADR-002-cliente-mestre-no-erp.md) | **Cliente.** ERP como cadastro mestre; contato espelho por tenant; endereços só no ERP (cópia no pedido) | **Aceito**; com o ERP fora do ar, o PDV avisa e espera (nota no README dos ADRs) |
| [ADR-003](adr/ADR-003-pedido-em-tabelas-de-modulo.md) | **Pedido.** Tabelas `pdv_*` de módulo (ADR-0002 do CRM), estado `recusado`, composição normalizada | **Aceito**; os outros canais usam as mesmas tabelas `pdv_*` (nota no README dos ADRs) |
| [ADR-004](adr/ADR-004-transporte-do-erp.md) | **Transporte do ERP.** Camada única `lib/pdv/erp`, começando por MCP | Proposto, condicionado à prova 0.4 |
| [ADR-005](adr/ADR-005-assistente-propoe-servidor-valida.md) | **Assistente.** Ponto de IA com ações propostas, validação no servidor, orçamento sem isenção, minimização de dados | **Aceito**; a proposta de "confirmar" com clique na tela é backlog de um ADR novo (nota no README dos ADRs) |
| [ADR-006](adr/ADR-006-envio-do-pedido-ao-erp-pelo-event-log.md) | **Envio ao ERP.** Handler do `event_log` com retentativa e aviso, idempotência de ponta a ponta | **Aceito**; o ERP implementará a chave de idempotência (handoff E6) |

Os números dos ADRs são do projeto Bella Capri e não colidem com `docs/adr/` do CRM.

---

## 11. Pendências abertas (herdadas dos PRDs)

- ~~Pagamento~~ **Resolvida em 2026-11-18:** o PDV só registra a forma pretendida e o troco (ver notas do README dos ADRs).
- ~~Quem confirma o envio ao ERP~~ **Resolvida em 2026-11-18:** o atendente, com um clique.
- ~~Loja calculada pelo ERP fora do tenant do operador~~ **Resolvida em 2026-11-18:** recusar e avisar.
- Uma conexão de WhatsApp pode atender mais de uma loja (muda `channel_session_id` para uma tabela de junção)?
- As 12 perguntas ainda em aberto ao ERP (seção 5.2 do contrato), em especial idempotência na criação de pedido e identificadores estáveis de produto, tamanho e adicional.
