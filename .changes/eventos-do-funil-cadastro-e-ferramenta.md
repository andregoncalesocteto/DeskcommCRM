---
impacto: capacidade_nova
secao: adicionado
titulo: Cada funil cadastra os eventos que aceita de um sistema de fora e para onde o card vai quando eles chegam
---
Em Configurações › Funis há uma seção nova, "Para onde o card vai em cada evento". Quem integra um cardápio digital, uma loja ou uma página ao CRM cadastra ali, à mão, cada fato que o outro sistema vai contar (visita, item visto, carrinho, compra) e escolhe para qual etapa o card vai quando ele chegar; nada vem pronto. A tela avisa de situações que merecem atenção (uma venda sem valor, uma etapa que foi arquivada, dois eventos guardando no mesmo lugar) e mostra quando cada evento foi visto pela última vez. A nova ferramenta `crm_track_event` do MCP conta esses fatos ao CRM: grava no histórico, guarda o último conteúdo, aplica o valor da venda e move o card sem fazê-lo retroceder. Evento que o funil não cadastrou é recusado, e a recusa é definitiva. Também ganha a API `/api/v1/pipelines/{id}/events` e a ferramenta `crm_list_pipeline_events`.
