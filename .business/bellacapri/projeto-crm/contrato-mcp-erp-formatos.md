# Contrato do MCP do ERP: formatos de entrada e saída

Versão: 0.3 (rascunho, por fatia)
Data: 2026-11-16
Complementa: [contrato-mcp-erp.md](contrato-mcp-erp.md) (quem usa, regras gerais, catálogo e perguntas ao ERP)

> **Como ler.** Este documento fixa o formato exato de cada ferramenta, **uma fatia por vez**, na ordem dos handoffs. Hoje cobre as fatias E0 e E1. Cada fatia nova entra aqui antes de o handoff correspondente ser escrito. O que o ERP já tem ou não tem ainda não foi confirmado; onde o formato depende disso, está marcado como **premissa**.

## Convenções

- Nomes de campo em `snake_case`, em português, como no resto do contrato.
- Dinheiro, quando aparecer, em centavos (`_cents`) com `currency` ISO-4217. Não há dinheiro nas fatias E0 e E1.
- Datas em ISO-8601 (`YYYY-MM-DD`); instantes em UTC.
- Telefone em E.164 (`+5519998765432`). CPF só com dígitos (`52998224725`). CEP só com dígitos (`13060000`).
- Campo opcional sem valor vem como `null`, exceto os **sensíveis não solicitados**, que são **omitidos**.
- Toda ferramenta de leitura declara `readOnlyHint: true`.
- **Sucesso:** o resultado da ferramenta traz o JSON do contrato em `structuredContent` (e um texto curto de apoio).
- **Erro:** o resultado vem com `isError: true` e o **texto** é um JSON com `codigo` estável, `mensagem` curta em português e, quando útil, `detalhes`. O CRM só lê o texto no erro.

```json
{ "codigo": "termo_invalido", "mensagem": "Informe o telefone com DDD.", "detalhes": { "campo": "termo" } }
```

**Erros comuns a todas as ferramentas:** `nao_autorizado`, `erp_indisponivel`, `tempo_esgotado`.

**Falha de autenticação (decisão de 2026-11-17).** `isError` só existe em `tools/call`. Chave ausente ou inválida pode ser recusada **antes** da camada de ferramentas, em qualquer método (`initialize`, `tools/list`, `tools/call`), com **HTTP 401**, `WWW-Authenticate: Bearer` e o mesmo JSON `{ "codigo": "nao_autorizado", "mensagem": ... }` no corpo. O CRM aceita as duas formas e **não lê o corpo do 401**: trata como falha de conexão e mostra "ERP indisponível" ao operador. Chave inválida não é distinguida de ERP fora do ar na tela, só no registro do ERP.

---

## Fatia E0

### `listar_lojas`
Definida no [handoff E0](handoff-erp/E0-homologacao-e-listar-lojas.md). Resumo: entrada `{ "apenas_ativas": true }`; saída `{ "lojas": [ { "codigo", "sigla", "nome", "endereco", "ativa" } ] }`.

---

## Fatia E1

### `buscar_cliente`

**Tipo:** leitura. **Uso no CRM:** identificação do cliente no PDV (UC01).

**Entrada**
```json
{
  "modo": "telefone",
  "termo": "(19) 99876-5432",
  "limite": 6
}
```

| Campo | Tipo | Regra |
| --- | --- | --- |
| `modo` | `"telefone"` \| `"nome"` \| `"cpf"` | Obrigatório |
| `termo` | texto | Obrigatório; pode vir com máscara, o ERP normaliza |
| `limite` | inteiro | Opcional; padrão 6; máximo 20 |

**Regras por modo**
- `telefone`: considera só os dígitos; aceita 10 ou 11 dígitos, com ou sem DDI 55. Menos de 10 dígitos é `termo_invalido`. A correspondência é exata. **Premissa:** o ERP trata o nono dígito de celular de forma tolerante (com e sem o 9); registre o comportamento na devolutiva.
- `nome`: busca por parte do nome, sem diferenciar maiúsculas e acentos, com no mínimo 2 caracteres. Menos que isso é `termo_invalido`. Ordem alfabética sem acento.
- `cpf`: considera só os dígitos; precisa ter 11 dígitos e dígito verificador válido. Senão, `termo_invalido`.

Em `telefone` e `cpf` o resultado tem no máximo um cliente.

**Saída**
```json
{
  "clientes": [
    {
      "id": "c-0001",
      "nome": "Maria Oliveira",
      "endereco_principal": "Rua das Acácias, 120 — Apto 32, bloco B — Jardim Primavera, Campinas/SP"
    }
  ],
  "total_encontrado": 1,
  "truncado": false
}
```

| Campo | Regra |
| --- | --- |
| `clientes[].id` | Identificador **estável** do cliente no ERP; é o que o CRM guarda no contato espelho |
| `clientes[].nome` | Nome completo |
| `clientes[].endereco_principal` | Uma linha de texto; `null` se o cliente não tem endereço |
| `total_encontrado` | Quantos clientes casam, mesmo acima do limite |
| `truncado` | `true` se `total_encontrado` for maior que o limite |

**Nenhum cliente encontrado não é erro:** devolve `{ "clientes": [], "total_encontrado": 0, "truncado": false }`.

**Dados pessoais:** a lista não devolve CPF, telefone nem e-mail. Nome e endereço bastam para o atendente escolher.

**Erros:** `termo_invalido` (com `detalhes.campo`), mais os comuns.

---

### `obter_cliente`

**Tipo:** leitura. **Uso no CRM:** ficha do cliente (UC01 e UC03).

**Entrada**
```json
{
  "cliente_id": "c-0001",
  "campos_sensiveis": false
}
```

| Campo | Tipo | Regra |
| --- | --- | --- |
| `cliente_id` | texto | Obrigatório |
| `campos_sensiveis` | booleano | Opcional; padrão `false`. Com `true`, a resposta inclui `cpf` e `data_nascimento` |

O PDV pede `campos_sensiveis: true`. A IA de conversa e o assistente não pedem, e o CRM não envia esses campos ao modelo.

**Saída**
```json
{
  "cliente": {
    "id": "c-0001",
    "nome": "Maria Oliveira",
    "telefone": "+5519998765432",
    "email": "maria.oliveira@email.com",
    "cpf": "52998224725",
    "data_nascimento": "1988-03-14",
    "enderecos": [
      {
        "id": "e-0001",
        "cep": "13060000",
        "uf": "SP",
        "cidade": "Campinas",
        "bairro": "Jardim Primavera",
        "endereco": "Rua das Acácias, 120",
        "complemento": "Apto 32, bloco B",
        "principal": true,
        "loja_entrega": { "codigo": "1", "sigla": "CAS" }
      }
    ]
  }
}
```

| Campo | Regra |
| --- | --- |
| `telefone`, `email` | `null` quando não houver; ao menos um dos dois existe (regra do cadastro) |
| `cpf`, `data_nascimento` | Só aparecem com `campos_sensiveis: true`; **omitidos** caso contrário. Podem ser `null` mesmo com a flag, se não cadastrados |
| `enderecos` | Lista vazia se o cliente não tem endereço. **Exatamente um** endereço tem `principal: true` quando a lista não é vazia |
| `enderecos[].id` | Identificador estável do endereço |
| `enderecos[].endereco` | Logradouro com número, em um campo só |
| `enderecos[].complemento` | `null` quando não houver |
| `enderecos[].loja_entrega` | Loja que entrega naquele endereço, calculada pelo ERP; **`null` quando nenhuma loja entrega**. Na fatia E1, pode vir de uma tabela de CEP para loja da homologação; a fatia E2 a substitui pela regra real |

**Erros:** `nao_encontrado` (cliente inexistente), mais os comuns.

---

## Premissas desta fatia (a confirmar pela sessão do ERP)

1. O ERP tem, ou passa a ter, **cliente com vários endereços e um principal**. Se não tiver, a sessão do ERP o modela e registra na devolutiva.
2. O ERP tem **identificador estável** de cliente e de endereço.
3. O ERP trata o **nono dígito** do celular de forma tolerante na busca por telefone.

A unicidade de CPF e de telefone entre clientes só é exigida na fatia E3 (cadastro).
