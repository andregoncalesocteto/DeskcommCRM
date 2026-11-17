# Módulo PDV (balcão e telefone) — fases 1 e 2

Módulo **opcional**, instalado pela instalação em `/admin/modulos` e **desligado por
padrão**. Entrega a base do atendimento de venda por balcão e telefone: as lojas do ERP
que a organização atende e a identificação do cliente, com a ficha. Os documentos de
origem (PRD, Design Doc e ADRs 001 a 006) estão em
`.business/bellacapri/projeto-crm/modulo-pdv/`; este arquivo descreve **o que existe no
código**, não o que foi planejado.

## O que existe

| Peça | Onde |
|---|---|
| Slug `pdv` no catálogo de módulos de tabela; sem chave em `platform_config`, desligado enquanto não houver `modulos_instalados.estado = 'ativo'` | `lib/instalacao/modulos.ts`, `lib/modulos/catalogo.ts` |
| Provisionadora `public.fn_pdv_provisionar()` (instalar o módulo cria as tabelas; RLS por `fn_user_org_ids()`) | `supabase/migrations/*_9044_*`, `*_9045_*` e apêndice do `supabase/baseline.sql` |
| `pdv_stores` (loja do ERP: código, sigla, nome, ativa, conexão de WhatsApp opcional) | provisionadora |
| `pdv_customer_links` (só ids opacos: contato do CRM, id do cliente no ERP, data do vínculo) | provisionadora |
| Cliente do ERP: `listarLojas`, `buscarCliente`, `obterCliente`, leitura validada por Zod | `lib/pdv/erp/` |
| Contato espelho: acha ou cria o contato do CRM para um cliente do ERP, sem duplicar sob concorrência | `lib/pdv/contato-espelho.ts` |
| API: `GET/POST /api/v1/pdv/lojas`, `PATCH /api/v1/pdv/lojas/{id}`, `GET /api/v1/pdv/lojas/erp`, `GET /api/v1/pdv/clientes`, `GET /api/v1/pdv/clientes/{erp_id}` | `app/api/v1/pdv/` |
| Tela **Configurações › Sua empresa › Lojas** (`/app/settings/tenant/lojas`, gerente): lista, adicionar do ERP, ativar/desativar, vincular conexão | `app/app/settings/tenant/lojas/` |
| Tela **CRM › Identificar cliente** (`/app/pdv/clientes`, atendente): busca por telefone, nome ou CPF e ficha (dados pessoais e endereços) | `app/app/pdv/clientes/` |

Com o módulo desligado, a rota responde 404 e as telas, 404; nenhuma tabela do PDV existe.

## O ERP por organização

O PDV **não tem configuração própria de ERP**. Reaproveita o registro do servidor MCP
externo ([`servidor-mcp-externo.md`](servidor-mcp-externo.md)): o endereço fica em
`organizations.settings.mcp_externo`, a chave Bearer cifrada em colunas próprias da
organização, e **só o administrador da plataforma grava** (`definirServidorMcpExterno`).
Quem opera a organização não vê nem troca a chave. Sem endereço ou sem chave, o PDV
responde `erp_nao_configurado` (409) **antes de abrir qualquer rede**, e a tela orienta a
procurar o dono da instalação.

O ERP é a fonte do cliente (ADR-002): o CRM não grava nome, telefone, CPF nem endereço do
ERP em tabela do módulo. A ficha é lida a cada abertura; o que se guarda é o vínculo
`erp_customer_id` ↔ contato.

## HTTPS público é exigência

A saída passa pela proteção anti-SSRF do servidor externo: em produção o endereço precisa
ser **HTTPS e público**, sem usuário, senha, querystring nem fragmento, e hosts privados
(localhost, 10., 172.16 a 31., 192.168., 169.254., IPv6 literal e nomes que resolvam para
eles) são recusados. A homologação do ERP roda em rede local em HTTP; a decisão do dono do
projeto (2026-11-16) é usar um **túnel HTTPS**. Uma exceção controlada no CRM seria mudança
de núcleo e fica como plano B.

## O que ainda NÃO existe

- Endereços **editáveis**: a ficha só mostra o que o ERP devolve.
- **Cadastro** ou edição de cliente (decisão do ADR-002: o cadastro é do ERP).
- **Pedido** pelo PDV (carrinho, envio ao ERP pelo `event_log`, ADR-003 e ADR-006).
- **Assistente** de IA do PDV (ADR-005).
- Entrada no menu lateral: as duas telas são portas do catálogo de navegação, alcançadas por
  Configurações e pelo hub de CRM.

## Limites conhecidos

- **Prova contra o ERP real só à mão.** As histórias foram entregues sobre fixtures e
  interceptação de rota; em 2026-11-17 o dono conferiu as telas contra o ERP real, pelo túnel
  HTTPS, nos 3 tenants (relato, sem spec nem registro por caso). As specs `tests/e2e/pdv-*-homologacao.spec.ts` foram **escritas
  mas não executadas**: dependem da homologação do ERP por túnel, ficam em `FORA_DO_CI` e
  pulam sem `PDV_HOMOLOGACAO=1`. Evidência visual dos estados (com rota interceptada) em
  `evidence/modulo-pdv/`.
- **Status HTTP do ERP** são escolhas desta entrega, não do contrato: `erp_nao_configurado`
  = 409, ERP fora do ar = 502 e tempo esgotado = 504 (ambos com código `erp_indisponivel`),
  `termo_invalido` = 422, cliente inexistente = 404, contato ambíguo = 409.
- **Sem auditoria de visualização da ficha.** `GET /pdv/clientes/{id}` não grava
  `api_audit_log`; `pdv.customer.viewed` segue como hipótese em aberto. A rota leva
  `requireSupportWrite(` porque o vínculo é uma escrita dentro de um GET. O termo de busca e
  o CPF não vão a log, Sentry nem auditoria.
- **LGPD do vínculo:** `pdv_customer_links` só guarda ids opacos e fica fora de
  `modulo_secoes_lgpd` (entra na allowlist com motivo escrito). Anonimizar o contato deixa a
  ligação apontando para contato anônimo; o apagamento do cliente se cumpre no ERP. A decisão
  de retenção vale revisão do dono.
- **Next 16.4.2** é sinalizado como vulnerável no aviso de segurança do build de produção do
  e2e. Não é desta entrega corrigir.
- Sem Redis real no limite de taxa da busca (60/min por usuário): coberto só por teste com
  mock. Colisão do número de migration contra PRs abertos não foi medida (sem `gh`).

## Destino da mudança: ambos, com o núcleo mínimo

Pergunta da doutrina de extensões: *"se nenhuma organização ativar isto, a operação comum
continua inteira?"* **Sim.** Sem o módulo instalado não existe tabela, rota responde 404, e
as portas de navegação somem; identidade, autorização, isolamento, auditoria e a cadeia de
envio ficam como estavam. Por isso o domínio do PDV (lojas, ficha, ERP) é **módulo oficial
opcional**, e não núcleo.

Ele ainda **não é extensão declarativa**: tem tabelas, rotas e telas próprias, o que o
contrato de extensões v1 não permite (sem código, tabela ou tela). O caminho é o do ADR-0002
(módulo oficial com dados, tabelas por função provisionadora no schema `public`, um banco só).
O que tocou o **núcleo** foi pequeno e genérico: o slug nos catálogos de módulos, a entrada
`modulo` nas portas do `NAV_CATALOG`, os códigos de erro e a ação de auditoria
`pdv.store.updated`. Nenhum recurso já distribuído foi removido ou desligado.

## Variáveis de ambiente

Nenhuma nova.
