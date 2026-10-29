---
impacto: capacidade_nova
secao: adicionado
titulo: O agente pode mandar o link de um cardápio externo com o código do cliente, sem errar
---
Quem usa um cardápio ou página externa que reconhece o cliente pelo código dele no CRM pode escrever `{{id_do_contato}}` no prompt do agente, dentro do link (por exemplo `https://loja.exemplo/?idtrack={{id_do_contato}}`). O sistema troca o marcador pelo código do cliente na hora de enviar a mensagem, em vez de depender de o agente copiá-lo. Funciona em agentes sem ferramentas do CRM ligadas, que não enxergam esse código.
