# ADR-002: O ERP como cadastro mestre de cliente, com contato espelho no CRM

Status: Aceito
Data: 2026-11-16
Aceito em: 2026-11-16, pelo dono do projeto, sem alterações no texto
Origem da decisão: o ERP como fonte dos clientes foi decidido pelo dono do projeto durante o desenho das interfaces. O contato espelho e a regra de endereços são proposta do Design Doc.

## 1. Contexto

- O PDV identifica o cliente por telefone, nome ou CPF e mantém a ficha (nome, CPF, e-mail, nascimento) e vários endereços por cliente.
- O CRM já tem a tabela `contacts`, com telefone único por organização, e-mail e CPF únicos (CPF cifrado, com hash para busca), data de nascimento e busca por telefone com variantes brasileiras. **Não tem endereço de contato nem vários endereços.** Vários telefones por ficha estão só como proposta em rascunho.
- Conversas, funil, memória e LGPD do CRM se ligam a um `contacts`.
- O ERP, em outro repositório, é a fonte de preço, taxa e histórico de pedidos, e será construído com as operações de cliente e endereço.
- Um mesmo cliente pode pedir em lojas de tenants diferentes (ADR-001), e o CRM não cruza tenants.

## 2. Decisão

Vamos tratar o **ERP como cadastro mestre de cliente e de endereço**, mantendo no CRM apenas um **contato espelho** vinculado ao identificador do ERP e a **cópia do endereço usado em cada pedido**, sem tabela de endereços do cliente no CRM.

## 3. Alternativas consideradas

| # | Alternativa | A favor | Contra | Decisão |
| --- | --- | --- | --- | --- |
| 1 | Cadastro mestre no CRM (`contacts` mais tabela de endereços), sincronizado com o ERP | O PDV funcionaria com o ERP fora do ar | Duas fontes de verdade; regra de sincronização e de conflito; o histórico entre tenants não se junta | Rejeitada |
| 2 | Só o ERP, sem contato espelho no CRM | Sem duplicação de cadastro | O pedido perde a ligação com conversas, funil, memória e LGPD do CRM | Rejeitada |
| 3 | **ERP mestre, contato espelho por tenant e cópia do endereço no pedido** | Uma fonte de verdade; o CRM mantém conversas, funil e LGPD; o histórico entre tenants vem do ERP | Depende do ERP para buscar e editar cliente; contatos espelhados em vários tenants | **Escolhida** |

## 4. Consequências

**Positivas**
- Uma única fonte de verdade para cadastro e endereço, e o histórico completo de qualquer loja vem do ERP.
- O CRM não precisa criar tabela de endereços nem sincronização.
- O pedido guarda o endereço usado, então alterar ou remover um endereço não muda pedidos antigos.

**Negativas e trade-offs**
- **Dependência do ERP** para identificar e cadastrar cliente. Com o ERP fora do ar, o PDV não busca cliente novo. A contingência (usar contatos do CRM como cadastro provisório) não está decidida.
- **Duplicidade de contato:** o contato espelho precisa casar com contatos que já existam (de conversas de WhatsApp, por exemplo) pelos índices únicos de telefone, CPF e e-mail.
- **LGPD:** um pedido de exclusão ou anonimização precisa ser cumprido no ERP e em cada tenant em que o cliente tenha contato espelho.

**Obrigações criadas**
- Tabela de vínculo contato para identificador do ERP (`pdv_customer_links`).
- Regra para casar o cliente do ERP com um contato existente por telefone (variantes), CPF (hash) e e-mail, e tratar o erro de unicidade.
- Regra de conflito quando o CPF coincide e os dados divergem.
- O ERP precisa oferecer identificador estável de cliente e a unicidade de CPF e telefone (perguntas 1 e 2 do contrato).
- Esta decisão altera a tarefa 2.1 do plano (que previa tabela de endereços no CRM).
