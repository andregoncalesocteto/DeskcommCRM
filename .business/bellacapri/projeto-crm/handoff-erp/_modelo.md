# Handoff EN: <título curto>

Estado: a escrever
Data: AAAA-MM-DD
Entrega: <ferramentas do contrato que esta fatia entrega>
Desbloqueia no CRM: <tarefas>
Depende de: <handoffs anteriores devolvidos>

> Este documento é lido por uma sessão que não tem o contexto da conversa que o gerou. Ele precisa se bastar.

## 1. Contexto mínimo
<Três a cinco frases: quem é o cliente, o que o CRM faz com o ERP, por que esta fatia existe.>

## 2. Objetivo desta entrega
<Uma frase verificável.>

## 3. O que construir
<Lista numerada, sem impor tecnologia.>

## 4. O que NÃO fazer
<Limites explícitos: não tocar produção, não implementar outras ferramentas, não copiar dado real.>

## 5. Contrato
Para cada ferramenta: nome, tipo (leitura ou escrita), entrada, saída, erros, regras.

## 6. Dados de exemplo (fictícios)
<O que precisa existir na homologação para os testes.>

## 7. Critérios de aceitação
<Cada critério com o comando ou a medida que o prova.>

## 8. Devolutiva (a sessão do ERP preenche)
- [ ] Referência do código entregue (commit ou PR):
- [ ] Stack usada e onde a homologação roda:
- [ ] Versão do protocolo MCP e do SDK:
- [ ] Como o CRM se conecta (URL, forma de gerar a chave, sem segredos aqui):
- [ ] Amostras reais de requisição e resposta de cada ferramenta (pasta `amostras/`):
- [ ] Divergências em relação ao contrato, com o motivo:
- [ ] Medidas de latência:
- [ ] Pendências e dúvidas:
