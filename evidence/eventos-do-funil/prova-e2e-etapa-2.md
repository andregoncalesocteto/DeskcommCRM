# Prova pela tela da etapa 2 (US-029)

**Spec:** `tests/e2e/rastreador-do-cardapio.spec.ts` (parte 7 do CI) · **Rodada local:** 29/10/2026, aplicação compilada contra o Supabase local, 7 casos, 28 s. O site do cardápio é um servidor HTTP real em outra porta (outra origem), aberto num Chromium real, com o código **copiado da tela** de instalação.

| Passo | Captura |
|---|---|
| Chave criada pela tela e código de instalação | `e2e-rastreador-01-chave-e-codigo.png` |
| Página do cardápio carregada com o script | `e2e-rastreador-02-pagina-do-cardapio.png` |
| Tela mostrando o uso da chave | `e2e-rastreador-03-uso-da-chave.png` |
| Chave revogada | `e2e-rastreador-04-chave-revogada.png` |

Casos: fluxo completo até Compras (valor 7390, JSON em `pedido`/`cart`/`checkout`, `origem = navegador`, sem telefone/e-mail/nome); recarga da página de sucesso sem duplicar; compra sem carrinho registrada e não fecha; `idtrack` telefone não envia nada; origem não listada bloqueada; revogar para o mesmo código na hora.

**Sabotagens (script servido do disco, sem rebuild):** sem o filtro de dados pessoais → falha o fluxo completo; sem validar o UUID do idtrack → falha o caso do telefone. Um vermelho cada, como previsto.

**Não coberto:** celular, outros navegadores, proxy/CDN reescrevendo `Origin`.
