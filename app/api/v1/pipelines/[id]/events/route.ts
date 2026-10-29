/**
 * GET /api/v1/pipelines/[id]/events — o cadastro de eventos de um funil, com os sinais de uso.
 *
 * "Para onde o card vai em cada evento" (Configurações › Funis). O cadastro é o contrato de quem integra um
 * sistema de fora (ADR-0007, ADR-0009); esta rota é o lado da tela.
 *
 * Auth: sessão por cookie, papel manager+ (é configuração do funil). `organization_id` sai do JWT — nunca do
 * corpo. O client é o do usuário, então a RLS vale; o filtro explícito de `organization_id` é a convenção do repo e
 * a rede que sobra se a política mudar. Funil de outra organização responde 404, a MESMA resposta de um funil que
 * não existe: dizer "existe, mas não é seu" já é vazar a existência.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { funilDaOrganizacao, lerCadastroComUso } from "@/lib/leads/eventos-do-funil/cadastro";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "pipeline_events" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { id: pipelineId } = await ctx.params;
  const supabase = await createClient();

  try {
    if (!(await funilDaOrganizacao(supabase, authz.org.orgId, pipelineId))) {
      return fail("not_found", t("Funil não encontrado."), 404, { requestId });
    }
    const eventos = await lerCadastroComUso(supabase, authz.org.orgId, pipelineId);
    return ok({ eventos }, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
