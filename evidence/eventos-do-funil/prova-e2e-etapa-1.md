# Prova pela tela da etapa 1 (US-018)

**Spec:** `tests/e2e/eventos-do-funil.spec.ts` (parte 7 do CI) · **Rodada local:** 29/10/2026, aplicação compilada (`pnpm e2e:build`) contra o Supabase local, login do gerente, 2 casos, 10,5 s. Funil, etapas e pedido são semeados pela própria spec e apagados no fim; o MCP é o real, com o token do seed.

| Passo | Captura |
|---|---|
| Funil sem evento cadastrado (estado vazio) | `e2e-01-vazio.png` |
| Formulário da compra preenchido (etapa, guardar em, valor, repetição, «respeitar a mão» desligado) | `e2e-02-formulario.png` |
| Evento cadastrado, destino em palavras, «Ainda não recebeu nada.» | `e2e-03-cadastrado.png` |
| Depois da compra por `crm_track_event`: uso visto e chave trancada | `e2e-04-uso-e-chave-trancada.png` |
| Evento desativado (selo «Desativado») | `e2e-05-desativado.png` |

**Sabotagem:** com a chave sempre editável (`disabled={false}`), o caso 1 reprova em `toBeDisabled`; o caso 2 cai junto porque depende do cadastro do primeiro.

**Não coberto:** celular, leitor de tela e o caminho por agente de IA. O roteiro mais longo (avisos, bloqueio, edição) está em `verificacao-no-navegador-us016-us017.md`.
