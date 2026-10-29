/**
 * POST/OPTIONS /api/v1/coleta/[chave] — a porta pública de coleta do rastreador (etapa 2 do épico "Eventos do funil").
 *
 * Quem chama é o script no navegador do cliente final: não há sessão nem token secreto. "Público" em
 * `lib/auth/public-paths.ts` quer dizer só que o proxy não decide; AQUI decidem a chave (no caminho, para o
 * preflight também saber de qual chave se trata) e a origem. Organização e funil vêm SOMENTE da linha da chave.
 *
 *  · chave desconhecida, malformada ou revogada → 404, sem cabeçalhos de CORS (a mesma resposta para as três);
 *  · origem fora da lista da chave → 403, sem cabeçalhos de CORS: o navegador bloqueia a leitura;
 *  · limite de taxa por IP e por chave (429 + `Retry-After`, com CORS);
 *  · o corpo é lido como texto (`sendBeacon` manda `text/plain` para não disparar preflight) e validado com Zod.
 *
 * O processamento reaproveita `registrarEventosDoFunil`, a mesma operação do `crm_track_event`: o evento só vale se o
 * funil da chave o cadastrou, e o pedido nunca retrocede.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { ipDoCliente } from "@/lib/http/ip-do-cliente";
import { registrarEventosDoFunil } from "@/lib/leads/eventos-do-funil/registrar";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  JANELA_DO_LIMITE_SEGUNDOS,
  LIMITE_POR_CHAVE_POR_MINUTO,
  LIMITE_POR_IP_POR_MINUTO,
  MAX_BYTES_DO_CORPO,
  cabecalhosDeCors,
  corpoDaColetaSchema,
  origemPermitida,
  resolverChave,
  segundosAteAJanelaAcabar,
} from "@/lib/tracker/coleta";
import { identificarPedido } from "@/lib/tracker/identificar-pedido";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ chave: string }>;
}

export async function OPTIONS(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const { chave: textoDaChave } = await ctx.params;
  const chave = await resolverChave(createAdminClient(), textoDaChave).catch(() => null);
  if (!chave) return new Response(null, { status: 404 });
  const origem = origemPermitida(req.headers.get("origin"), chave);
  if (!origem) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cabecalhosDeCors(origem) });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { chave: textoDaChave } = await ctx.params;
  const admin = createAdminClient();

  let chave;
  try {
    chave = await resolverChave(admin, textoDaChave);
  } catch {
    return fail("internal_error", "Não foi possível processar agora.", 500, { requestId });
  }
  if (!chave) return fail("not_found", "Chave não encontrada.", 404, { requestId });

  const origem = origemPermitida(req.headers.get("origin"), chave);
  if (!origem) return fail("origin_not_allowed", "Origem não permitida para esta chave.", 403, { requestId });
  const cors = cabecalhosDeCors(origem);

  // Dois contadores: o IP primeiro (um visitante ou robô não esgota a cota do site inteiro) e depois a chave. O 429
  // leva CORS, porque a origem já foi conferida: sem ele o navegador esconderia o `Retry-After` do script.
  const ip = ipDoCliente(req.headers) ?? "desconhecido";
  const porIp = await checkRateLimit(`coleta:ip:${chave.id}:${ip}`, LIMITE_POR_IP_POR_MINUTO, JANELA_DO_LIMITE_SEGUNDOS);
  const porChave = porIp.allowed
    ? await checkRateLimit(`coleta:chave:${chave.id}`, LIMITE_POR_CHAVE_POR_MINUTO, JANELA_DO_LIMITE_SEGUNDOS)
    : porIp;
  if (!porIp.allowed || !porChave.allowed) {
    return fail("rate_limited", "Muitas requisições. Tente de novo em instantes.", 429, {
      requestId,
      headers: { ...cors, "Retry-After": String(segundosAteAJanelaAcabar()) },
    });
  }

  const texto = await req.text().catch(() => "");
  if (texto.length === 0 || new TextEncoder().encode(texto).length > MAX_BYTES_DO_CORPO) {
    return fail("validation_failed", "Corpo ausente ou grande demais.", 422, { requestId, headers: cors });
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return fail("validation_failed", "O corpo precisa ser JSON.", 422, { requestId, headers: cors });
  }
  const parsed = corpoDaColetaSchema.safeParse(bruto);
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
      headers: cors,
    });
  }
  const corpo = parsed.data;

  try {
    const leadId = await identificarPedido(admin, chave, corpo.idtrack);
    if (leadId !== null) {
      await registrarEventosDoFunil(
        admin,
        {
          organizationId: chave.organizationId,
          leadId,
          actor: { type: "webhook_source", id: chave.id },
          eventos: corpo.events,
        },
        requestId,
      );
    }
  } catch {
    return fail("internal_error", "Não foi possível processar agora.", 500, { requestId, headers: cors });
  }

  // A mesma forma sempre: o navegador não aprende se o idtrack existia, se havia pedido nem o que o funil decidiu.
  return ok(
    { eventos: corpo.events.map((e) => ({ event_id: e.event_id, resultado: "recebido" })) },
    { requestId, headers: cors },
  );
}
