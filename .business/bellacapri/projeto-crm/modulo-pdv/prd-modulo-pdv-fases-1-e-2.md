# PRD: Módulo PDV, fase 1 (esqueleto e lojas) e fase 2 parcial (identificar cliente e ficha)

Versão: 0.1 (rascunho)
Data: 2026-11-16
Formato: PRD do Ralph (histórias pequenas, em ordem estrita, sem dependência para frente)

Documentos de origem
- [design-modulo-pdv.md](design-modulo-pdv.md) e os [ADRs](adr/README.md) (001, 002, 003, 005 e 006 aceitos; 004 proposto)
- [PRD do FR-010](../prd-fr-010-pdv-balcao-e-telefone.md) e [plano de migração](../plano-migracao-pdv-para-deskcommcrm.md)
- [contrato-mcp-erp-formatos.md](../contrato-mcp-erp-formatos.md) (fatias E0 e E1) e [handoffs do ERP](../handoff-erp/README.md)
- Interfaces: `docs/interface/identificar-cliente/` (casos de uso e prompts das telas)

> **Como ler.** Os caminhos de arquivo do CRM citados aqui vêm do Design Doc e de uma leitura de código feita sem executar nada. Onde o nome exato precisa ser conferido no repositório antes de usar, está escrito "conferir". O código do módulo vive só no fork da rede.

---

## 1. Introdução / visão geral

O módulo PDV permite que o atendente de balcão e de telefone registre pedidos no CRM, com o ERP como fonte única de cliente, cardápio, preço e taxa. Este PRD constrói **a base** e **a primeira tela útil**:

1. **Fase 1.** O módulo `pdv` como módulo opcional, desligado por padrão, com a tabela de lojas do tenant, a camada que fala com o ERP e a aba **Lojas** na configuração do tenant.
2. **Fase 2, parcial.** A tela de **identificação do cliente** (busca por telefone, nome ou CPF) e a **ficha do cliente em leitura**, com o contato espelho no CRM.

Ao final, um atendente de um tenant com o módulo ligado e o ERP cadastrado busca um cliente no ERP e vê a ficha e os endereços dele. Ainda não monta pedido.

**Cada tenant** (Campinas, Rio Preto, Call Center) tem o seu cadastro do servidor MCP do ERP e a sua lista de lojas (ADR-001).

## 2. Pré-requisitos (fora do PRD)

- **Handoffs E0 e E1 devolvidos** pela sessão do ERP: homologação isolada com `listar_lojas`, `buscar_cliente` e `obter_cliente`, e as amostras reais de resposta.
- **Túnel HTTPS** da homologação criado, e o servidor cadastrado nos tenants de teste pela tela de Configurações, com uma chave por tenant.
- **Prova 0.4** (cliente MCP fora de turno, latência, tempo limite) executada por um humano contra a homologação. O PRD **assume o MCP** e esconde o transporte atrás de `lib/pdv/erp`, de modo que um resultado ruim da prova só troca o interior da camada (ADR-004).

## 3. Objetivos

- Instalar e ligar o módulo `pdv` pela tela de módulos sem afetar quem não o liga.
- Cada tenant mantém a lista das lojas que atende, escolhendo-as da lista do ERP.
- Identificar um cliente no ERP por telefone, nome ou CPF e ver a ficha com os endereços.
- Nada de dado pessoal vaza para log, auditoria ou tela de quem não deveria vê-lo.
- Nenhuma tabela do módulo existe para quem não o instala.

## 4. Histórias de usuário

Ordem estrita: cada história só depende das anteriores. Toda história cumpre a Definition of Done do CRM: `pnpm typecheck`, `pnpm lint` e `pnpm test:unit` (sem filtro de caminho) passam. Histórias com schema rodam também `pnpm test:db`. Histórias com tela trazem uma **spec Playwright** em `tests/e2e/` e evidência visual em `evidence/<entrega>/`.

**Sobre as specs de tela.** Duas famílias: (a) **estados** (vazio, erro, carregando, validações), que interceptam as rotas `/api/v1/pdv/*` do próprio CRM e rodam no CI; (b) **caminho feliz contra a homologação do ERP**, que o CI não alcança, então a spec fica em `FORA_DO_CI` do `e2e.yml` com o motivo escrito ("depende da homologação do ERP por túnel") e é executada à mão, com a evidência versionada.

### US-001: Provisionadora do módulo e tabela de lojas
**Description:** Como mantenedor, preciso da função que cria as tabelas do módulo quando ele é instalado, começando pela tabela de lojas do tenant, para que o módulo desligado não deixe tabela alguma.

**Acceptance Criteria:**
- [ ] Migration versionada `<timestamp>_<NNNN>_pdv_provisionadora.sql` com `-- manifest:` no cabeçalho, e o mesmo conteúdo como apêndice idempotente no `supabase/baseline.sql`. `NNNN` conferido com `pnpm checar:colisao-de-migration`
- [ ] Função `public.fn_pdv_provisionar()` `security definer`, sem parâmetros, com `revoke execute ... from public, anon` e `grant execute ... to service_role` apenas
- [ ] A função cria `pdv_stores` com: `id`, `organization_id` (FK `organizations`, `on delete cascade`), `erp_store_code`, `sigla`, `nome`, `ativa` (padrão verdadeiro), `channel_session_id` (nullable, referência à tabela de conexões de canal; conferir o nome no baseline), `created_at`, `updated_at`
- [ ] Únicos `(organization_id, sigla)` e `(organization_id, erp_store_code)`; `create ... if not exists` em tudo
- [ ] RLS ligada, política `tenant_isolation_pdv_stores_all` via `fn_user_org_ids()`
- [ ] Antes de instalar o módulo, `pdv_stores` **não existe**; depois, existe
- [ ] Teste de invariante: duas organizações, uma não lê nem escreve as lojas da outra
- [ ] `tests/invariants/hardening-definer-varredura.test.ts` continua verde
- [ ] `pnpm test:db` passa (instalação nova e atualização com dados)
- [ ] Typecheck/lint passes

### US-002: Registrar o módulo `pdv`
**Description:** Como dono da instalação, quero instalar e ligar o módulo PDV pela tela de módulos, para ativá-lo só nos tenants que o usam.

**Acceptance Criteria:**
- [ ] Slug `pdv` acrescentado a `MODULOS_OPCIONAIS` e `MODULOS_DE_TABELA` (`lib/instalacao/modulos.ts`), com texto em `TEXTO_DO_MODULO` (`lib/recursos-opcionais/catalogo.ts`) e entrada em `CATALOGO_DE_MODULOS` (`lib/modulos/catalogo.ts`) (conferir os nomes)
- [ ] Módulo **desligado por padrão**; leitura fail-closed (só o valor `ligado` liga)
- [ ] A tela de módulos (`/admin/modulos`) lista o PDV; instalar chama `fn_pdv_provisionar` e grava o módulo como ativo
- [ ] Instalar duas vezes não falha nem duplica
- [ ] `tests/unit/recursos-opcionais-catalogo.test.ts` e os testes de módulos continuam verdes, com caso novo para o `pdv`
- [ ] Spec Playwright (estados): o PDV aparece na tela de módulos e a instalação mostra sucesso; evidência em `evidence/`
- [ ] Typecheck/lint passes

### US-003: Camada `lib/pdv/erp` (leituras)
**Description:** Como desenvolvedor, quero uma camada tipada que fale com o ERP, escondendo o transporte, para que o resto do módulo não conheça MCP.

**Acceptance Criteria:**
- [ ] `lib/pdv/erp/` com `listarLojas()`, `buscarCliente(modo, termo, limite?)` e `obterCliente(id, camposSensiveis?)`, com os tipos do [contrato de formatos](../contrato-mcp-erp-formatos.md)
- [ ] Lê o registro do servidor **da organização** (endereço e chave cifrada) direto do banco, sem o carregador do turno de conversa, e usa `chamarFerramentaRemota` com o tempo limite definido **por chamada**
- [ ] Sem servidor registrado, devolve um erro tipado `erp_nao_configurado`, sem abrir rede
- [ ] Sucesso lido de `structuredContent`; erro lido do **texto** como JSON `{ codigo, mensagem, detalhes? }` e convertido em erro tipado (`termo_invalido`, `nao_encontrado`, `nao_autorizado`, `erp_indisponivel`, `tempo_esgotado`)
- [ ] O endereço e a chave **nunca** aparecem em log nem na auditoria (só o host)
- [ ] Testes unitários com **fixtures de resposta** em `tests/fixtures/pdv-erp/`, derivadas do contrato de formatos; cada caso do contrato (busca por modo, truncado, vazio, termo inválido, ficha com e sem endereço, CPF omitido sem a flag) tem um teste
- [ ] A camada **não** importa nada de `app/` nem faz efeito de escrita
- [ ] Typecheck/lint passes

### US-004: API de lojas, leituras
**Description:** Como atendente ou gerente, quero consultar as lojas do meu tenant e as lojas disponíveis no ERP, para escolher quais o tenant atende.

**Acceptance Criteria:**
- [ ] `GET /api/v1/pdv/lojas` devolve as lojas do tenant (`agent` ou mais), no wrapper `{ data, meta? }`, com `organization_id` resolvido da sessão e nunca do corpo
- [ ] `GET /api/v1/pdv/lojas/erp` devolve as lojas do ERP (`manager` ou mais), marcando as que o tenant já tem
- [ ] Módulo desligado devolve `404`; ERP não configurado devolve erro estável `erp_nao_configurado`; ERP fora do ar devolve `502 erp_indisponivel`
- [ ] Zod no input; `X-Request-Id` na resposta; JSON em `snake_case`
- [ ] Testes de rota: papéis, módulo desligado, ERP indisponível, isolamento entre dois tenants
- [ ] Typecheck/lint passes

### US-005: API de lojas, escrita
**Description:** Como gerente, quero ativar, desativar e vincular conexão a uma loja do meu tenant, para a loja do pedido ser definida pelo canal.

**Acceptance Criteria:**
- [ ] `POST /api/v1/pdv/lojas` aceita a lista de lojas do ERP a adicionar (código e sigla), com `Idempotency-Key`; grava `erp_store_code`, `sigla` e `nome` **vindos do ERP**, nunca do corpo
- [ ] `PATCH /api/v1/pdv/lojas/{id}` altera `ativa` e `channel_session_id` (a conexão precisa ser do **mesmo tenant**; senão `422`)
- [ ] Papel mínimo `manager`; `requireSupportWrite(` antes do efeito; auditoria `pdv.store.updated` em toda mutação bem-sucedida
- [ ] Adicionar uma loja que já existe não duplica (único por sigla) e responde de forma idempotente
- [ ] Desativar uma loja não apaga pedidos anteriores (não há pedidos nesta fase, mas a coluna `ativa` é a única mudança)
- [ ] `tests/unit/suporte-cobertura-de-efeitos.test.ts` continua verde
- [ ] Testes: papéis, idempotência, conexão de outro tenant recusada, auditoria gravada
- [ ] Typecheck/lint passes

### US-006: Aba Lojas, listar e adicionar do ERP
**Description:** Como gerente do tenant, quero ver as lojas que o tenant atende e adicionar lojas da lista do ERP, para configurar o PDV sem digitar códigos.

**Acceptance Criteria:**
- [ ] Nova página na configuração do tenant, com entrada no `NAV_CATALOG` (`modulo: "pdv"`, grupo `organizacao`, seção "Sua empresa", `minRole: "manager"`), rótulo "Lojas" (conferir o grupo e a seção existentes)
- [ ] Lista as lojas do tenant: sigla, nome, código do ERP, situação (ativa ou inativa)
- [ ] Botão "Adicionar lojas do ERP" abre um modal com as lojas do ERP, as já adicionadas desabilitadas, e confirma com um botão
- [ ] Estados: vazio ("Este tenant ainda não tem lojas"), carregando (esqueleto), erro com "Tentar de novo", ERP não configurado (orientação clara ao dono da instalação), módulo desligado (a porta some e a rota dá 404)
- [ ] Textos em português, tom do estilo das interfaces do projeto; botões com alvo de no mínimo 44 px
- [ ] Spec Playwright (estados) no CI e spec do caminho feliz contra a homologação em `FORA_DO_CI`, com evidência
- [ ] Typecheck/lint passes

### US-007: Aba Lojas, ativar, desativar e vincular conexão
**Description:** Como gerente, quero ativar ou desativar uma loja e vincular a ela a conexão de WhatsApp, para o canal de entrada definir a loja.

**Acceptance Criteria:**
- [ ] Cada loja da lista tem um controle de ativa e um seletor de conexão com as conexões **do tenant**, mais a opção "Sem conexão"
- [ ] Alterar salva ao confirmar, mostra o aviso "Loja atualizada" e atualiza a lista sem recarregar
- [ ] Falha ao salvar mantém a alteração na tela com a mensagem "Não foi possível salvar. Tente de novo."
- [ ] Loja inativa aparece esmaecida e identificada como inativa
- [ ] Spec Playwright (estados e validações) e, contra a homologação, o caminho feliz, nas mesmas regras de CI da US-006
- [ ] Typecheck/lint passes

### US-008: API de busca de cliente
**Description:** Como atendente, quero buscar cliente por telefone, nome ou CPF, para identificá-lo antes do pedido.

**Acceptance Criteria:**
- [ ] `GET /api/v1/pdv/clientes?modo=telefone|nome|cpf&q=` (`agent` ou mais) chama `lib/pdv/erp.buscarCliente`; Zod valida `modo` e `q`
- [ ] Resposta no wrapper do CRM com `id`, `nome`, `endereco_principal`, mais `total_encontrado` e `truncado`; **sem CPF, telefone nem e-mail** na lista
- [ ] `termo_invalido` do ERP vira `422` com a mensagem do ERP; `erp_indisponivel` e `tempo_esgotado` viram `502`; `erp_nao_configurado` é estável
- [ ] Nenhum termo de busca (que pode ser CPF ou telefone) aparece em log, no Sentry nem na auditoria
- [ ] Limite de taxa aplicado à rota
- [ ] Testes: cada modo, vazio, truncado, erros do ERP, ausência de dado pessoal nos logs
- [ ] Typecheck/lint passes

### US-009: Tela de identificação do cliente
**Description:** Como atendente, quero uma tela para buscar o cliente por telefone, nome ou CPF e ver os candidatos, para escolher o cliente certo.

**Acceptance Criteria:**
- [ ] Rota `/app/pdv/clientes`, com layout que dá `notFound()` com o módulo desligado, e porta no `NAV_CATALOG` com `modulo: "pdv"`
- [ ] Barra de busca com seletor Telefone, Nome e CPF (padrão Telefone), máscara conforme o modo (`(00) 00000-0000`, `000.000.000-00`), botão "Buscar" e Enter buscando
- [ ] Lista de candidatos mostra nome e endereço principal (uma linha, cortada com reticências); texto longo não quebra o layout
- [ ] Estados: antes da busca ("Digite um telefone, nome ou CPF para buscar o cliente"); campo vazio ("Digite algo para buscar"); telefone incompleto ("Informe o telefone com DDD"); CPF inválido ("CPF inválido"); carregando (esqueleto, botão desabilitado); nenhum resultado ("Nenhum cliente encontrado para "…"" com o termo mantido no campo); erro ("Não foi possível buscar o cliente agora." com "Tentar de novo"); ERP não configurado
- [ ] Com o ERP fora do ar, o atendente vê o erro e **espera** (sem cadastro provisório), como decidido no ADR-002
- [ ] CPF e telefone digitados não aparecem na URL nem em `localStorage`
- [ ] Spec Playwright dos estados, no CI, e do caminho feliz contra a homologação em `FORA_DO_CI`, com evidência
- [ ] Typecheck/lint passes

### US-010: Tabela do vínculo do contato espelho
**Description:** Como mantenedor, preciso guardar a ligação entre o contato do CRM e o cliente do ERP, para o CRM manter conversas, funil e LGPD sem ser o cadastro mestre.

**Acceptance Criteria:**
- [ ] Nova migration versionada (tripla e `-- manifest:`) que redefine `fn_pdv_provisionar` com `create or replace` e acrescenta `pdv_customer_links` (`id`, `organization_id`, `contact_id` FK `contacts`, `erp_customer_id`, `linked_at`)
- [ ] Únicos `(organization_id, erp_customer_id)` e `(organization_id, contact_id)`; RLS por `tenant_isolation_pdv_customer_links_all`
- [ ] Reinstalar o módulo, ou rodar a atualização de um banco que já o tinha, cria a tabela nova sem perder dados (`pnpm test:db:update` passa)
- [ ] Teste de isolamento entre duas organizações
- [ ] `pnpm test:db` passa
- [ ] Typecheck/lint passes

### US-011: Serviço do contato espelho
**Description:** Como sistema, quando o atendente seleciona um cliente do ERP, quero encontrar ou criar o contato correspondente no CRM, sem duplicar.

**Acceptance Criteria:**
- [ ] `vincularClienteDoErp(organizationId, clienteDoErp)` procura o contato por telefone (variantes brasileiras do CRM), por hash do CPF e por e-mail; se acha **um**, grava o vínculo; se não acha, cria o contato e o vínculo
- [ ] Vínculo já existente é devolvido sem mudar nada (idempotente)
- [ ] Erro de unicidade (`23505`) no INSERT é tratado e leva ao contato já existente
- [ ] Mais de um contato candidato: não vincula nenhum e devolve erro tipado `contato_ambiguo` (não escolhe sozinho)
- [ ] O CPF é gravado como o CRM já faz (cifrado, com hash); nunca em log
- [ ] `organization_id` vem do chamador autenticado, nunca do cliente do ERP
- [ ] Testes unitários e de banco: acha por telefone, por CPF e por e-mail; cria; idempotência; ambíguo; corrida de dois pedidos simultâneos
- [ ] Typecheck/lint passes

### US-012: API da ficha do cliente
**Description:** Como atendente, quero abrir a ficha do cliente escolhido, com dados pessoais e endereços.

**Acceptance Criteria:**
- [ ] `GET /api/v1/pdv/clientes/{erp_id}` (`agent` ou mais) chama `obterCliente` com `campos_sensiveis: true`, garante o vínculo do contato espelho (US-011) e devolve a ficha
- [ ] Resposta traz nome, telefone, e-mail, CPF, data de nascimento e a lista de endereços (um só principal, `loja_entrega` ou `null`)
- [ ] `nao_encontrado` vira `404`; erros do ERP como na US-008; `contato_ambiguo` vira `409` com mensagem para o atendente
- [ ] CPF e data de nascimento **não** vão para log nem auditoria; o acesso à ficha gera uma entrada de auditoria `pdv.customer.viewed` sem dado pessoal (hipótese: confirmar na revisão se a leitura deve ser auditada)
- [ ] Testes: ficha completa, sem endereço, cliente inexistente, ambíguo, isolamento entre tenants
- [ ] Typecheck/lint passes

### US-013: Tela da ficha do cliente (leitura)
**Description:** Como atendente, quero ver a ficha e os endereços do cliente que escolhi, para conferir que é o cliente certo.

**Acceptance Criteria:**
- [ ] Clicar em um candidato (ou o resultado único de telefone ou CPF) abre a ficha na coluna da direita da tela de identificação
- [ ] Bloco "Dados pessoais": nome, telefone, e-mail, CPF mascarado e data de nascimento; campos ausentes aparecem como "Não informado"
- [ ] Bloco "Endereços (N)": cada endereço em um card com o selo "Principal", endereço e complemento, bairro, cidade e UF, CEP e a linha "Loja de entrega: <sigla>" ou "Nenhuma loja entrega neste endereço"
- [ ] Cliente sem endereço mostra "Este cliente ainda não tem endereço"
- [ ] A ficha é **somente leitura** nesta fase: nenhum botão de editar, adicionar, remover ou selecionar
- [ ] Estados: carregando (esqueleto), erro com "Tentar de novo", cliente não encontrado, contato ambíguo
- [ ] Endereço muito longo não quebra o layout
- [ ] Spec Playwright dos estados, no CI, e do caminho feliz contra a homologação (com os clientes c-0001 a c-0005 do E1) em `FORA_DO_CI`, com evidência
- [ ] Typecheck/lint passes

### US-014: Registro da entrega
**Description:** Como mantenedor, quero registrar a entrega na documentação do CRM, para o produto continuar auditável.

**Acceptance Criteria:**
- [ ] Fragmento em `.changes/` declarando o efeito no operador (`capacidade_nova`, módulo opcional desligado por padrão), com texto adequado a nota pública; `pnpm release:conferir` passa
- [ ] Mapa de jornadas `docs/testing/user-journey-map.md` com os casos novos (instalar e ligar o módulo, cadastrar lojas, identificar cliente, ver ficha) e a prioridade de cada um
- [ ] Documento de funcionalidade `docs/features/` descrevendo o módulo, o cadastro do ERP por tenant, a exigência de HTTPS público e o que ainda não existe
- [ ] Variáveis de ambiente novas, se houver, em `.env.example` e `lib/env.ts`
- [ ] Declarado o destino da mudança (núcleo, extensão, ambos ou infraestrutura), com a razão, pela pergunta "se nenhuma organização ativar isto, a operação comum continua inteira?"
- [ ] Typecheck/lint passes

## 5. Requisitos funcionais

- FR-1: O módulo `pdv` é opcional, instalado por instância e desligado por padrão; desligado, não há tela, rota, tabela nem item de menu.
- FR-2: A tabela de lojas existe só depois da instalação do módulo, com RLS por tenant.
- FR-3: Cada tenant mantém as lojas que atende, escolhidas da lista do ERP, e pode ativar, desativar e vincular uma conexão de WhatsApp a cada uma.
- FR-4: A camada do ERP lê o servidor cadastrado **para a organização**, sem depender de turno de conversa, e nunca expõe a chave nem o endereço completo em log ou auditoria.
- FR-5: Sucesso do ERP vem em `structuredContent`; erro vem como texto JSON com código estável.
- FR-6: A busca de cliente não devolve CPF, telefone nem e-mail na lista; só a ficha traz esses campos, e só quando o PDV os pede.
- FR-7: ~~Ao abrir a ficha, o CRM encontra ou cria o contato espelho sem duplicar, ou recusa quando há mais de um candidato.~~ **Superado pelo [ADR-007](adr/ADR-007-vinculo-do-contato-por-acao-do-atendente.md) (2026-11-18):** abrir a ficha só lê; o vínculo com o contato do CRM é feito pelo telefone, pelo botão "Vincular ao CRM".
- FR-8: Com o ERP fora do ar, a identificação mostra o erro e espera; não há cadastro provisório.
- FR-9: Toda rota resolve o tenant da sessão e valida a loja contra as lojas do tenant; nenhum dado de tenant vem do corpo da requisição.
- FR-10: Toda mutação gera auditoria sem dado pessoal e aceita idempotência quando cria.

## 6. Fora do escopo (não-metas)

- **Endereços do cliente** (adicionar, alterar, remover, principal), **consulta de CEP** e `loja_do_endereco`: dependem do contrato E2, ainda não escrito.
- **Cadastro e edição de cliente:** dependem do contrato E3, ainda não escrito.
- Botão "Selecionar cliente", tipo do pedido (balcão ou entrega), carrinho, cardápio, configurador de pizza, pedido, envio ao ERP, histórico e recompra (fases 3 a 5).
- Assistente de IA (fase 6).
- A prova 0.4 e a criação da homologação e do túnel do ERP (pré-requisitos).
- Um servidor de ERP de teste dentro do repositório: as fixtures do contrato cobrem os testes unitários, e a integração usa a homologação real.
- Painel por loja, visibilidade de conversas por loja e qualquer visão entre tenants.
- Pagamento.

## 7. Considerações de design

- **Aparência:** portada do protótipo do Lovable (`cart-craft-counter`) para Next.js, com shadcn/ui (estilo `new-york`) e Tailwind 4; o CRM e o protótipo usam a mesma biblioteca de componentes. Usar a skill `frontend-design` para não cair no padrão genérico.
- **Estilo:** o do Prompt 0 de `docs/interface/identificar-cliente/prompts/00-estilo-knowledge.md` (azul só nas ações principais, vermelho só em erro, alvos de 44 px, rótulos visíveis).
- **Prompts das telas:** `docs/interface/identificar-cliente/prompts/01-identificacao-do-cliente.md` define o layout, os componentes, os dados de exemplo e os estados; as histórias US-009 e US-013 implementam a parte de leitura dele.

## 8. Considerações técnicas

- **Doutrina do CRM (obrigatória):** `organization_id` e RLS em toda tabela; service role filtra organização manualmente; migration com a tripla (migration, apêndice idempotente no baseline, `-- manifest:`); função nova em `public` revoga `PUBLIC` e `anon`; Zod em todo input externo; `requireRole` e `requireSupportWrite(` antes do efeito; auditoria de mutação; sem `console.log`; `X-Request-Id`; dinheiro em `_cents` (não há dinheiro nesta fase).
- **Provisionadora:** as tabelas nascem por `fn_pdv_provisionar` na instalação do módulo, não no baseline para todos (ADR-0002 do CRM e ADR-003 do projeto). Redefinir a função com `create or replace` quando uma tabela nova entrar.
- **MCP do ERP (lido no CRM, sem execução):** Streamable HTTP pelo SDK oficial; `Authorization: Bearer`; **um handshake novo a cada chamada**; tempo limite de 15 segundos por padrão e definido por chamada; endereço **HTTPS público** (o CRM recusa HTTP em produção e hosts privados); registro **por organização**, gravado pelo dono da instalação.
- **Formato da resposta do ERP:** ver [contrato-mcp-erp-formatos.md](../contrato-mcp-erp-formatos.md).
- **Numeração de migration:** disputa com o upstream a cada merge; rodar `pnpm checar:colisao-de-migration` e conferir a base antes de escolher o número.
- **E2E:** toda spec nova entra numa `SPECS_PARTE_*` ou em `FORA_DO_CI` **com motivo**, senão `tests/unit/e2e-cobertura-completa.test.ts` reprova.
- **Branch:** atualizar com a `main` antes de começar (doutrina de higiene de branches).
- **Quem executa:** o Ralph não conversa com o ERP real: as histórias entregam código e testes sobre fixtures; as specs contra a homologação são rodadas por uma pessoa.

## 9. Métricas de sucesso

- O módulo instala e liga sem erro em banco novo e em banco atualizado, e desligado não deixa tabela, rota nem menu.
- Um gerente adiciona as lojas do tenant a partir do ERP em menos de 2 minutos, sem digitar código.
- A busca de cliente responde em até 3 segundos no p95, medida contra a homologação (hipótese, confirmada pela prova 0.4).
- Nenhum CPF, telefone, e-mail, chave ou endereço do ERP aparece em log, Sentry ou auditoria, comprovado por teste.
- O teste de isolamento passa entre dois tenants para lojas e vínculos.

## 10. Perguntas em aberto

1. **Fixtures:** até as amostras reais do E0 e do E1 chegarem, as fixtures saem dos exemplos do contrato. Elas devem ser trocadas pelas respostas reais na devolutiva. Quem faz a troca e quando?
2. **ERP não configurado:** o texto exato da orientação e a quem ela se dirige (o gerente do tenant não cadastra o servidor; só o dono da instalação).
3. **Loja de entrega fora do tenant:** a ficha mostra a sigla que o ERP devolve mesmo quando a loja não pertence ao tenant? A decisão de recusar ou encaminhar (pendência do PRD do FR-010) ainda não existe.
4. **Auditoria de leitura da ficha (US-012):** o CRM audita só mutações. Ver a ficha deve gerar `pdv.customer.viewed`, ou isso vira ruído?
5. **Grupo e seção do `NAV_CATALOG`** para a aba Lojas e para a porta do PDV: conferir os grupos existentes antes da US-006 e da US-009.
6. **Conexões de canal:** nome exato da tabela e da coluna para o `channel_session_id` (US-001), a conferir no baseline.
7. **Cadastro do ERP ausente na aba Lojas:** a US-006 supõe que o dono da instalação já cadastrou o servidor do ERP no tenant. Falta decidir se a aba deve detectar a ausência e orientar, e como (já previsto como estado, mas o texto está em aberto, ver a pergunta 2).
