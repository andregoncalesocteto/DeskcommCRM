# ADR-001: Tenants por unidade operacional, com a loja como dado do módulo

Status: Aceito
Data: 2026-11-16
Aceito em: 2026-11-16, pelo dono do projeto, sem alterações no texto
Origem da decisão: decidida pelo dono do projeto (estrutura de tenants, lojas por tenant, todos os operadores veem todas as lojas do tenant, aba Lojas). O destino do pedido entre tenants está em aberto.

## 1. Contexto

- A rede se organiza em unidades operacionais. Exemplos dados: o tenant Campinas atende a loja CAS; o tenant Rio Preto atende RPA, RPV, RPR e RPI; o tenant do Call Center atende todas as lojas. Cada tenant tem as suas conexões de WhatsApp, os seus agentes e a sua configuração.
- O PRD pai partia da hipótese "cada loja é um tenant". O call center atende telefone para qualquer loja, e o balcão de Rio Preto vê as quatro lojas dele.
- O CRM isola dados por organização (tenant) com RLS. Pelo que foi lido no código, **não há acesso entre organizações para usuário de negócio**, nem o conceito de loja, nem permissão por loja dentro de uma organização (a doutrina do CRM deixa permissão por funil fora do MVP).
- O ERP, que fica em outro repositório, é a fonte comum de cadastro de cliente, histórico e pedidos entre as lojas.

## 2. Decisão

Vamos organizar o CRM com **um tenant por unidade operacional**, cada um com a lista das lojas que atende (a loja é um dado do módulo PDV, mantido numa aba Lojas), mais um **tenant do Call Center que atende todas as lojas**, tratando o ERP como camada comum entre os tenants.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | Um tenant por loja | Isolamento máximo por RLS; encaixa na doutrina | O call center não enxerga as lojas; sem visão consolidada; exige acesso entre organizações, que não existe | Rejeitada |
| 2 | Organização única com grupos de lojas e escopo por operador | Atende qualquer loja e consolida tudo | Perde o isolamento entre lojas; exige construir permissão por loja, grupos e escopos, sem precedente no CRM; conexões e agentes ficam misturados | Rejeitada |
| 3 | **Um tenant por unidade operacional, com as lojas que atende, mais o Call Center** | Respeita o isolamento por tenant que já existe; cada unidade com as suas conexões e agentes; não exige acesso entre organizações nem permissão por loja | O pedido do call center para loja de outro tenant fica no tenant do call center; contatos espelhados em vários tenants | **Escolhida** |

## 4. Consequências

**Positivas**
- Nenhuma mudança no isolamento do CRM: o tenant é o limite, como hoje.
- O papel `agent` já basta; não há escopo de operador nem tabela de grupos.
- Conexões, agentes e configuração por unidade, como a operação já funciona.

**Negativas e trade-offs**
- **Pedido entre tenants:** o que o call center registra para uma loja de outro tenant não aparece no CRM do tenant da loja. O painel por loja (FR-005) e a visão da rede precisam vir do ERP ou de relatório externo.
- **Cliente em vários tenants:** o mesmo cliente tem um contato espelho em cada tenant que o atendeu, e um pedido de LGPD precisa ser cumprido em cada um (ver ADR-002).
- **Loja calculada fora do tenant:** em entrega, o ERP calcula a loja pelo endereço; se ela não pertence ao tenant do operador, é preciso decidir entre recusar e encaminhar (em aberto).

**Obrigações criadas**
- Criar a entidade loja no módulo (`pdv_stores`) e a aba Lojas na configuração do tenant, com o mapeamento conexão para loja.
- Validar a loja de toda requisição contra as lojas do tenant, inclusive em consultas com acesso privilegiado.
- Gravar no ERP a origem e o tenant de origem de cada pedido, para os números por loja saírem de lá.
- Decidir, em ADR próprio ou em revisão deste, se há cópia do pedido no tenant da loja.
