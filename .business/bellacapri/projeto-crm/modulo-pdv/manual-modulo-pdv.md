# Manual do módulo PDV (balcão e telefone) — fases 1 e 2

Versão: 1.0 · Data: 2026-11-17 · Branch: `ralph/modulo-pdv-fases-1-e-2` (local, sem push)

Este manual tem **quatro partes**, para quatro leitores:

1. [Ligar o módulo](#1-ligar-o-módulo) — dono da instalação / admin da plataforma
2. [Usar no dia a dia](#2-usar-no-dia-a-dia) — gerente (lojas) e atendente (clientes)
3. [Verificar o que foi entregue](#3-verificar-o-que-foi-entregue) — quem valida a branch
4. [Homologar contra o ERP real](#4-homologar-contra-o-erp-real) — o que falta e é seu

> **Estado honesto.** Nada foi provado contra o ERP real. Tudo o que está marcado como
> "PASS" abaixo foi provado com respostas do ERP **simuladas** (fixtures e rota interceptada).
> A parte 4 é o caminho para trocar a simulação pelo ERP de verdade.

---

## O que o módulo faz (e não faz)

**Faz:**
- Cadastra as **lojas** do ERP que a organização atende e as liga a uma conexão de WhatsApp.
- **Identifica o cliente** por telefone, nome ou CPF, lendo o ERP.
- Mostra a **ficha** do cliente (dados pessoais e endereços), somente leitura.

**Ainda não faz:** editar endereço, cadastrar cliente, fazer pedido, assistente de IA.

**Princípio:** o ERP é a fonte do cliente. O CRM não grava nome, CPF nem endereço do ERP.
Guarda só o vínculo (id do cliente no ERP ↔ contato do CRM).

**Papéis:**

| Quem | Pode |
|---|---|
| Admin da plataforma | instalar o módulo; cadastrar endereço e chave do ERP |
| Gerente (`manager`) ou acima | tela **Lojas** |
| Atendente (`agent`) ou acima | tela **Identificar cliente** |
| Viewer | nenhuma das duas |

---

## 1. Ligar o módulo

O módulo vem **desligado**. Enquanto não for instalado, as rotas `/api/v1/pdv/*` e as duas
telas respondem **404** e nenhuma tabela do PDV existe.

### 1.1 Instalar

1. Entre como admin da plataforma.
2. Abra **`/admin/modulos`**.
3. No cartão **"PDV (balcão e telefone)"**, clique em instalar.
4. O cartão passa a **"Instalado"** e o botão some. Reinstalar não duplica nada.

Isso executa `fn_pdv_provisionar()`, que cria `pdv_stores` e `pdv_customer_links`, já com RLS
por organização.

### 1.2 Apontar para o ERP (por organização)

O PDV **não tem configuração própria de ERP**: reaproveita o *Servidor MCP externo*.

1. Entre como **admin da plataforma** na organização desejada.
2. Abra **`/app/settings/servidor-mcp-externo`**.
3. Preencha **Endereço do servidor MCP** e **Chave de acesso** e clique **Salvar**.

Regras do endereço (a tela recusa o que não cumprir):
- precisa ser **HTTPS público**;
- sem usuário, senha, querystring nem fragmento;
- `localhost`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x` e IPv6 literal são recusados.

A homologação do ERP está em rede local HTTP, então use o **túnel HTTPS** (parte 4).
Quem não é admin da plataforma **não vê nem troca a chave**.

Repita para cada tenant: uma por unidade operacional e a do Call Center.

> **Sem endereço ou sem chave:** o PDV responde `erp_nao_configurado` (409) **antes de abrir
> qualquer rede**, e as telas orientam a procurar o dono da instalação.

---

## 2. Usar no dia a dia

### 2.1 Cadastrar as lojas (gerente)

**Onde:** Configurações › Sua empresa › **Lojas** — `/app/settings/tenant/lojas`.

**Adicionar do ERP**
1. Clique **"Adicionar lojas do ERP"**.
2. O modal lista as lojas do ERP. As já adicionadas aparecem marcadas e desabilitadas
   ("Já adicionada").
3. Marque as desejadas e confirme. O toast mostra **"Lojas adicionadas"**.
4. Código, sigla e nome vêm do ERP; você não digita nada.

**Ativar/desativar e vincular o WhatsApp**
1. Na linha da loja, mude o **interruptor de ativa** e/ou o **seletor de conexão**
   ("Sem conexão" ou uma conexão do tenant).
2. Aparecem **Salvar** e **Cancelar** só quando há mudança. Nada grava antes do Salvar.
3. Toast **"Loja atualizada"**. Se falhar, o rascunho fica e a linha mostra
   "Não foi possível salvar. Tente de novo."
4. Loja inativa fica esmaecida com o selo **"Inativa"**.

**Estados que você pode ver:** carregando, vazio, lista, erro do ERP ("Tentar de novo") e
ERP não configurado.

### 2.2 Identificar o cliente (atendente)

**Onde:** CRM › **Identificar cliente** — `/app/pdv/clientes` (também pelo hub do CRM).

1. Escolha **Telefone**, **Nome** ou **CPF** (padrão: Telefone).
2. Digite o termo (a máscara é automática) e clique **Buscar** ou aperte Enter.
3. Validações antes de chamar o ERP:
   - vazio → "Digite algo para buscar";
   - telefone com menos de 10 dígitos → "Informe o telefone com DDD";
   - CPF sem dígito verificador válido → "CPF inválido".
4. A lista mostra **nome e endereço principal** ("Sem endereço cadastrado" quando não há).
   Se houver mais do que o limite, aparece o aviso de que o resultado foi truncado.
5. **Nenhum cliente** não é erro: mostra o estado "nenhum cliente".
6. Erro do ERP mostra **"Tentar de novo"** e repete a mesma busca.

O termo buscado **não vai** para a URL do navegador, storage, log, Sentry nem auditoria.
Limite: 60 buscas por minuto por usuário (429 com `Retry-After`).

### 2.3 Ver a ficha

Ao abrir um cliente da lista:
- **Dados pessoais:** nome, telefone, e-mail, CPF **mascarado**, data de nascimento;
  campo ausente aparece como "Não informado".
- **Endereços:** selo **"Principal"**, **"Loja de entrega"** ou
  "Loja de entrega ainda não definida"; lista vazia tem estado próprio.
- Nenhum botão de editar (não existe nesta fase).

Abrir a ficha **cria ou reaproveita o contato espelho** no CRM e o vincula ao cliente do ERP.
Dois atendentes abrindo o mesmo cliente ao mesmo tempo geram **um** contato e **um** vínculo.
Se dois clientes do ERP colidirem no mesmo telefone/CPF, a tela mostra orientação (409) e
**nunca funde** em silêncio.

### 2.4 Mensagens de erro e o que fazer

| O que aparece | Causa | Ação |
|---|---|---|
| Tela 404 | módulo não instalado | admin da plataforma instala em `/admin/modulos` |
| "ERP não configurado" / orientação para o dono da instalação | sem endereço ou chave | admin da plataforma cadastra (1.2) |
| ERP indisponível (502) | ERP fora do ar ou túnel caído | tentar de novo; avisar o responsável pelo ERP |
| Tempo esgotado (504) | ERP não respondeu em 15 s | tentar de novo |
| Termo inválido (422) | formato de busca rejeitado | corrigir telefone/CPF/nome (mín. 2 letras) |
| Cliente não encontrado (404) | id inexistente no ERP | refazer a busca |
| 429 | mais de 60 buscas/min | aguardar o `Retry-After` |

---

## 3. Verificar o que foi entregue

Do mais barato ao mais completo. **Nenhuma etapa desta parte usa o ERP real.**

### 3.1 Ler o que mudou
```bash
git log --oneline d031d374a..HEAD        # 38 commits
git diff --stat d031d374a..HEAD          # 132 arquivos, ~7 mil linhas
```
Documentos: `docs/features/modulo-pdv.md` (o que existe no código) e a seção **J60** de
`docs/testing/user-journey-map.md` (10 casos).

### 3.2 Ver as telas sem rodar nada
`evidence/modulo-pdv/` tem os screenshots por história. Cada `US-0NN.md` diz o que cada
imagem prova (estados, medidas de alvo ≥ 44 px). Foram capturados com a rota do ERP
**interceptada**.

### 3.3 Qualidade, no terminal
```bash
pnpm typecheck
pnpm lint
pnpm test:unit > /tmp/vt.log 2>&1; echo exit=$?
grep -aE "Test Files|Tests |Errors " /tmp/vt.log
```
**Esperado:** exit 1 com **23 falhas em 6 arquivos que já eram vermelhos antes da branch**:
`e2e-apt-troca-espelho` (12), `e2e-preparo-tenta-de-novo` (2), `rate-limit` (5), `janela-24h` (1),
`permissao-lida` (1), `roteador-grava-o-roteiro` (2). Qualquer falha **fora** dessa lista é
regressão desta branch. Não use `tail` na saída: o rodapé é a autoridade.

### 3.4 Banco e isolamento entre tenants (precisa de Docker)
```bash
pnpm test:db tests/invariants/pdv-provisionadora.test.ts
pnpm test:db tests/invariants/pdv-instalar-modulo.test.ts
pnpm test:db tests/invariants/pdv-contato-espelho-unicidade.test.ts
```
Provam: provisionadora cria as tabelas com RLS; módulo desligado por padrão; reinstalar não
duplica; unicidade do contato espelho com duas sessões concorrentes.

### 3.5 Ver na tela com as specs (recomendado)

**Não use a sua stack atual:** ela roda a imagem anterior e não tem o módulo. Use um worktree
isolado, como os agentes fizeram (Supabase em portas 57321–57324, app na 3100):

```bash
# 1. worktree
git worktree add --detach ../deskcomm-e2e-pdv HEAD
cd ../deskcomm-e2e-pdv && pnpm install --frozen-lockfile

# 2. em supabase/config.toml: project_id = "e2e-pdv";
#    portas 5432x -> 5732x:  sed -i 's/543\(2[0-4]\|29\)/573\1/g' supabase/config.toml
#    e trocar [local_smtp] por [inbucket] (a CLI 2.107 rejeita local_smtp)

# 3. subir o Supabase sem as migrations (usa o baseline)
mv supabase/migrations /tmp/migrations-pdv && mkdir supabase/migrations
supabase start -x studio,imgproxy,vector,logflare,edge-runtime
#    aplicar as 5 `create extension` da receita e depois supabase/baseline.sql:
#    docker exec -i supabase_db_e2e-pdv psql -U postgres -v ON_ERROR_STOP=1 < supabase/baseline.sql
docker restart supabase_realtime_e2e-pdv
rm -rf supabase/migrations && mv /tmp/migrations-pdv supabase/migrations

# 4. build e credenciais
export E2E_PORT=3100 MAILPIT_URL=http://127.0.0.1:57324
pnpm e2e:env && pnpm e2e:build        # o 1º build pode abortar com um aviso do Next: repita o mesmo comando
cp .env.e2e .env.local && pnpm exec tsx scripts/seed-e2e-credentials.ts

# 5. rodar
pnpm exec playwright test \
  tests/e2e/pdv-instalar-modulo.spec.ts \
  tests/e2e/pdv-aba-lojas-lista.spec.ts \
  tests/e2e/pdv-aba-lojas-adicionar.spec.ts \
  tests/e2e/pdv-aba-lojas-editar.spec.ts \
  tests/e2e/pdv-identificar-cliente.spec.ts \
  tests/e2e/pdv-identificar-cliente-estados.spec.ts \
  tests/e2e/pdv-ficha-cliente-dados.spec.ts \
  tests/e2e/pdv-ficha-cliente-enderecos.spec.ts --reporter=list

# 6. limpar (SEMPRE de dentro do worktree)
supabase stop --no-backup
cd - && git worktree remove --force ../deskcomm-e2e-pdv
```

**Cuidados:**
- O aviso de segurança do `pnpm e2e:build` sugere `next upgrade`. **Não execute**: repita o
  `build`. (Next 16.4.2 está sinalizado; atualizar é decisão sua, fora desta entrega.)
- Se o build reclamar "bundle contém o host de produção", apague `.env.local` do worktree e
  refaça. O `cp .env.e2e .env.local` só vem **depois** do build.
- Nunca rode `supabase stop` no checkout principal: derruba a sua stack.
- O detalhe completo da receita está em `progress.txt`, seção *Codebase Patterns*.

### 3.6 Checklist de aceite manual (10 min, com o worktree acima no ar)

| # | Ação | Resultado esperado |
|---|---|---|
| 1 | `/admin/modulos` → instalar PDV | cartão "Instalado", botão some |
| 2 | Sem ERP cadastrado, abrir `/app/settings/tenant/lojas` | orientação para o dono da instalação; sem botão de repetir; sem endereço/chave na tela |
| 3 | Idem em `/app/pdv/clientes` | mesma orientação |
| 4 | Antes de instalar (outro tenant/ambiente) abrir `/app/pdv/clientes` | 404 |
| 5 | Buscar telefone com 8 dígitos | "Informe o telefone com DDD", sem chamada de rede |
| 6 | Buscar CPF `111.111.111-11` | "CPF inválido" |
| 7 | Buscar e olhar a URL e o storage do navegador | o termo não aparece |

Os itens 2–7 também são cobertos pelas specs. O item 4 (404 de **tela**) é um dos casos
declarados **não provados no browser**.

---

## 4. Homologar contra o ERP real

Pendências **suas**, em ordem:

1. **Enviar o handoff E0** à sessão do ERP:
   `.business/bellacapri/projeto-crm/handoff-erp/E0-homologacao-e-listar-lojas.md`
   (e depois o E1, `buscar_cliente` e `obter_cliente`). O servidor do ERP escuta HTTP na rede
   local, **sem TLS**, e precisa funcionar atrás de proxy reverso. Só dados **fictícios**:
   a homologação ficará acessível pela internet.
2. **Criar o túnel HTTPS** que publica o ERP num nome público. O handoff E0, item 9, define o
   teste: de fora da rede, com chave funciona; sem chave é recusado; nenhuma outra rota do ERP
   responde.
3. **Cadastrar o ERP** nos 3 tenants (1.2): endereço do túnel + chave.
4. **Rodar as 6 specs de homologação** (escritas, nunca executadas), no mesmo worktree da 3.5:
   ```bash
   PDV_HOMOLOGACAO=1 PDV_HOMOLOGACAO_NOME="<parte do nome de um cliente da homologação>" \
   pnpm exec playwright test \
     tests/e2e/pdv-aba-lojas-lista-homologacao.spec.ts \
     tests/e2e/pdv-aba-lojas-adicionar-homologacao.spec.ts \
     tests/e2e/pdv-aba-lojas-editar-homologacao.spec.ts \
     tests/e2e/pdv-identificar-cliente-homologacao.spec.ts \
     tests/e2e/pdv-ficha-cliente-dados-homologacao.spec.ts \
     tests/e2e/pdv-ficha-cliente-enderecos-homologacao.spec.ts --reporter=list
   ```
   Sem `PDV_HOMOLOGACAO=1` elas se **pulam** (não reprovam). Cada uma lê no cabeçalho as
   variáveis extras que precisa. Os seletores delas **nunca rodaram**: se alguma falhar,
   desconfie primeiro da spec, não só do módulo.
5. Guarde os screenshots (`us-007-homologacao.png` etc.) em `evidence/modulo-pdv/` e
   atualize a coluna "com ERP real" da seção J60.

**Premissas do contrato a confirmar com o ERP** (`contrato-mcp-erp-formatos.md`): cliente com
vários endereços e um principal; id estável de cliente e de endereço; tolerância ao 9º dígito
do celular na busca por telefone.

---

## 5. Decisões para você revisar

Foram tomadas pelos agentes e não vêm do contrato:

- **Status HTTP:** `erp_nao_configurado` 409; ERP fora do ar 502 e tempo esgotado 504 (ambos
  `erp_indisponivel`); `termo_invalido` 422; cliente inexistente 404; contato ambíguo 409.
- **LGPD do vínculo:** `pdv_customer_links` guarda só ids opacos e ficou fora de
  `modulo_secoes_lgpd` (allowlist com motivo). Anonimizar o contato deixa o vínculo apontando
  para contato anônimo; o apagamento do cliente se cumpre no ERP.
- **Sem auditoria de visualização da ficha** (`pdv.customer.viewed` segue como hipótese).
  A rota leva `requireSupportWrite(` porque o vínculo é uma escrita dentro de um GET.
- **`tests/unit/branding.test.ts`:** o regex de host foi ajustado (a ação `pdv.store.updated`
  era lida como host), com 2 casos de controle.
- **Telas sem item no menu lateral:** são portas do catálogo, alcançadas por Configurações e
  pelo hub do CRM.

## 6. Pendências menores

- Colisão dos números de migration 9044 e 9045 com PRs abertos **não foi medida** (sem `gh` na
  máquina). Rode `pnpm checar:colisao-de-migration` onde houver `gh`.
- `[local_smtp]` no `config.toml` é rejeitado pela CLI do Supabase 2.107 (por isso o worktree
  troca por `[inbucket]`).
- O mapa de telas da skill `deskcomm-operacao` não foi atualizado.
- Não cobertos: papel `viewer` no browser; 404 de módulo desligado **na tela**; limite de taxa
  com Redis real.
- Push e PR: nada foi enviado. A branch tem 38 commits locais.
