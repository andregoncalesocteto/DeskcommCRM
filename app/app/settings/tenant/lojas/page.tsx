import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { LojasDoTenant } from "./_client";

export const dynamic = "force-dynamic";

/**
 * LOJAS DO TENANT — as lojas do ERP que este tenant atende (módulo PDV, `pdv_stores`).
 *
 * `manager`+, o mesmo piso da porta no `NAV_CATALOG` e da rota que adiciona lojas. Quem tem
 * papel menor volta para o início em vez de ver uma tela que a API recusaria.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org || ROLE_RANK[org.role] < ROLE_RANK.manager) redirect("/app");

  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Lojas")}</h1>
        <p className="text-sm text-text-muted">
          {t("As lojas do ERP que este tenant atende no balcão e no telefone.")}
        </p>
      </div>
      <LojasDoTenant />
    </div>
  );
}
