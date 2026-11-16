# Mapa de telas — Identificar cliente no PDV

| Ordem | Tela | Casos de uso | Prompt |
|---|---|---|---|
| 0 | Estilo (Knowledge) | todos | [00-estilo-knowledge.md](prompts/00-estilo-knowledge.md) |
| 1 | Identificação do cliente (busca, ficha e endereços) | UC01, UC03 | [01-identificacao-do-cliente.md](prompts/01-identificacao-do-cliente.md) |
| 2 | Cadastro de cliente | UC02 | [02-cadastro-de-cliente.md](prompts/02-cadastro-de-cliente.md) |

**Por que duas telas:**
- **UC01 e UC03 viram uma tela só.** Gerenciar endereços (UC03) é uma ação dentro da ficha do cliente identificado (UC01), sem rota nem ator próprios. Por ser `<<extend>>`, vira **modais** dentro da tela de identificação: formulário de endereço e confirmação de remoção.
- **UC02 tem tela própria.** O cadastro é um formulário longo (dados pessoais + endereço) com validações e bloqueios de duplicidade, e fecha voltando à identificação com o cliente selecionado.
- **Componente reutilizado:** o **"Formulário de endereço"** nasce no prompt 1 (dentro do modal) e o prompt 2 o reaproveita na seção "Endereço". O prompt 2 só funciona depois do 1.

**Fora do escopo (sem prompt):** login, montagem do pedido, pagamento, escolha de loja pelo pedido. O botão "Selecionar cliente" não leva a uma tela nova ainda.

**Decisões que viraram layout (confira):**
- Um seletor **"Entrega / Balcão"** no cabeçalho da identificação simula o tipo do pedido, só para demonstrar a regra do endereço obrigatório. No sistema real o tipo vem do fluxo do pedido.
- A busca tem um seletor **Telefone / Nome / CPF** em vez de um campo único, porque 11 dígitos podem ser telefone ou CPF.

**Textos de interface** (mensagens, rótulos, avisos) são sugestões minhas no tom do estilo; pode trocar.

## Como rodar no Lovable

1. Colar o Prompt 0 no **Knowledge** do projeto. Se o projeto é o mesmo da consulta de produtos, o Prompt 0 já traz o mesmo estilo; substitua o Knowledge em vez de duplicar.
2. Para cada tela, na ordem da tabela: rodar o prompt no **Plan mode**, conferir se cada bloco (layout, componentes, dados de exemplo, estados, restrições) aparece no plano, corrigir o plano (não o código) e só então mandar construir.
3. Conferir a prévia bloco a bloco; o que faltar vira o próximo prompt, um por vez.
4. Se dois prompts seguidos não aproximarem do resultado, restaurar a versão anterior em vez de pedir "desfaz".
