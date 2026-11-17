import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { IdentificarCliente } from "./_client";

export const dynamic = "force-dynamic";

/**
 * IDENTIFICAR CLIENTE — a primeira tela do balcão: o atendente acha o cliente por telefone, nome
 * ou CPF no ERP (cadastro mestre) antes de montar o pedido.
 *
 * `agent`+, o mesmo piso da rota `GET /api/v1/pdv/clientes`. Quem tem papel menor volta para o
 * início em vez de ver uma tela que a API recusaria.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.agent) redirect("/app");

  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Identificar cliente")}</h1>
        <p className="text-sm text-text-muted">
          {t("Busque o cliente por telefone, nome ou CPF antes de montar o pedido.")}
        </p>
      </div>
      <IdentificarCliente />
    </div>
  );
}
