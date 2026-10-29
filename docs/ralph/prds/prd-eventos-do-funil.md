# PRD: Eventos do funil

> Fonte das decisões: [`docs/design/eventos-do-funil.md`](../../design/eventos-do-funil.md),
> a spec [`2026-10-29-eventos-do-funil-design.md`](../../superpowers/specs/2026-10-29-eventos-do-funil-design.md) e os ADRs
> 0007, 0008 e 0009 em `docs/adr/` (todos propostos). Este PRD não repete o detalhe campo a campo da spec: ele a transforma em histórias.
> **Escopo: as três etapas.** Etapa 1 (núcleo), etapa 2 (porta pública e plugin para o navegador), etapa 3 (webhook de entrada).
> Cada etapa só começa depois da anterior ter passado na própria prova.

## Introduction

Sistemas de fora do CRM (cardápio digital, agenda online, portal de imóveis) sabem o que o cliente faz: abriu, viu um item,
montou o carrinho, comprou. Hoje, para o funil refletir isso, quem integra precisa conhecer os ids das etapas, manter a própria
tabela de "níveis" para o pedido não retroceder e juntar três chamadas MCP por fato (cerca de 9 escritas por pedido na Bella
Capri, com o teto de 30 por minuto por token). Quem só consegue colar um script no cardápio de um terceiro não consegue integrar.

Esta feature move essa regra para o funil: **cada funil cadastra os seus eventos** (nada nasce semeado), e uma operação única
registra o fato no histórico, atualiza o estado, grava o valor e move o card conforme o cadastro, de forma idempotente e sem
retroceder. A etapa 2 expõe a operação ao navegador por uma porta pública com chave, e a etapa 3 faz o webhook de entrada
carregar valor e JSON do pedido.

Princípios já decididos:
- "Compra" não é um tipo de evento: é a combinação etapa de destino de ganho + campo do valor + chave de repetição + não
  respeitar movimento manual.
- Todo evento aceito vai para o histórico (`crm_lead_activities`); estado e valor são projeção dele.
- Evento sem cadastro é recusado, por evento.
- O pedido não retrocede pelos eventos. A equipe pode mover à mão, e o evento respeita isso conforme um flag do cadastro.

## Goals

- O funil declara os seus eventos; o integrador não precisa conhecer ids de etapa nem manter tabela de níveis.
- Uma chamada por lote registra, atualiza estado, grava valor e move o card, com um resultado por evento.
- Reenvio, clique duplo e entrega fora de ordem nunca deixam o pedido errado (idempotência por camada).
- Um cardápio de terceiro, sem servidor próprio, consegue enviar visita, item, carrinho, revisão e compra só com um script.
- Pedidos que nascem fora do WhatsApp entram no CRM pelo webhook com valor e itens, separados nos relatórios dos que nascem na conversa.
- A venda fechada por evento chega ao CRM com valor, para o envio de conversão de anúncio funcionar.

## User Stories

### ETAPA 1 — Núcleo

### US-001: Responder os pontos em aberto antes de construir
**Description:** Como desenvolvedor, preciso confirmar quatro fatos sobre o código existente antes de escrever a migration, para o desenho não nascer sobre suposição.

**Acceptance Criteria:**
- [ ] Documento `docs/design/eventos-do-funil-fase-0.md` com uma seção por pergunta, cada uma com a evidência (comando, consulta ou teste) e a conclusão
- [ ] Pergunta 1: o `actor_kind` gravado em `crm_lead_activities` quando um token MCP chama `crm_move_lead_stage`, e quando o `moveLeadHandler` roda com um ator de sistema. Resposta diz se algum caminho grava `user`
- [ ] Pergunta 2: existe gatilho, política ou rotina de retenção que impeça `delete` em `crm_lead_activities`? Lista os achados com o nome do objeto
- [ ] Pergunta 3: alguma regra do `moveLeadHandler` exige ator humano (motivo de ganho, campo obrigatório, reabertura)?
- [ ] Pergunta 4: as políticas `support_write_*` de `crm_stages` precisam de espelho em `crm_pipeline_events`?
- [ ] Nenhum código de produção alterado; testes de investigação, se existirem, ficam em `tests/unit/` e passam
- [ ] Se alguma resposta contradiz o Design Doc, o Design Doc é corrigido na mesma entrega
- [ ] Typecheck/lint passes

### US-002: Criar a tabela de cadastro de eventos
**Description:** Como mantenedor, quero a tabela `crm_pipeline_events` com RLS, para o funil guardar os seus eventos.

**Acceptance Criteria:**
- [ ] Migration em `supabase/migrations/` com linha `-- manifest:` e número obtido por `pnpm checar:colisao-de-migration`
- [ ] Colunas e constraints exatamente como na seção "Modelo de dados" da spec: `key` com a regex, `unique (pipeline_id, key)`, `value_unit` com `check`, `value_path` e `value_unit` juntos ou nenhum, FK de `stage_id` com `on delete set null`
- [ ] RLS `tenant_isolation_crm_pipeline_events_all` via `fn_user_org_ids()`; escrita de `manager` para cima; decisão da US-001 sobre `support_write_*` aplicada
- [ ] Apêndice idempotente no `supabase/baseline.sql`
- [ ] `lib/database.types.ts` regenerado
- [ ] `pnpm test:db` passa em modo instalação e em modo atualização
- [ ] Typecheck/lint passes

### US-003: Provar o isolamento do cadastro entre organizações
**Description:** Como mantenedor, quero um teste que cria duas organizações e prova que uma não lê nem escreve nos eventos da outra.

**Acceptance Criteria:**
- [ ] Novo arquivo em `tests/invariants/` (sem editar invariantes existentes) com duas organizações e um evento em cada
- [ ] Leitura cruzada devolve zero linhas; escrita cruzada é recusada
- [ ] Sabotagem registrada no PR: remover a política de isolamento deixa o teste vermelho, com o número de casos previsto
- [ ] `pnpm test:db tests/invariants/<arquivo>` passa
- [ ] Typecheck/lint passes

### US-004: Garantir no banco que o mesmo `event_id` não grava duas vezes
**Description:** Como mantenedor, quero um índice único por pedido e `event_id`, para duas chamadas simultâneas não duplicarem o histórico.

**Acceptance Criteria:**
- [ ] Migration cria `uniq_lead_activities_external_event_id` (parcial, `type = 'external_event'`, por `organization_id`, `lead_id` e `payload->>'event_id'`)
- [ ] A migration deduplica linhas existentes (mantém a mais antiga) antes de criar o índice e é idempotente; respeita o achado da US-001 sobre `delete`
- [ ] Apêndice correspondente no `supabase/baseline.sql`
- [ ] `registrarEventosDoNegocio` em `lib/leads/eventos-externos.ts` trata o erro `23505` como `repetido`
- [ ] Teste de banco: a segunda inserção do mesmo `event_id` no mesmo pedido falha com `23505`; o mesmo `event_id` em pedidos diferentes é aceito
- [ ] Teste de banco da migration com duplicatas pré-existentes, em instalação e atualização
- [ ] Sabotagem: remover o tratamento de `23505` deixa vermelho o teste de simultaneidade
- [ ] Typecheck/lint passes

### US-005: Funções puras de caminho e valor
**Description:** Como desenvolvedor, quero funções puras que leiam um campo do JSON do evento e o convertam em centavos, para a operação não duplicar essa lógica.

**Acceptance Criteria:**
- [ ] Módulo novo em `lib/leads/` sem I/O: `resolverCaminho(data, caminho)` aceita só nomes de campo com ponto (`value`, `pedido.total`), devolve `undefined` quando não acha e nunca interpreta expressão nem índice de array
- [ ] `valorEmCentavos(valor, unidade)`: `reais` arredonda `valor * 100`; `centavos` exige inteiro; recusa não numérico, não finito e negativo. **Não há teto máximo** (decisão do dono)
- [ ] Testes por tabela: caminho simples, aninhado, ausente, tipo errado, array; valor em reais com arredondamento, em centavos, string numérica, negativo, `NaN`, `Infinity`
- [ ] Typecheck/lint passes

### US-006: Funções puras de decisão de movimento e ordem do estado
**Description:** Como desenvolvedor, quero a regra de "não retrocede", "respeita movimento manual" e "o mais novo vence" como funções puras testáveis.

**Acceptance Criteria:**
- [ ] `decidirMovimento(...)` recebe a etapa atual, o conjunto de etapas de destino do funil, as posições, o destino, se o pedido está encerrado, se a etapa está arquivada, o flag do evento e o ator do último movimento, e devolve um dos resultados `movido`, `sem_destino`, `ja_na_etapa_ou_adiante`, `respeita_movimento_manual`, `pedido_encerrado`, `etapa_arquivada`
- [ ] Etapa atual fora do conjunto de destinos (Conversas, Chamar humano) não trava o avanço; etapa atual dentro do conjunto só avança para posição maior
- [ ] `estadoDevePrevalecer(at, ultimoAt)` devolve verdadeiro quando `at` é igual ou mais novo
- [ ] Testes por tabela cobrem a matriz: dentro e fora do conjunto, à frente e atrás, igual, encerrado, arquivada, flag ligado e desligado, ator `user` e `system`
- [ ] Sabotagem registrada: trocar "maior" por "maior ou igual" e ignorar o ator deixam testes vermelhos, com o número previsto
- [ ] Typecheck/lint passes

### US-007: `crm_track_event`: validação e registro
**Description:** Como integrador, quero enviar um lote de eventos de um pedido e receber um resultado por evento, para saber o que foi aceito, repetido ou recusado.

**Acceptance Criteria:**
- [ ] Ferramenta `crm_track_event` registrada em `lib/mcp/tools/` (escopo `mcp:write`, papel `agent`), entrada `lead_id` e `events` (1 a 50), `event` e `event_id` obrigatórios, `at` e `data` opcionais
- [ ] Limites: 8 KB por evento, 64 KB por chamada, `at` entre 30 dias atrás e 5 minutos à frente; uma escrita no teto do token por chamada
- [ ] O funil sai do pedido (`crm_leads.pipeline_id`), nunca da entrada; a busca do pedido filtra `organization_id`
- [ ] Pedido de contato `is_personal` é recusado (403), como em `crm_add_lead_events`
- [ ] Resposta com um resultado por evento, na ordem enviada: `registrado`, `repetido` (mesmo `event_id`) ou `recusado` com `codigo` e `mensagem`
- [ ] Códigos de recusa: `evento_nao_cadastrado` (a mensagem lista as chaves ativas do funil), `evento_inativo`, `evento_grande`, `hora_fora_da_janela`
- [ ] Recusar um evento não derruba os outros do lote
- [ ] Registro com `performed_at = at` na atividade `external_event`
- [ ] Testes: lote misto (válido, desconhecido, repetido, inativo) devolve os resultados corretos na ordem; pedido de outra organização devolve "Pedido não encontrado."
- [ ] Sabotagem: remover o filtro de `organization_id` deixa o teste de isolamento vermelho
- [ ] Typecheck/lint passes

### US-008: `crm_track_event`: repetição de negócio, estado e valor
**Description:** Como integrador, quero que o último carrinho vença, que a mesma compra não conte duas vezes e que o valor da venda seja gravado.

**Acceptance Criteria:**
- [ ] Com `dedupe_path` cadastrado, um evento cujo valor nesse caminho já foi registrado no mesmo pedido devolve `repetido` e não faz mais nada
- [ ] Com `state_key`, o conteúdo de `data` é gravado em `custom_fields[state_key]` só se `at` for igual ou mais novo que o do último evento da mesma chave no pedido, lido do histórico; evento atrasado devolve `estado: ignorado_antigo`
- [ ] Com `value_path` e `value_unit`, o valor vira `value_cents`; valor inválido devolve `recusado` com `valor_invalido` e nada é gravado para esse evento
- [ ] Estado e valor vão na mesma atualização do pedido, **antes** do movimento
- [ ] Pedido encerrado não muda de estado nem de valor; os resultados trazem `ignorado_pedido_encerrado`
- [ ] Estado e valor são aplicados mesmo quando o registro do histórico foi `repetido` por queda anterior no meio do processamento (cada passo se protege sozinho)
- [ ] Testes cobrem: mesmo `order_id` com `event_id` diferente, carrinho atrasado, valor em reais e centavos, pedido encerrado
- [ ] Sabotagem: aplicar o valor depois do movimento deixa vermelho o teste de ordem
- [ ] Typecheck/lint passes

### US-009: `crm_track_event`: movimento da etapa
**Description:** Como integrador, quero que o card avance para a etapa cadastrada sem retroceder e sem desfazer decisão da equipe.

**Acceptance Criteria:**
- [ ] O movimento usa `decidirMovimento` (US-006) e, quando `movido`, passa pelo `moveLeadHandler`, com ator `system`; mover para o mesmo lugar não gera `stage_changed`
- [ ] A atualização de etapa é condicional à etapa lida; dois eventos simultâneos geram um só `stage_changed`
- [ ] Último `stage_changed` com `actor_kind = 'user'` e flag `respects_manual_move` ligado: o evento é registrado, estado e valor são gravados e o resultado é `respeita_movimento_manual`
- [ ] Depois de um movimento do evento (ator `system`), os eventos seguintes voltam a mover normalmente
- [ ] Recusa do funil (motivo, campo obrigatório) devolve `recusado_pelo_funil` com a mensagem, e estado e valor já gravados permanecem
- [ ] Etapa de destino arquivada devolve `etapa_arquivada` e o evento só registra
- [ ] Testes: sequência page_view → view_item → cart → checkout → purchase termina em Compras; evento de nível menor depois não retrocede; desvio por "Chamar humano" não trava a compra; movimento manual no meio é respeitado
- [ ] Sabotagem: ignorar o `actor_kind` deixa vermelho o teste de movimento manual
- [ ] Typecheck/lint passes

### US-010: Leitura das chaves e gates do catálogo MCP
**Description:** Como integrador, quero listar os eventos cadastrados de um funil, e como mantenedor quero que as duas ferramentas novas passem nos gates do catálogo.

**Acceptance Criteria:**
- [ ] `crm_list_pipeline_events` (leitura, `mcp:read`) recebe `pipeline_id` e devolve chave, nome, se está ativo, nome da etapa de destino, se guarda estado e se define valor; nunca devolve ids de etapa
- [ ] Entradas nos gates: `lib/mcp/tools/catalogo/funil.ts` (rótulo sem jargão e risco), `lib/ai/runtime/escopo-das-escritas.ts` (`crm_track_event: { lead_id: "negocio" }`), `lib/leads/escopo-de-funil.ts` (`funil_vem_do_lead`) e a lista de trabalho de atendente em `tests/unit/capacidade-alcancavel-pelo-agente.test.ts`
- [ ] Seção nova em `docs/specs/11-spec-mcp-server-internal.md` descrevendo as duas ferramentas e os dois contratos (`crm_add_lead_events` permissiva, `crm_track_event` estrita)
- [ ] `crm_add_lead_events` não muda de comportamento
- [ ] Os gates `catalogo-servido`, `escrita-do-turno-escopo`, `escopo-de-funil`, `capacidade-alcancavel-pelo-agente` e `catalogo-tools-leigo-friendly` passam
- [ ] Typecheck/lint passes

### US-011: Provar a operação pelo MCP direto, na stack local
**Description:** Como mantenedor, quero a prova de ponta a ponta da operação com um token real, para não depender só de testes unitários.

**Acceptance Criteria:**
- [ ] Roteiro executado na stack local com token temporário, que é apagado ao final (conferido por consulta): cadastro dos eventos de um funil, sequência completa de um pedido, reenvio idêntico, evento atrasado, evento desconhecido, movimento manual no meio
- [ ] Tabela com cada passo, o resultado devolvido e o estado do pedido no banco anexada ao PR
- [ ] Dados de teste apagados e a contagem de sobras zerada
- [ ] `pnpm test:db` e a suíte inteira conferidos pelo rodapé (rodapé e `grep FAIL` batendo)
- [ ] Typecheck/lint passes

### US-012: API de cadastro: listar e criar eventos
**Description:** Como gerente, quero criar eventos de um funil por uma API protegida, para a tela poder configurá-los.

**Acceptance Criteria:**
- [ ] `GET /api/v1/pipelines/[id]/events` lista os eventos do funil com último recebimento e contagem dos últimos 7 dias (lidos do histórico); papel `manager` ou mais
- [ ] `POST` cria, aceita `Idempotency-Key`, valida com Zod, declara `requireSupportWrite(` antes do efeito e grava `pipeline_event.created` em `api_audit_log`
- [ ] `organization_id` vem do JWT, nunca do corpo
- [ ] Validações: `stage_id` do mesmo funil, não arquivada e **não de perda**; `key` com a regex e única no funil; `value_path` e `value_unit` juntos; `state_key` não pode ser igual à chave de um campo declarado do funil (erro 422)
- [ ] `state_key` já usada por outro evento do mesmo funil **salva e devolve um aviso** na resposta (não bloqueia)
- [ ] O gate `suporte-cobertura-de-efeitos` passa
- [ ] Testes de rota: criação válida, chave duplicada, etapa de perda, etapa de outro funil, campo declarado, aviso de `state_key` repetida, papel insuficiente
- [ ] Typecheck/lint passes

### US-013: API de cadastro: editar e desativar eventos
**Description:** Como gerente, quero editar e desativar um evento sem perder o histórico.

**Acceptance Criteria:**
- [ ] `PATCH /api/v1/pipelines/[id]/events/[event_id]` edita os campos permitidos; a `key` é imutável quando já existe atividade com ela (409 com mensagem clara)
- [ ] `DELETE` desativa (`is_active = false`), não apaga; auditoria `pipeline_event.deactivated`; `pipeline_event.updated` nas edições
- [ ] Evento desativado passa a ser recusado com `evento_inativo` na operação
- [ ] `requireSupportWrite(` declarado nos dois handlers e `requireRole` de `manager`
- [ ] Testes: mudar a `key` com atividade, desativar e reenviar evento, editar a etapa de destino
- [ ] Typecheck/lint passes

### US-014: Tela: cadastrar e editar eventos do funil
**Description:** Como gerente, quero uma seção em Etapas do Funil onde cadastro os eventos e escolho para onde o card vai em cada um.

**Acceptance Criteria:**
- [ ] Seção "Para onde o card vai em cada evento", abaixo de "Para onde o card vai em cada passo", em `app/app/settings/tenant/pipelines/`
- [ ] Cada linha mostra nome, chave e etapa de destino (ou "Não mover"); criar, editar e desativar usam a API das US-012 e US-013
- [ ] Painel recolhível por evento com: guardar em, campo do valor e unidade, chave de repetição, respeitar movimento manual
- [ ] A lista de etapas de destino não oferece etapas de perda nem arquivadas
- [ ] Textos em linguagem de quem usa, sem jargão (nada de "state_key" ou "jsonb" na tela)
- [ ] Não cria entrada nova em `lib/navigation/catalogo.ts` (é seção de uma tela já alcançável)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-015: Tela: avisos e sinais de uso
**Description:** Como gerente, quero ser avisado de configurações perigosas e ver se cada evento está chegando.

**Acceptance Criteria:**
- [ ] Aviso (não bloqueia): "esta etapa fecha a venda, mas o evento não define o valor, então a venda não será enviada como conversão", quando o destino é de ganho e não há campo do valor
- [ ] Aviso quando a etapa de destino foi arquivada (o evento passa a só registrar)
- [ ] Aviso quando dois eventos usam o mesmo "guardar em"
- [ ] Erro de bloqueio quando "guardar em" é igual à chave de um campo declarado do funil
- [ ] Cada evento mostra "visto pela última vez" e a contagem dos últimos 7 dias; sem nenhum recebimento mostra "ainda não recebeu nada"
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-016: Prova pela tela da etapa 1
**Description:** Como mantenedor, quero a prova de que um leigo cadastra eventos e vê o card mudar, num ambiente estilo instalação nova.

**Acceptance Criteria:**
- [ ] Spec Playwright em `tests/e2e/` registrada em uma `SPECS_PARTE_N` do `.github/workflows/e2e.yml` (ou em `FORA_DO_CI` com o motivo); o gate `e2e-cobertura-completa` passa
- [ ] Banco do `baseline.sql` + `bootstrap-owner`, envs opcionais ausentes
- [ ] Fluxo: criar funil, cadastrar eventos à mão, ver os avisos, chamar a operação por fora e ver a timeline e o card mudarem
- [ ] Evidência (capturas e traço) em `evidence/eventos-do-funil/`, pasta versionada
- [ ] Linha nova em `docs/testing/user-journey-map.md`
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-017: Documentação e release da etapa 1
**Description:** Como operador, quero a nota de versão e o guia da Bella Capri atualizados.

**Acceptance Criteria:**
- [ ] Fragmento em `.changes/` com `impacto: capacidade_nova`, `pnpm release:conferir` passa; nenhuma seção escrita à mão no `CHANGELOG.md`
- [ ] `integracao-mcp-cardapio.md` descreve a operação nova, a lista de eventos e quando usar `crm_add_lead_events` e quando `crm_track_event`
- [ ] Nota no guia: a recusa é definitiva, não deve ser reenviada
- [ ] Os cinco eventos da Bella Capri documentados como cadastro manual (sem modelo): chave, destino, guardar em, valor e flag de cada um
- [ ] Documento do projeto que afirma estado sobre o comportamento mudado foi conferido (DoD 16)
- [ ] Typecheck/lint passes

### ETAPA 2 — Porta pública e plugin para o navegador

### US-018: Chaves públicas do rastreador
**Description:** Como gerente, quero uma chave pública por funil com as origens permitidas, para um script no navegador poder enviar eventos sem token secreto.

**Acceptance Criteria:**
- [ ] Migration em tripla de uma tabela de chaves (organização, funil, identificador público, origens permitidas, ativa, revogada) com RLS, apêndice no baseline e `-- manifest:`
- [ ] A chave é um identificador público, **não** um segredo: revogar a desativa na hora
- [ ] Teste de isolamento entre organizações e teste de que a chave resolve a organização e o funil sem aceitar nenhum dos dois pelo corpo
- [ ] API de gerenciamento (criar, listar, revogar) com `manager`, `requireSupportWrite(`, Zod, auditoria
- [ ] Typecheck/lint passes

### US-019: Porta pública de coleta
**Description:** Como script no navegador, quero enviar um lote de eventos com a chave pública, para o CRM processá-los.

**Acceptance Criteria:**
- [ ] Rota pública em `app/api/v1/` com entrada em `lib/auth/public-paths.ts` (público aqui significa "o proxy não decide", nunca "sem autenticação": a chave decide)
- [ ] CORS só para as origens permitidas da chave; origem não listada não recebe os cabeçalhos
- [ ] Limite de taxa por chave e por IP; lote de até 20 eventos; Zod em toda entrada
- [ ] Organização e funil vêm **somente** da chave
- [ ] A resposta nunca revela dado do contato nem se o pedido existe (mesma forma de resposta para qualquer `idtrack`)
- [ ] Usa a mesma operação da etapa 1 por baixo; o resultado por evento é devolvido sem dados pessoais
- [ ] Testes: origem não permitida, chave revogada, lote grande, `idtrack` inexistente igual a `idtrack` válido sem efeito
- [ ] Typecheck/lint passes

### US-020: Identificar o pedido pelo `idtrack`
**Description:** Como cardápio de terceiro, quero que o CRM ache o pedido aberto do cliente pelo `idtrack` da URL, para eu não precisar listar leads.

**Acceptance Criteria:**
- [ ] O `idtrack` é o id do contato e precisa ser um UUID; qualquer outro valor é descartado sem efeito e sem erro revelador
- [ ] O servidor acha o pedido aberto mais recente do contato **no funil da chave**; sem pedido aberto, o evento é descartado sem criar nada
- [ ] Contato marcado como pessoal é descartado
- [ ] Sem `idtrack`, nada é enviado e nenhuma identidade é gravada
- [ ] Testes: UUID válido sem pedido, telefone no lugar do id, contato pessoal, vários pedidos abertos (vale o mais recente), pedido de outro funil
- [ ] Typecheck/lint passes

### US-021: Regras de confiança para evento vindo do navegador
**Description:** Como mantenedor, quero travas que limitem o estrago de uma compra forjada, já que a compra pode sair do navegador.

**Acceptance Criteria:**
- [ ] Todo evento da porta pública é gravado com `origem: navegador` no histórico
- [ ] Evento cujo destino é etapa de ganho, vindo do navegador, só fecha o pedido se o pedido já registrou ao menos um evento de estado antes (por exemplo carrinho ou revisão); caso contrário é registrado e não move, com o resultado explicando o motivo
- [ ] Uma compra por pedido (mesmo `order_id` com outro `event_id` é repetição)
- [ ] Pedido já encerrado só registra o evento
- [ ] Cancelamento não existe na porta pública: nenhum evento do navegador move para etapa de perda (já proibido no cadastro) e a documentação diz que cancelar é pelo servidor com token
- [ ] Testes: compra do navegador sem carrinho antes, compra duplicada, compra em pedido encerrado
- [ ] Sabotagem registrada: remover a trava de sequência deixa o teste vermelho
- [ ] Typecheck/lint passes

### US-022: O script do rastreador (SDK v1)
**Description:** Como dono de um cardápio de terceiro, quero colar um script e chamar funções simples nos pontos certos, para enviar os eventos ao CRM.

**Acceptance Criteria:**
- [ ] Arquivo estático versionado em `public/`, sem dependências; implementação própria (nenhum trecho copiado de SDK de terceiros)
- [ ] API manual: inicialização com a chave e chamadas por evento, por exemplo `track(evento, dados)`; **sem** observação automática por atributos HTML e **sem** leitura do `dataLayer` na v1
- [ ] Lê o `idtrack` da URL e o guarda na sessão do navegador; sem `idtrack` válido, não envia nada
- [ ] Cada evento recebe um `event_id` (UUID) na criação e o mantém até a confirmação; fila em lote de até 20 eventos a cada 3 segundos; envio ao sair da página; reenvio com o mesmo `event_id`
- [ ] **Não** reenvia evento `recusado` (a recusa é definitiva); reenvia só falha de rede e 5xx
- [ ] Opção de não guardar nada no navegador e função de optar por sair, que apaga o que foi guardado
- [ ] Modo de depuração que avisa no console quando a chave do evento não existe, usando a lista de chaves da resposta
- [ ] Falha do script nunca quebra a página do cardápio (tudo dentro de `try/catch`)
- [ ] Testes do arquivo com ambiente de navegador simulado: fila, lote, reenvio, recusa, optar por sair
- [ ] Typecheck/lint passes

### US-023: Tela de instalação do rastreador
**Description:** Como gerente, quero criar a chave, informar as origens do cardápio e copiar o trecho de instalação.

**Acceptance Criteria:**
- [ ] Seção na tela de funis (ou ao lado dos eventos) para criar e revogar a chave, listar origens permitidas e copiar o trecho pronto com a chave
- [ ] Texto explica em linguagem simples o que é a chave pública e que o cancelamento não passa por ela
- [ ] Mostra se a chave já recebeu algum evento
- [ ] Sem entrada nova em `lib/navigation/catalogo.ts` se for seção de tela existente; se for tela nova, declarada no catálogo
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-024: Prova de ponta a ponta da etapa 2
**Description:** Como mantenedor, quero provar que uma página de teste com o script move o card de um pedido de verdade.

**Acceptance Criteria:**
- [ ] Página de teste servida localmente, em origem diferente da do CRM, carregando o script
- [ ] Fluxo Playwright: abrir com `idtrack`, ver item, montar carrinho, revisar, comprar; o card chega a Compras com valor e JSON
- [ ] Casos negativos provados com receiver real: origem não permitida, chave revogada, `idtrack` com telefone, compra sem carrinho, recarga da página de sucesso (sem duplicar)
- [ ] Spec em `SPECS_PARTE_N` ou `FORA_DO_CI` com motivo; evidência em `evidence/eventos-do-funil/`
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-025: Documentação e release da etapa 2
**Description:** Como operador, quero a nota de versão e o guia de instalação do rastreador.

**Acceptance Criteria:**
- [ ] Fragmento em `.changes/` (`capacidade_nova`) e `pnpm release:conferir` passando
- [ ] Guia de instalação para o dono do cardápio: trecho, chamadas por evento, o que o script não faz, aviso de consentimento e de privacidade (o que é guardado no navegador)
- [ ] Documento de LGPD do produto conferido: o script não envia telefone, e-mail nem nome
- [ ] Typecheck/lint passes

### ETAPA 3 — Webhook de entrada

### US-026: Valor da venda no webhook de entrada
**Description:** Como dono de uma plataforma de cardápio que avisa pedido finalizado, quero que o valor do pedido preencha `value_cents` do card.

**Acceptance Criteria:**
- [ ] A fonte do webhook aceita configurar o campo do valor e a unidade (reais ou centavos), reaproveitando `valorEmCentavos` da US-005
- [ ] O valor é gravado em `value_cents` na criação do card e na atualização de um card reaproveitado, antes de mover a etapa
- [ ] Valor inválido não derruba o envio: o card é criado sem valor e o motivo fica no log do webhook
- [ ] Testes de rota: reais, centavos, ausente, inválido
- [ ] Os testes existentes de `webhooks/in` continuam passando
- [ ] Typecheck/lint passes

### US-027: Guardar o JSON do pedido no webhook
**Description:** Como gerente, quero que os itens do pedido (lista e objetos) não sejam descartados, para consultar o que foi comprado.

**Acceptance Criteria:**
- [ ] A fonte aceita configurar uma chave de `custom_fields` onde o conteúdo aninhado do envio é guardado como JSON
- [ ] Sem a configuração, o comportamento atual (descartar o aninhado) não muda
- [ ] Limite de tamanho do JSON guardado, com recusa explícita no log quando excede
- [ ] A chave configurada não pode coincidir com um campo declarado do funil
- [ ] Testes de rota: objeto, lista, tamanho acima do limite, chave coincidente
- [ ] Typecheck/lint passes

### US-028: Tela da fonte do webhook para valor e JSON
**Description:** Como gerente, quero configurar na tela da fonte o campo do valor e onde guardar o JSON do pedido.

**Acceptance Criteria:**
- [ ] Na tela de integração de dados, a fonte mostra os dois campos novos, com explicação em linguagem simples
- [ ] Aviso quando a etapa padrão da fonte é de ganho e nenhum campo do valor foi configurado
- [ ] Aviso explicando que a etapa padrão da fonte vale para todo envio daquela fonte
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-029: Separar a origem nos relatórios e provar o webhook
**Description:** Como analista, quero que o pedido que nasceu fora do WhatsApp não infle a conversão da conversa à compra.

**Acceptance Criteria:**
- [ ] `relatorios-bellacapri.sql` filtra ou separa por origem (`whatsapp` e `webhook`) nas consultas de funil e de conversão, com validação em transação revertida
- [ ] Prova na stack local com fonte temporária: cliente novo cria card em Compras com valor e JSON; cliente com card da Bella em Revisão é reaproveitado sem duplicar e fecha em um envio; reenvio idêntico não altera nada
- [ ] Dados de teste e fonte temporária apagados, contagem de sobras zerada
- [ ] Typecheck/lint passes

### US-030: Documentação e release da etapa 3
**Description:** Como operador, quero a nota de versão e a explicação de quando usar o webhook e quando usar o rastreador.

**Acceptance Criteria:**
- [ ] Fragmento em `.changes/` e `pnpm release:conferir` passando
- [ ] Guia com a tabela: jornada que começa no WhatsApp usa o rastreador; pedido que nasce fora usa o webhook
- [ ] Registro do cuidado de duplicidade quando a mesma compra chegar pelas duas portas, e do que o produto faz nesse caso
- [ ] Typecheck/lint passes

## Functional Requirements

**Etapa 1**
- FR-1: O sistema deve permitir cadastrar, por funil, eventos com chave, nome, descrição, etapa de destino, flag de respeito ao movimento manual, "guardar em", campo e unidade do valor, chave de repetição e ativo.
- FR-2: A chave do evento deve respeitar `^[a-z][a-z0-9_]{0,63}$`, ser única por funil e imutável depois de usada.
- FR-3: A etapa de destino deve ser do mesmo funil, não arquivada e nunca de perda.
- FR-4: `crm_track_event` deve receber de 1 a 50 eventos de um pedido e devolver um resultado por evento, na ordem enviada.
- FR-5: Evento sem cadastro ativo no funil do pedido deve ser recusado com `evento_nao_cadastrado`, listando as chaves ativas; os demais eventos do lote seguem.
- FR-6: Todo evento aceito deve ser gravado em `crm_lead_activities` como `external_event`, com `performed_at` igual à hora do evento.
- FR-7: O mesmo `event_id` no mesmo pedido não deve gravar duas vezes, inclusive em chamadas simultâneas (índice único e tratamento de `23505`).
- FR-8: Com chave de repetição cadastrada, um valor já registrado no pedido deve devolver `repetido`.
- FR-9: Com "guardar em" cadastrado, o último conteúdo deve ser projetado em `custom_fields`, vencendo o de hora mais nova.
- FR-10: Com campo do valor cadastrado, o valor deve ser convertido para centavos inteiros e gravado em `value_cents` antes do movimento. Sem teto máximo.
- FR-11: O movimento só avança: se a etapa atual está entre os destinos do funil, só vai para posição maior; fora do conjunto, pode seguir.
- FR-12: Pedido encerrado não deve ter estado, valor nem etapa alterados pelos eventos.
- FR-13: Com o flag ligado, se o último movimento do pedido foi de uma pessoa, o evento deve registrar sem mover.
- FR-14: Mover para a etapa em que o pedido já está não deve gerar `stage_changed`.
- FR-15: `crm_list_pipeline_events` deve listar os eventos de um funil sem expor ids de etapa.
- FR-16: A tela deve oferecer cadastro, edição e desativação, com avisos para ganho sem valor, etapa arquivada e "guardar em" repetido, e bloqueio para "guardar em" igual a campo declarado.
- FR-17: Toda mutação de cadastro deve gerar auditoria e declarar `requireSupportWrite(` antes do efeito.

**Etapa 2**
- FR-18: A porta pública deve resolver organização e funil somente pela chave pública, nunca pelo corpo.
- FR-19: A porta pública deve aceitar CORS só das origens permitidas da chave, com limite de taxa por chave e por IP.
- FR-20: O `idtrack` deve ser um UUID de contato; qualquer outro valor deve ser descartado sem efeito e sem resposta reveladora.
- FR-21: Evento do navegador com destino de ganho só fecha o pedido se houver evento de estado anterior no pedido; toda entrada da porta pública é marcada `origem: navegador`.
- FR-22: O cancelamento não deve existir na porta pública.
- FR-23: O script deve enfileirar em lote, manter o `event_id` até a confirmação, não reenviar `recusado` e falhar em silêncio sem quebrar a página.
- FR-24: O script deve permitir não guardar nada no navegador e optar por sair.

**Etapa 3**
- FR-25: O webhook de entrada deve poder converter um campo do envio em `value_cents`, com unidade configurada.
- FR-26: O webhook de entrada deve poder guardar o conteúdo aninhado do envio como JSON numa chave configurada de `custom_fields`, respeitando um limite de tamanho.
- FR-27: Os relatórios devem separar as origens `whatsapp` e `webhook` nas métricas de conversão.

## Non-Goals (Out of Scope)

- Evento de cancelamento ou perda pelo navegador, ou etapa de perda como destino de evento.
- Link assinado para identificar o cliente (fica para uma v2 se as travas não bastarem).
- "Aplicar modelo" ou qualquer evento semeado com o funil; o cadastro é sempre à mão.
- Observação automática de itens por atributos HTML e leitura do `dataLayer` do GA4 no script.
- Tabela de visitante anônimo: evento sem `idtrack` válido é descartado.
- Login do cardápio por telefone dentro do script (isso segue pelo servidor com `crm_get_contact`).
- Mostrar o nome do evento no lugar de "Registro de uma integração" na timeline.
- Teto máximo para o valor da venda (decisão do dono).
- Alterar o comportamento de `crm_add_lead_events` ou de `crm_move_lead_stage`.
- Aplicar o campo `stage` do JSON do webhook na criação do card (hoje só vale a etapa padrão da fonte).
- Eventos por perfil de usuário e permissões por evento.
- Reproduzir qualquer código ou nomenclatura proprietária de SDK de outras empresas.

## Design Considerations

- A tela reaproveita o padrão visual e a estrutura de "Para onde o card vai em cada passo" (`app/app/settings/tenant/pipelines/_mapping.tsx`), e a rota segue o desenho de `agent-mapping`.
- Textos sem jargão: o gerente vê "guardar o último pedido em", "campo do valor", e não nomes técnicos.
- O gate de vocabulário leigo do catálogo MCP vale para os rótulos das ferramentas.
- Sinais de uso por evento ("visto pela última vez", contagem de 7 dias) são o laço de retorno da feature.

## Technical Considerations

- Migrations em tripla (arquivo, apêndice idempotente no `baseline.sql`, `-- manifest:`); o número vem de `pnpm checar:colisao-de-migration`. O `baseline.sql` tem a mesma função várias vezes: a última definição é a que vale.
- RLS por organização em todas as tabelas novas; filtro de `organization_id` explícito onde o service role é usado.
- Reuso: `buildLeadActivityRow`, `registrarEventosDoNegocio`, `moveLeadHandler`, `updateLeadHandler`.
- O histórico (`crm_lead_activities`) é a fonte de verdade; `custom_fields` e `value_cents` são projeção (ADR-0008).
- O teto de 30 escritas por minuto por token conta uma escrita por chamada, qualquer que seja o lote.
- Verificações de repositório: `pnpm test:unit` conferido pelo rodapé, `pnpm test:db` para toda mudança de schema, `pnpm test:e2e` para telas, `pnpm test:shell` não se aplica.
- A recusa de validação não vai para o Sentry; só erro inesperado.
- Push e PR estão fora deste PRD: o trabalho fica na `main` local até decisão do dono.

## Success Metrics

- Um cardápio de terceiro integra com um script e o cadastro de eventos, sem conhecer id de etapa nem manter tabela de níveis.
- Um pedido típico gasta uma chamada por lote em vez de cerca de 9 escritas.
- Reenviar qualquer lote não altera pedido, estado, valor nem etapa (provado por teste de reenvio em cada etapa).
- Zero vazamento entre organizações nos invariantes de banco.
- Toda venda fechada por evento com campo do valor chega ao CRM com `value_cents` positivo.
- `pnpm test:unit` e `pnpm test:db` verdes pelo rodapé, e as provas pela tela anexadas ao PR.

## Open Questions

1. **Sem teto de valor.** Um erro de unidade (centavos mandados como reais) multiplicaria a receita por 100 sem nenhuma recusa. A decisão do dono foi não ter teto. Vale um aviso na tela quando o valor de uma venda estiver muito acima da média da loja, só como sinal?
2. **Nome e caminho** da porta pública e do arquivo estático do script.
3. **A chave pública** é guardada em texto ou em hash? Como é um identificador não secreto, texto parece suficiente, mas confirmar.
4. **Consentimento:** o script guarda o `idtrack` na sessão do navegador. O texto de aviso para o dono do cardápio usar deve ser revisado por quem cuida da LGPD do produto.
5. **Compra duplicada** quando o mesmo pedido chegar pelo rastreador e pelo webhook: a regra de reaproveitar card aberto cobre, mas não foi provada para esta combinação.
6. **`stage` do JSON do webhook:** hoje só a etapa padrão da fonte vale, e ela vale para todo envio. Quando a plataforma enviar mais de um aviso por pedido, cada um leva o card para a mesma etapa. Fica fora deste PRD, mas pode exigir uma fonte por tipo de aviso.
7. **Retenção:** apagada a atividade, o mesmo `event_id` volta a ser aceito. Documentar e aceitar?
8. **Ordem de execução entre etapas:** a etapa 2 pode começar assim que a US-011 passar, ou só depois da US-017? A proposta é só depois.
