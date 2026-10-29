---
impacto: nada_mudou
secao: corrigido
titulo: O agente passa a ler todas as mensagens que o cliente mandou em sequência
---
Quando o cliente escrevia uma frase por mensagem (por exemplo "oi, tudo bem?" e, segundos depois, "quanto tempo demora a entrega?"), o agente respondia só à primeira e tratava a pergunta como conversa antiga, podendo mandar uma resposta sem relação com o que foi perguntado. Agora as mensagens que chegam logo depois da primeira, ainda sem resposta, entram no mesmo turno e são lidas como um pedido só.
