# Handoff E0: homologação do ERP e `listar_lojas`

Estado: pronto para enviar
Data: 2026-11-16
Entrega: ambiente de homologação do ERP e a ferramenta `listar_lojas` num servidor MCP
Desbloqueia no CRM: 0.4 (prova do MCP), 1.3 (camada do ERP), 1.4 (aba Lojas)
Depende de: nada

> Este documento é lido por uma sessão que não tem o contexto da conversa que o gerou. Ele precisa se bastar.

## 1. Contexto mínimo

A Bella Capri, rede de pizzarias, está construindo um módulo de ponto de venda dentro de um CRM (DeskcommCRM). Esse CRM vai consultar e operar **este ERP** por um servidor **MCP** (Model Context Protocol). O ERP é a fonte única de cardápio, preço, taxa de entrega e cadastro de cliente. Hoje o ERP **não tem API nem MCP**, e **não existe ambiente de homologação**. Esta entrega cria a base: um ambiente de teste isolado e o primeiro servidor MCP, com uma ferramenta simples. As demais ferramentas virão em handoffs seguintes (E1 em diante).

## 2. Objetivo desta entrega

Um servidor MCP de **homologação**, autenticado, que responde `listar_lojas` com as lojas da rede, sobre dados isolados da produção e repostos por um comando.

## 3. O que construir

1. **Ambiente de homologação separado da produção:** instância, banco ou schema próprio e credencial própria. Nada compartilha dado de escrita com a produção.
2. **Servidor MCP** pelo protocolo MCP sobre **Streamable HTTP** (é o que o CRM usa, pelo SDK oficial). **O servidor escuta em HTTP na rede local; não implemente TLS.** Um **túnel HTTPS**, configurado pelo dono do projeto fora deste repositório, publica o servidor num nome HTTPS público, que é o endereço que o CRM usa (o CRM recusa HTTP em produção, hosts privados e IPv6 literal; e o endereço não pode ter usuário, senha, querystring nem fragmento). Por isso o servidor precisa **funcionar atrás de proxy reverso**, sem depender do esquema nem da porta da requisição recebida.
3. **Autenticação por chave de API** no cabeçalho `Authorization: Bearer <chave>`. Sem chave válida, a chamada é recusada. As chaves são geradas e rotacionadas por você, e **nunca** entram neste documento. O CRM registra um servidor por tenant, então emita **uma chave por tenant** (Campinas, Rio Preto, Call Center): o ERP identifica o tenant pela chave.
4. **A ferramenta `listar_lojas`** (seção 5).
5. **Dados de exemplo e comando de reposição:** um comando que apaga o que a homologação tiver e repõe o conjunto inicial (seção 6). Deve poder rodar quantas vezes for preciso e dar o mesmo resultado.
6. **Registro de cada chamada** (ferramenta, horário, duração, resultado). Aceite e registre, sem depender deles, cabeçalhos que comecem com `X-Deskcomm-` (o CRM os envia em algumas chamadas).
7. **Documento curto de conexão:** URL da homologação, como gerar a chave, versão do protocolo e um exemplo de chamada.

## 4. O que NÃO fazer

- Não ponha dado real na homologação: ela ficará **acessível pela internet por um túnel**, protegida pela chave. Só dados fictícios, só o servidor MCP exposto (nenhuma outra rota, painel ou página), e toda chamada sem chave válida é recusada.
- Não tocar a produção, nem apontar a homologação para ela.
- Não copiar dado real de cliente para a homologação.
- Não implementar outras ferramentas além de `listar_lojas`; elas virão nos próximos handoffs.
- Não colocar chaves, senhas ou URLs internas neste documento nem em repositório.
- Não mudar o nome, a entrada ou a saída da ferramenta sem registrar na devolutiva.

## 5. Contrato

### `listar_lojas`

- **Tipo:** leitura. O servidor deve declarar `readOnlyHint: true` na ferramenta (o CRM só trata como leitura se isso estiver declarado).
- **Entrada:**

```json
{
  "apenas_ativas": true
}
```

`apenas_ativas` é opcional e vale `true` por padrão.

- **Saída:**

```json
{
  "lojas": [
    {
      "codigo": "string, identificador interno estável da loja no ERP",
      "sigla": "string, ex.: CAS, RPA",
      "nome": "string",
      "endereco": "string, em texto livre",
      "ativa": true
    }
  ]
}
```

- **Regras:**
  - `codigo` e `sigla` são **estáveis**: não mudam com o tempo.
  - A ordem é estável (por sigla).
  - A resposta contém só estes campos.
- **Erros** (com código estável e mensagem curta em português): `nao_autorizado`, `erp_indisponivel`. O erro vem como resultado com `isError: true` e o **texto** sendo um JSON `{ "codigo": "...", "mensagem": "..." }`; o sucesso traz o JSON em `structuredContent`.

## 6. Dados de exemplo (fictícios)

Cinco lojas, com o **código e a sigla reais** da rede (não são dados pessoais). Endereços e quaisquer outros dados podem ser fictícios.

| Sigla | Observação |
| --- | --- |
| CAS | Campinas |
| RPA | Rio Preto |
| RPV | Rio Preto |
| RPR | Rio Preto |
| RPI | Rio Preto |

Inclua uma sexta loja **inativa** (por exemplo, sigla `TST`), para o filtro `apenas_ativas` ter o que filtrar.

O comando de reposição deve deixar a homologação exatamente neste estado. Os handoffs seguintes acrescentam clientes, cardápio e pedidos ao mesmo conjunto.

## 7. Critérios de aceitação

| # | Critério | Como se prova |
| --- | --- | --- |
| 1 | A homologação é isolada da produção | Uma escrita feita na homologação não aparece na produção; o comando de conexão mostra bases diferentes |
| 2 | `listar_lojas` devolve as cinco lojas ativas, com `codigo`, `sigla`, `nome`, `endereco` e `ativa` | Teste automatizado que compara a saída com a seção 6 |
| 3 | Com `apenas_ativas: false`, a loja inativa também aparece | Teste automatizado |
| 4 | Sem chave, ou com chave inválida, a chamada é recusada com `nao_autorizado` | Teste automatizado |
| 5 | O comando de reposição devolve o estado inicial e pode rodar duas vezes seguidas | Rodar duas vezes e comparar |
| 6 | A ferramenta declara `readOnlyHint: true` | Listar as ferramentas do servidor e conferir |
| 7 | Latência de `listar_lojas` abaixo de 1 segundo no p95 | Medir em 20 chamadas e registrar |
| 8 | O documento de conexão permite a outra pessoa se conectar sem perguntar nada | Seguir o documento do zero |
| 9 | Pelo endereço HTTPS do túnel, uma chamada de fora da rede funciona; sem chave, é recusada; e nenhuma outra rota do ERP responde por esse endereço | Chamar de uma máquina fora da rede do ERP, com e sem chave, e tentar uma rota qualquer |
| 10 | Existem três chaves distintas (Campinas, Rio Preto, Call Center) e o registro de chamada mostra de qual tenant veio cada uma | Chamar com cada chave e ler o registro |
| 11 | Um erro volta com `isError: true` e texto em JSON com `codigo`; o sucesso traz `structuredContent` | Teste automatizado |

## 8. Devolutiva (a sessão do ERP preenche)

- [ ] Referência do código entregue (commit ou PR):
- [ ] Stack usada e onde a homologação roda:
- [ ] Versão do protocolo MCP, do SDK e transporte usado:
- [ ] Como o CRM se conecta (URL, forma de gerar a chave; **sem segredos aqui**):
- [ ] Amostras reais de requisição e resposta de `listar_lojas`, salvas em `amostras/listar_lojas.json`:
- [ ] Divergências em relação ao contrato, com o motivo:
- [ ] Medidas de latência (critério 7):
- [ ] Pendências e dúvidas:

## 9. Depois desta entrega

O CRM roda a prova do MCP (0.4) contra esta homologação: mede a latência (o CRM abre uma conexão nova a cada chamada) e confirma o tempo limite adequado ao `criar_pedido`. O próximo handoff (E1) traz `buscar_cliente` e `obter_cliente`, com os clientes fictícios.
