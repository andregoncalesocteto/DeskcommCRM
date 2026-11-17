import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PDV é módulo opcional da INSTALAÇÃO (ADR-0002). Com ele desligado, Configurações › Lojas não
 * existe para nenhuma empresa — a mesma recusa da rota `/api/v1/pdv/lojas` (404). Mesmo desenho
 * de `app/app/settings/tenant/proposals/layout.tsx`.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  if (!(await moduloLigado(createAdminClient(), "pdv"))) notFound();
  return <>{children}</>;
}
