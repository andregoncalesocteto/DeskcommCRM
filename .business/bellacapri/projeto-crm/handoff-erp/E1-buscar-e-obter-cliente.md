# Handoff E1: `buscar_cliente`, `obter_cliente` e clientes fictícios

Estado: pronto para enviar (depois da devolutiva do E0)
Data: 2026-11-16
Entrega: duas ferramentas MCP de leitura sobre o cadastro de cliente, e os clientes fictícios na homologação
Desbloqueia no CRM: 2.2 (identificar cliente) e 2.3 (ficha do cliente)
Depende de: [E0](E0-homologacao-e-listar-lojas.md) devolvido (homologação isolada, servidor MCP autenticado, comando de reposição)

> Este documento é lido por uma sessão que não tem o contexto da conversa que o gerou. Ele precisa se bastar.

## 1. Contexto mínimo

A Bella Capri, rede de pizzarias, está construindo um módulo de ponto de venda dentro de um CRM. O atendente identifica o cliente por **telefone, nome ou CPF** e vê a ficha com os **endereços**. **Este ERP é o cadastro mestre de cliente**: o CRM guarda só um espelho, ligado ao identificador do ERP. O CRM chama este ERP por um servidor MCP. O E0 já criou a homologação e a ferramenta `listar_lojas`. Esta entrega acrescenta a leitura de cliente. Cadastro e edição vêm no E3; endereços e CEP, no E2.

## 2. Objetivo desta entrega

Na homologação, `buscar_cliente` e `obter_cliente` respondem como o contrato abaixo, sobre um conjunto fixo de clientes fictícios que o comando de reposição restaura.

## 3. O que construir

1. A ferramenta `buscar_cliente` (seção 5).
2. A ferramenta `obter_cliente` (seção 5).
3. O **modelo de cliente com vários endereços e um principal**, se o ERP ainda não o tiver. A premissa é que o ERP é ajustável; registre na devolutiva como ficou.
4. **Identificadores estáveis** de cliente e de endereço: não mudam com o tempo e não são reaproveitados.
5. Os **clientes fictícios** da seção 6 na homologação, e a atualização do comando de reposição para restaurá-los junto com as lojas do E0.
6. Para o campo `loja_entrega`, uma **tabela de CEP para loja** na homologação (seção 6), suficiente para esta fatia. A regra real de área de entrega chega no E2.
7. Registro de cada chamada, como no E0. **Sem CPF, telefone nem e-mail** nos registros.

## 4. O que NÃO fazer

- Não tocar a produção, nem copiar cliente real para a homologação.
- Não implementar cadastro, edição, endereços, CEP nem pedido; são fatias seguintes.
- Não devolver CPF, telefone nem e-mail na lista de `buscar_cliente`.
- Não devolver `cpf` nem `data_nascimento` em `obter_cliente` sem `campos_sensiveis: true`.
- Não colocar chaves nem dados pessoais reais neste documento.
- Não mudar nome, entrada ou saída sem registrar na devolutiva.

## 5. Contrato

Convenções: campos em `snake_case`, telefone em E.164 (`+5519998765432`), CPF só dígitos, CEP só dígitos, datas `YYYY-MM-DD`. Campo opcional sem valor vem `null`, exceto os sensíveis não pedidos, que são **omitidos**. As duas ferramentas declaram `readOnlyHint: true`. Sucesso: o JSON vai em `structuredContent`. Erro: resultado com `isError: true` e o **texto** sendo um JSON com `codigo` estável e `mensagem` curta em português (e `detalhes`, se útil); os comuns são `nao_autorizado`, `erp_indisponivel` e `tempo_esgotado`.

### `buscar_cliente`

**Entrada**
```json
{ "modo": "telefone", "termo": "(19) 99876-5432", "limite": 6 }
```
- `modo`: `"telefone"`, `"nome"` ou `"cpf"` (obrigatório).
- `termo`: texto, obrigatório; pode vir com máscara, o ERP normaliza.
- `limite`: inteiro opcional; padrão 6; máximo 20.

**Regras por modo**
- `telefone`: só dígitos; aceita 10 ou 11, com ou sem o DDI 55; menos de 10 dígitos dá `termo_invalido`; correspondência exata. Seja tolerante ao nono dígito de celular (com e sem o 9) e **registre o comportamento** na devolutiva.
- `nome`: parte do nome, sem diferenciar maiúsculas nem acentos, mínimo de 2 caracteres (menos dá `termo_invalido`); ordem alfabética sem acento.
- `cpf`: só dígitos; 11 dígitos e dígito verificador válido; senão `termo_invalido`.
- Em `telefone` e `cpf` há no máximo um resultado.

**Saída**
```json
{
  "clientes": [
    { "id": "c-0001", "nome": "Maria Oliveira",
      "endereco_principal": "Rua das Acácias, 120 — Apto 32, bloco B — Jardim Primavera, Campinas/SP" }
  ],
  "total_encontrado": 1,
  "truncado": false
}
```
- `endereco_principal`: uma linha de texto, ou `null` se o cliente não tem endereço.
- `total_encontrado`: quantos casam, mesmo acima do limite; `truncado` é `true` se for maior que o limite.
- **Nenhum resultado não é erro:** devolve `{ "clientes": [], "total_encontrado": 0, "truncado": false }`.
- Erro específico: `termo_invalido`, com `detalhes.campo`.

### `obter_cliente`

**Entrada**
```json
{ "cliente_id": "c-0001", "campos_sensiveis": false }
```
- `cliente_id`: obrigatório.
- `campos_sensiveis`: opcional; padrão `false`. Com `true`, a resposta inclui `cpf` e `data_nascimento`.

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
      { "id": "e-0001", "cep": "13060000", "uf": "SP", "cidade": "Campinas",
        "bairro": "Jardim Primavera", "endereco": "Rua das Acácias, 120",
        "complemento": "Apto 32, bloco B", "principal": true,
        "loja_entrega": { "codigo": "1", "sigla": "CAS" } }
    ]
  }
}
```
- `telefone` e `email`: `null` quando não houver (ao menos um existe).
- `cpf` e `data_nascimento`: **omitidos** sem `campos_sensiveis: true`; com a flag podem ser `null` se não cadastrados.
- `enderecos`: lista vazia se não há endereço; **exatamente um** `principal: true` quando a lista não é vazia.
- `endereco`: logradouro com número em um campo só.
- `loja_entrega`: loja que entrega naquele endereço (`codigo` e `sigla` da loja), ou **`null` quando nenhuma loja entrega**.
- Erro específico: `nao_encontrado`.

## 6. Dados de exemplo (fictícios)

Cinco clientes, **todos inventados** (nomes, telefones, e-mails e CPFs de teste). Use os códigos e siglas reais das lojas já criados no E0; abaixo, `CAS` e `RPA` são as siglas, e o `codigo` é o que o ERP já tem para elas. O comando de reposição restaura este conjunto.

| Id | Nome | Telefone | E-mail | CPF | Nascimento |
| --- | --- | --- | --- | --- | --- |
| c-0001 | Maria Oliveira | +5519998765432 | maria.oliveira@email.com | 52998224725 | 1988-03-14 |
| c-0002 | Maria de Fátima Albuquerque Nascimento Souza dos Santos | +5519981234567 | `null` | `null` | `null` |
| c-0003 | Mariana Lopes | +5519997012233 | `null` | `null` | `null` |
| c-0004 | João Pereira Lima | +5519993331100 | joao.lima@email.com | `null` | `null` |
| c-0005 | Fernanda Souza Barbosa | +5517996667788 | fernanda.barbosa@email.com | `null` | `null` |

Endereços (`principal` em negrito):

| Cliente | Id | CEP | UF | Cidade | Bairro | Endereço | Complemento | Loja de entrega |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| c-0001 | e-0001 **(principal)** | 13060000 | SP | Campinas | Jardim Primavera | Rua das Acácias, 120 | Apto 32, bloco B | CAS |
| c-0001 | e-0002 | 13010000 | SP | Campinas | Centro | Avenida Brasil, 1500 | `null` | CAS |
| c-0001 | e-0003 | 13825000 | SP | Holambra | Zona Rural | Estrada Municipal do Rio Pequeno, km 7, Sítio Recanto das Palmeiras, portão azul ao lado do mercado | `null` | **nenhuma (`null`)** |
| c-0002 | e-0004 **(principal)** | 13025001 | SP | Campinas | Cambuí | Rua Coronel Quirino, 880 | `null` | CAS |
| c-0003 | e-0005 **(principal)** | 13026000 | SP | Campinas | Bosque | Rua Dr. Sampaio Ferraz, 45 | `null` | CAS |
| c-0004 | (nenhum) | | | | | | | |
| c-0005 | e-0006 **(principal)** | 15010000 | SP | São José do Rio Preto | Centro | Rua Exemplo, 100 | `null` | RPA |

**Tabela de CEP para loja da homologação** (provisória, até o E2): 13060000, 13010000, 13025001 e 13026000 para CAS; 15010000 para RPA; 13825000 para nenhuma.

**Por que esses dados:** o nome "maria" pega três clientes, para testar a lista de candidatos; c-0002 tem nome comprido, para testar o corte; c-0001 tem três endereços, um fora de qualquer área; c-0004 não tem endereço; c-0005 é de outro tenant e outra loja. **Não** crie nenhum cliente chamado Carlos Eduardo Ferreira nem com o CPF `11144477735` ou o telefone `+5517995554321`: eles são usados depois para testar o cadastro (E3).

## 7. Critérios de aceitação

| # | Critério | Como se prova |
| --- | --- | --- |
| 1 | `buscar_cliente` por telefone `(19) 99876-5432` devolve só c-0001 | Teste automatizado |
| 2 | Por nome `maria` devolve c-0002, c-0001 e c-0003, nessa ordem, com `total_encontrado` 3 e `truncado` falso | Teste automatizado |
| 3 | Por nome `maria` com `limite: 2` devolve 2 e `truncado` verdadeiro | Teste automatizado |
| 4 | Por CPF `529.982.247-25` devolve c-0001 | Teste automatizado |
| 5 | CPF `111.111.111-11` e telefone `99876` dão `termo_invalido` | Teste automatizado |
| 6 | Nome `xyzzy` devolve lista vazia, sem erro | Teste automatizado |
| 7 | A lista de `buscar_cliente` não contém CPF, telefone nem e-mail | Teste automatizado que inspeciona a saída |
| 8 | `obter_cliente` de c-0001 devolve 3 endereços, um só principal, com `loja_entrega` CAS, CAS e `null` | Teste automatizado |
| 9 | `obter_cliente` de c-0004 devolve `enderecos: []` | Teste automatizado |
| 10 | Sem `campos_sensiveis`, a saída **não tem** `cpf` nem `data_nascimento`; com `true`, tem | Teste automatizado |
| 11 | `cliente_id` inexistente dá `nao_encontrado`; sem chave dá `nao_autorizado` | Teste automatizado |
| 12 | O comando de reposição restaura estes clientes e as lojas do E0, e pode rodar duas vezes seguidas | Rodar duas vezes e comparar |
| 13 | As duas ferramentas declaram `readOnlyHint: true` | Listar as ferramentas do servidor |
| 14 | Latência abaixo de 1 segundo no p95, em 20 chamadas de cada | Medir e registrar |
| 15 | Os registros de chamada não contêm CPF, telefone nem e-mail | Inspecionar o registro depois dos testes |

## 8. Devolutiva (a sessão do ERP preenche)

- [ ] Referência do código entregue (commit ou PR):
- [ ] Como o ERP modelou cliente com vários endereços e endereço principal (já existia ou foi criado):
- [ ] Como são os identificadores de cliente e de endereço, e se são estáveis:
- [ ] Tratamento do nono dígito do celular na busca por telefone:
- [ ] Amostras reais de requisição e resposta das duas ferramentas, em `amostras/buscar_cliente.json` e `amostras/obter_cliente.json`:
- [ ] Divergências em relação ao contrato, com o motivo:
- [ ] Medidas de latência (critério 14):
- [ ] Pendências e dúvidas:

## 9. Depois desta entrega

O CRM constrói a identificação do cliente e a ficha (tarefas 2.2 e 2.3) sobre estas amostras reais. O próximo handoff (E2) traz `consultar_cep`, `loja_do_endereco` e a gestão de endereços, que substitui a tabela provisória de CEP.
