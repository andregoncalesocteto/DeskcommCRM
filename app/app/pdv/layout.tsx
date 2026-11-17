import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { moduloLigado } from "@/lib/instalacao/modulos";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PDV é módulo opcional da INSTALAÇÃO (ADR-0002). Com ele desligado, as telas do balcão não
 * existem para ninguém — a mesma recusa das rotas `/api/v1/pdv/*` (404). Mesmo desenho de
 * `app/app/comandas/layout.tsx`.
 */
export default async function Layout({ children }: { children: ReactNode }) {
  if (!(await moduloLigado(createAdminClient(), "pdv"))) notFound();
  return <>{children}</>;
}
