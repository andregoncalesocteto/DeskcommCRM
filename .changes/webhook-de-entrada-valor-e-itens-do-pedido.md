---
impacto: capacidade_nova
secao: adicionado
titulo: O webhook de entrada preenche o valor do pedido e guarda a lista de itens
---
Em Webhooks, cada fonte ganha a seção "Valor e itens do pedido". Quem integra uma plataforma de pedidos diz em qual campo do envio vem o total (e se está em reais ou centavos), e o CRM passa a preencher o valor do card com ele, antes de mover a etapa. Também é possível escolher uma chave da ficha onde guardar a lista de itens e os demais blocos do envio, que antes eram descartados. Quem não configura nada continua exatamente como antes. A tela avisa quando a etapa padrão da fonte fecha a venda sem um campo de valor, e os relatórios da Bella Capri passam a separar o pedido que nasceu no WhatsApp do que nasceu pelo webhook, para a conversão da conversa à compra não ser inflada. Atenção: se a mesma compra chegar pelo rastreador do site e pelo webhook, o produto não percebe que é a mesma; o guia explica qual porta usar.
