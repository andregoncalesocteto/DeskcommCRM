"use client";
/**
 * Ficha do cliente do PDV, somente leitura: bloco "Dados pessoais" de `GET /api/v1/pdv/clientes/{id}`.
 *
 * LGPD: CPF e data de nascimento vivem só no estado do react-query desta tela (`gcTime: 0`). Nunca
 * vão para URL, storage nem log; o CPF é exibido mascarado (`mascaraCpf`, quatro últimos dígitos).
 * Sem botão de editar, adicionar, remover ou selecionar: isso é de outras histórias.
 */
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { mascaraCpf } from "@/lib/lgpd/mask";

type Ficha = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf: string | null;
  data_nascimento: string | null;
};

/** `1988-03-14` (ou com hora) vira `14/03/1988` sem passar por `Date`, que deslocaria o dia pelo fuso. */
function dataBr(iso: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

export function FichaDoCliente({ erpId }: { erpId: string | null }) {
  const t = useT();

  const ficha = useQuery({
    queryKey: ["pdv", "cliente", erpId],
    queryFn: async () =>
      (await apiClient.get<{ data: Ficha }>(`/api/v1/pdv/clientes/${encodeURIComponent(erpId!)}`))
        .data,
    enabled: erpId !== null,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });

  if (erpId === null) {
    return (
      <p
        data-testid="ficha-nenhuma"
        className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted"
      >
        {t("Nenhum cliente selecionado")}
      </p>
    );
  }

  if (ficha.isPending) {
    return (
      <div
        className="flex flex-col gap-3 rounded-md border border-border p-4"
        data-testid="ficha-carregando"
        role="status"
        aria-label={t("Carregando a ficha do cliente")}
      >
        <Skeleton className="h-6 w-40" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (ficha.isError) {
    const erro = ficha.error;
    const api = erro instanceof ApiError ? erro : null;
    if (api?.status === 404) {
      return (
        <p
          data-testid="ficha-nao-encontrado"
          role="alert"
          className="rounded-md border border-border p-4 text-sm"
        >
          {t("Cliente não encontrado no ERP. Busque de novo.")}
        </p>
      );
    }
    if (api?.code === "contato_ambiguo") {
      return (
        <p
          data-testid="ficha-ambiguo"
          role="alert"
          className="text-danger rounded-md border border-border p-4 text-sm"
        >
          {t(
            "Há mais de um contato com os dados deste cliente. Avise o gerente para resolver antes de continuar.",
          )}
        </p>
      );
    }
    const semErp = api?.code === "erp_nao_configurado";
    return (
      <div
        className="flex flex-col items-start gap-3 rounded-md border border-border p-4"
        data-testid="ficha-erro"
        role="alert"
      >
        <p className="text-danger text-sm">
          {semErp
            ? t("O ERP ainda não está configurado. Avise o dono da instalação.")
            : t("Não foi possível carregar a ficha do cliente.")}
        </p>
        {semErp ? null : (
          <Button variant="outline" className="h-11 lg:h-11" onClick={() => void ficha.refetch()}>
            {t("Tentar de novo")}
          </Button>
        )}
      </div>
    );
  }

  const c = ficha.data;
  const naoInformado = t("Não informado");
  const campos: { chave: string; rotulo: string; valor: string | null }[] = [
    { chave: "nome", rotulo: t("Nome"), valor: c.nome },
    { chave: "telefone", rotulo: t("Telefone"), valor: c.telefone },
    { chave: "email", rotulo: t("E-mail"), valor: c.email },
    { chave: "cpf", rotulo: t("CPF"), valor: mascaraCpf(c.cpf) },
    { chave: "nascimento", rotulo: t("Data de nascimento"), valor: dataBr(c.data_nascimento) },
  ];

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4"
      data-testid="ficha"
    >
      <h2 className="text-base font-semibold">{t("Dados pessoais")}</h2>
      <dl className="flex flex-col gap-3">
        {campos.map((f) => (
          <div key={f.chave} className="flex min-w-0 flex-col" data-testid={`ficha-${f.chave}`}>
            <dt className="text-xs text-text-muted">{f.rotulo}</dt>
            <dd
              className={f.valor ? "break-words" : "text-text-muted"}
              data-testid={`ficha-${f.chave}-valor`}
            >
              {f.valor ?? naoInformado}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
