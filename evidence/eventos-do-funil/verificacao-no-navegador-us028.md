# Verificação no navegador: instalação do rastreador (US-028)

**Data:** 29/10/2026 · **Como:** `dev-browser` (Playwright) dirigindo a tela real de **Configurações › Funis**, servida por `next dev -p 3100` com o código da branch, contra o banco da stack local (organização RPA - Abrão Thomé, funil **Pedidos**), com um **gerente temporário** (criado e apagado). A migration 9041 foi aplicada no banco local antes (sem ela a leitura devolve 500 e a tela mostra a mensagem de falha — conferido no log). Uma segunda página, servida em `http://localhost:8099` (outra origem), recebeu o **código copiado da própria tela**.

| # | Passo | Resultado observado | Captura |
|---|---|---|---|
| 1 | Abrir o funil e rolar até «Rastreador para o site do cardápio» | Estado vazio; texto leigo: a chave pública não é uma senha, só envia eventos dos sites cadastrados, não lê nada do CRM; cancelamento não passa por aqui | `us028-01-vazio.png` |
| 2 | Criar chave com o site `http://cardapio.exemplo` | Recusa antes de enviar: «Site não aceito: use https://seu-site.com.br, sem caminho (http só em localhost). («http://cardapio.exemplo»)» | `us028-02-site-invalido.png` |
| 3 | Criar com `https://cardapio.exemplo/` e `http://localhost:8099` | Chave `pk_…` criada, sites normalizados (sem a barra), «Ainda não recebeu nenhum evento.»; «Ver o código» mostra o trecho com a chave e o endereço do CRM; banco e auditoria (`tracker_key.created`) conferem | `us028-03-chave-e-codigo.png` |
| 4 | Colar o trecho numa página em `localhost:8099` e abrir com `?idtrack=<contato>` | O pedido aberto do contato foi de Conversas a **Visitas**; o histórico guardou `page_view` com `origem = navegador`, a `chave_id` e **só** `screen_name` (o `phone` enviado pela página foi removido pelo script); o evento não cadastrado gerou o aviso de depuração no console e não entrou no histórico | — |
| 5 | Preflight com origem listada e com origem não listada | Listada: 204 com `access-control-allow-origin`; não listada: 403 e nenhum cabeçalho de CORS | — |
| 6 | Voltar à tela | «Visto pela última vez em 29/10/2026, 19:23 · 1 nos últimos 7 dias» | `us028-04-chave-recebeu-evento.png` |
| 7 | Revogar | Pede confirmação e avisa que o código deixa de funcionar na hora | `us028-05-confirmar-revogar.png` |
| 8 | Confirmar | Selo «Revogada», sem botões de copiar nem revogar; auditoria `tracker_key.revoked`; recarregar a página do site **não** gravou mais nada (continuou 1 evento) | `us028-06-revogada.png` |

## Limpeza

Pedido, histórico, chave, evento cadastrado, vínculo e **usuário temporário** removidos. Sobras conferidas: **0 | 0 | 0 | 0 | 0**; o banco voltou a 1 organização e 1 usuário.

## O que esta verificação não cobre

- Um viewport (1400 × 1000); celular e leitor de tela não foram vistos.
- O botão «Copiar código de instalação» foi exercitado só nos testes de componente (a área de transferência do navegador automatizado não foi lida); na tela foi usado «Ver o código».
- **Achado:** o 404 de uma chave revogada não leva cabeçalhos de CORS (de propósito, para não revelar nada). O navegador o enxerga como erro de rede, e o script tenta de novo algumas vezes (espera crescente, no máximo 5) antes de desistir. Inofensivo, mas ruidoso; a documentação da etapa avisa.
- Só um navegador (Chromium).
