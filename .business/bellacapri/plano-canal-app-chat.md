# Plano — canal `app_chat` (app de chat próprio ↔ DeskcommCRM)

> **Status:** plano, nada implementado. **Destino:** somente o fork (não vai ao upstream).
> **Destino pela doutrina (item 18 do CLAUDE.md):** núcleo, desligado por padrão. Razão: se nenhuma
> organização ativar o canal, a operação comum continua inteira; mas a extensão declarativa hoje não
> cria canal nem rota, então não cabe como extensão.

## 1. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Identidade do usuário do app | e-mail **ou** telefone; sempre um `external_id` estável do app |
| Direção | app → CRM (webhook de entrada assinado) **e** CRM → app (entrega de saída assinada) |
| Conteúdo v1 | texto + emoji. Sem mídia, sem grupos, sem templates |
| Distribuição | só o fork. Ver §8 sobre colisão de migration em merges futuros do upstream |

## 2. O que foi lido (e o que não foi)

Lido e confirmado no código:

- `lib/channels/types.ts` — `ChannelProvider` é união fechada (`waha | meta_cloud | zernio | zernio_social | wacalls | datafy`); `ProviderDeMensagem` exclui `wacalls`; contrato `ChannelAdapter` (`resolveRecipient`, `isConfigured`, `send`, `codes`); `OutboundEnvelope` (traz `providerConversationId` e `replyToExternalId`).
- `lib/channels/capabilities.ts` — `CHANNEL_CAPABILITIES: Record<ProviderDeMensagem, ChannelCapabilities>`: provider novo **sem linha não compila**.
- `lib/channels/session-ref.ts` — `ChannelSessionRef` é uma união etiquetada que espelha `channel_sessions_provider_ref_check` (migration 0087): **cada provider tem a sua coluna de ref**, NOT NULL para o provider da vez e NULL para os outros. `CHANNEL_SESSION_REF_COLUMNS` lista as colunas.
- `lib/channels/social/porta.ts` — `channel_sessions_provider_check` no baseline hoje aceita `waha, meta_cloud, zernio, wacalls, zernio_social, datafy`.
- `lib/channels/adapters/datafy.ts` — adapter "burro" de 191 linhas; é o precedente de tamanho, mas é a Cloud API com outro host, com identidade por telefone.

**Não lido ainda — vira a Fase 0, antes de qualquer código:**

- como o contato é criado sem telefone (`contacts`, `lib/channels/contato-por-telefone.ts`, `wa_identity`, `phone_numbers`) e se aceita contato só com e-mail;
- `lib/channels/inbound.ts` e `lib/channels/social/ingest.ts` — o caminho de ingestão a imitar;
- `lib/channels/index.ts` (`getAdapter`) e `app/api/v1/messages/_handler.ts` — por onde o envio escolhe o adapter;
- a cadeia `before_send` e como ela consulta capabilities;
- `scripts/lint-channels.ts` e `scripts/lint-channels.pattern.ts` — o que o lint reconhece como "nome de provider";
- `tests/unit/channel-capability-matrix.test.ts` e `tests/unit/canal-datafy-desligado-por-padrao.test.ts` — as cercas que o canal novo precisa satisfazer;
- a tela de Conexões e `lib/navigation/catalogo.ts`.

## 3. Desenho

```
[App de chat] ──POST assinado──▶ /api/v1/webhooks/app-chat   (entrada)
      ▲                                   │ resolve org pelo segredo do canal
      │                                   ▼
      └──────POST assinado◀── adapter.send  ◀── Inbox / agente de IA / automação
              (saída)
```

### 3.1 Identidade e contato

- O payload de entrada sempre traz `external_user_id` (obrigatório) e, opcionalmente, `email` e `phone`.
- Casamento de contato, nesta ordem: (1) mesmo `external_user_id` já visto neste canal; (2) telefone normalizado E.164, reaproveitando o contato do WhatsApp se existir; (3) e-mail; (4) cria contato novo.
- **A definir na Fase 0:** onde guardar o `external_user_id` (coluna própria vs. tabela de vínculo do contato com o canal) pela doutrina DIRC; **não** usar `jsonb` lido por path direto (anti-pattern 6).
- Sem telefone, `resolveRecipient` devolve o `external_user_id` como endereço. A "ausência de telefone" é o caso normal deste canal, não erro.

### 3.2 Entrada (app → CRM)

- Rota `app/api/v1/webhooks/app-chat/route.ts`, com a entrada correspondente em `lib/auth/public-paths.ts` (público para o proxy, nunca "sem autenticação").
- Assinatura HMAC SHA-256 no header, `crypto.timingSafeEqual`, com timestamp dentro do corpo assinado e recusa de repetição fora da janela. Segredo **por sessão de canal**, guardado como hash/criptografado, mostrado uma vez.
- A organização sai da linha do canal resolvida pelo segredo/path-token, **nunca do body**.
- Idempotência: `unique (organization_id, external_id)` + captura de `23505`. `external_id` é o id da mensagem no app.
- Zod em todo o payload. Rate limit (rota pública, DoD 6). `X-Request-Id` na resposta. Envelope `ok()`/`fail()`.
- Ingestão reaproveita o caminho comum de mensagens recebidas (conversa, mensagem, evento `message.received`, Realtime), não um caminho paralelo.

### 3.3 Saída (CRM → app)

- `adapters/app-chat.ts`: `send` faz `POST` assinado para a URL de entrega configurada no canal, com `Idempotency-Key` = id da mensagem do CRM. Texto e emoji apenas; `kind` diferente de `text` desiste com código explícito (`appChat_kindUnsupported`), não finge enviar.
- `isConfigured()` e `codes` seguem o padrão do Datafy (`notConfigured` faz o handler gravar `queued` com motivo).
- **SSRF:** a URL de entrega é dado do usuário. Passar pelo mesmo egress anti-SSRF que o webhook de saída das automações usa (`lib/automation/actions/call-webhook.ts`). Verificar na Fase 0 qual helper reaproveitar; não escrever um segundo.
- Falha de entrega → retry pela mesma cadeia do restante (`recover-stuck-messages` já cobre `sending` > 5 min e abre aviso na Central).

### 3.4 Capabilities (restrição de canal)

```ts
app_chat: {
  freeformOutsideWindow: true,   // sem janela de 24h
  requiresTemplates: false,
  canManageTemplates: false,
  banRisk: false,                // sem throttle/warm-up/cap de anti-ban
  minIntervalMs: null,
  voiceNote: "server-convert",   // irrelevante na v1 (sem mídia); preencher por exigência do tipo
  groups: "none",
  costPerMessage: false,
  alteraMensagemEnviada: false,
  phonebook: false,
}
```

- Cortesia continua valendo (invariante 3): horário/fuso da organização não é desarmado por `banRisk: false`. **Decidir na Fase 0** se mensagem de chat "ao vivo" respeita a janela de disparo 7h–22h; para chat iniciado pelo usuário a resposta provavelmente é "janela de RESPOSTA do canal" (`channel_knobs.resposta_*`).
- Nenhuma feature nomeia `app_chat`: só `lib/channels/` (lint de canal).

## 4. Banco — tripla de migration (item 6 da doutrina)

1. **Migration** `supabase/migrations/<timestamp>_<NNNN>_canal_app_chat.sql` com `-- manifest: ...` no cabeçalho:
   - alarga `channel_sessions_provider_check` para incluir `'app_chat'`;
   - nova coluna de ref `app_chat_account_id text` (ou a decisão equivalente da Fase 0) e atualização de `channel_sessions_provider_ref_check` (união etiquetada, 0087);
   - colunas/tabela de configuração do canal: URL de entrega, segredo de entrada (hash), interruptor por organização;
   - vínculo `contato ↔ external_user_id` do canal, com `organization_id not null references organizations(id) on delete cascade`, **RLS `tenant_isolation_<tabela>_all` via `fn_user_org_ids()`** e `unique (organization_id, <canal>, external_user_id)`.
2. **Apêndice idempotente no `supabase/baseline.sql`** (bloco rotulado `-- ---- canal app_chat (migration NNNN) ----`): `add column if not exists`, `drop constraint if exists` + `add constraint`, `create table if not exists`, políticas com `drop policy if exists`.
3. **Função nova em `public`:** se houver `create function`, terminar com `revoke execute ... from public, anon;` + `grant` só a quem precisa (item 9).
4. `lib/database.types.ts` regenerado. Vocabulário novo em `CHECK` casa com o TypeScript (`tests/invariants/vocabulario-banco-x-typescript.test.ts`).
5. Número: rodar `pnpm checar:colisao-de-migration` com a migration criada com número provisório.

## 5. Código — arquivos a tocar

| Arquivo | Mudança |
|---|---|
| `lib/channels/types.ts` | `"app_chat"` em `ChannelProvider` |
| `lib/channels/capabilities.ts` | linha `app_chat` (§3.4) |
| `lib/channels/session-ref.ts` | ramo da união + coluna em `CHANNEL_SESSION_REF_COLUMNS` + `case` em `resolveSessionRef` |
| `lib/channels/adapters/app-chat.ts` | **novo** — adapter |
| `lib/channels/index.ts` | registrar o adapter em `getAdapter` |
| `lib/channels/app-chat/` | **novo** — assinatura, ingestão, casamento de contato, credenciais, interruptor |
| `app/api/v1/webhooks/app-chat/route.ts` | **novo** — entrada |
| `lib/auth/public-paths.ts` | caminho da entrada |
| `lib/env.ts` + `.env.example` | interruptor `APP_CHAT_ENABLED` (default **desligado**, não quebra `.env` antigo) |
| Tela de Conexões + `lib/navigation/catalogo.ts` | cadastro do canal (URL de entrega, mostrar segredo uma vez, ligar/desligar) |
| `docs/integracao/app-chat.md` | **novo** — contrato público do webhook nos dois sentidos, com vetor de teste de assinatura (no estilo de `webhooks-de-saida.md`) |
| `docs/architecture/app-chat.architecture.json` | mapa vivo com ≥ 2 arestas (item 13) |

## 6. Fases e provas

**Fase 0 — leitura e fechamento das lacunas (sem código).** Resolver tudo o que §2 lista como "não lido" e as três decisões marcadas "a definir". Saída: seção §9 deste arquivo atualizada.

**Fase 1 — fundação (provider, banco, adapter vazio).**
Tipo, capability, session-ref, migration + baseline, adapter com `send` real e `isConfigured`.
Prova: `pnpm typecheck`, `pnpm lint`, `pnpm lint:channels`, `pnpm test:unit` (matriz de capabilities exaustiva), `pnpm test:db` (baseline em install e update, RLS entre 2 organizações).

**Fase 2 — entrada.**
Rota, assinatura, idempotência, casamento de contato (telefone, e-mail, id), ingestão pelo caminho comum.
Prova: testes unitários dos três casamentos e da repetição (mesmo `external_id` duas vezes → uma linha); invariante de isolamento (org A não vê contato/mensagem da org B); teste do vetor de assinatura.

**Fase 3 — saída.**
Entrega assinada, SSRF, retry.
Prova: **receiver HTTP real** subido no teste (doutrina de QA visual: mock não estressa o egress) — confere corpo, assinatura, `Idempotency-Key`, recusa de URL interna.

**Fase 4 — tela e prova de ponta a ponta.**
Cadastro do canal, aparição no Inbox, resposta do atendente chegando ao app.
Prova (DoD 12): Playwright dirigindo a tela, banco fresco do `baseline.sql` + `scripts/bootstrap-owner.ts`, envs opcionais ausentes, evidência em `evidence/app-chat/`; spec em `tests/e2e/` e linha no `docs/testing/user-journey-map.md`. Se o caminho passar por agente de IA, medir o **par** (`docs/doctrine/prova-em-par.md`).

**Fase 5 — documentação.** `docs/integracao/app-chat.md`, mapa de arquitetura, `docs/current-state.md` se afirmar o estado do canal.

## 7. Definition of Done (do CLAUDE.md) aplicável

typecheck e lint zerados · testes unit/db/e2e relevantes · RLS provada · audit log nas mutações (`api_audit_log`) · rate limit na rota pública · Zod no input externo · sem `console.log` · env nova em `.env.example` + `lib/env.ts` · migration + baseline + `-- manifest:` · prova pela tela · Living System Checklist (entrada, saída, log, tela, porta na navegação, laço de retorno) · tela nova com porta em `catalogo.ts`. Fragmento em `.changes/` (item 17): opcional enquanto for só do fork; obrigatório se um dia for ao upstream.

## 8. Riscos

- **Colisão de migration em merge do upstream.** Ninguém reserva número; o upstream pode tomar o mesmo `NNNN`/timestamp. Mitigação: rodar `pnpm checar:colisao-de-migration` ao criar e de novo a cada merge da `main` do upstream; renumerar antes de mesclar, nunca depois de aplicada em algum banco.
- **Contato sem telefone** pode esbarrar em suposições do núcleo (campanhas, STOP, WhatsApp). Mapear na Fase 0 quais telas e fluxos assumem telefone e garantir que o contato do app nunca entre em campanha de WhatsApp.
- **URL de entrega = SSRF.** Tratar como o webhook de saída existente.
- **Cercas de CI** (`lint:channels`, matriz de capabilities, vocabulário banco×TS) reprovam em cascata ao adicionar provider; prever tempo para ajustar listas de teste.
- **`gov:verify` não cobre `test:db` nem `test:e2e`**: verde ali não prova schema nem UI (`docs/harness-audit.md`).
- Branch: `main` do fork pode estar atrasada em relação ao upstream; antes de começar, `git fetch` + merge (doutrina de higiene de branches). Árvore tinha `AGENTS.md` e `supabase/config.toml` modificados no início da sessão: não são deste trabalho e não devem entrar nos commits.

## 9. Perguntas em aberto (preencher na Fase 0)

1. Onde mora o `external_user_id` do contato (coluna vs. tabela de vínculo)?
2. Contato só com e-mail é suportado hoje? O que quebra?
3. Mensagem de chat ao vivo obedece à janela de disparo ou à de resposta?
4. Qual helper de egress anti-SSRF reaproveitar na saída?
5. Um canal por organização ou vários (um por app)? `channel_sessions` já é "uma linha por organização" para alguns providers; conferir.
6. O app precisa de leitura de histórico (ex.: `GET` de mensagens do CRM) além do push? Se sim, isso exige token `dsk_` e converter rota(s) para `auth-dual` + `public-paths.ts`.
