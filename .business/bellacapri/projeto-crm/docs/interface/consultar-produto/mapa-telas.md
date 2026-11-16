# Mapa de telas — Consulta de produtos no PDV

| Ordem | Tela | Casos de uso | Prompt |
|---|---|---|---|
| 0 | Estilo (Knowledge) | todos | [00-estilo-knowledge.md](prompts/00-estilo-knowledge.md) |
| 1 | Consulta de produtos | UC01, UC02 | [01-consulta-de-produtos.md](prompts/01-consulta-de-produtos.md) |

**Por que uma tela só:** adicionar ao carrinho (UC02) é uma ação dentro do card da
consulta (UC01), não tem rota nem ator próprios. Por ser `<<extend>>`, a escolha da
quantidade vira um **modal** dentro da tela de consulta, e o carrinho é um **painel**
na mesma tela.

**Fora do escopo (sem prompt):** login, detalhes do produto, fechamento da venda,
pagamento. O botão "Fechar venda" existe na tela, mas não leva a uma tela nova ainda.

## Como rodar no Lovable

1. Colar o Prompt 0 no **Knowledge** do projeto.
2. Para cada tela, na ordem da tabela: rodar o prompt no **Plan mode**, conferir se cada
   bloco (layout, componentes, dados de exemplo, estados, restrições) aparece no plano,
   corrigir o plano (não o código) e só então mandar construir.
3. Conferir a prévia bloco a bloco; o que faltar vira o próximo prompt, um por vez.
4. Se dois prompts seguidos não aproximarem do resultado, restaurar a versão anterior em
   vez de pedir "desfaz".
