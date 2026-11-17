"use client";
/**
 * Lista de lojas do tenant (módulo PDV), com o botão que abre o modal "Adicionar lojas do ERP".
 *
 * Estados: carregando (esqueleto), erro (com "Tentar de novo"), vazio e ERP não configurado.
 * O último só se descobre quando a lista está vazia: a rota de lojas do tenant não fala com o
 * ERP, então a tela pergunta à lista de lojas do ERP — e só quando não há nada para mostrar.
 * Módulo desligado não é estado desta tela: o layout devolve 404.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { nomeDoCanal } from "@/lib/channels/estado";
import { ApiError } from "@/lib/api/types";

import { AdicionarLojasDoErp } from "./_adicionar";
import { type Conexao, type Loja, LinhaDeLoja } from "./_linha";

function Conteudo() {
  const t = useT();

  const lojas = useQuery({
    queryKey: ["pdv", "lojas"],
    queryFn: async () => (await apiClient.get<{ data: Loja[] }>("/api/v1/pdv/lojas")).data,
    retry: false,
  });

  type ConexaoApi = { id: string; display_name: string | null; phone_number: string | null };
  const conexoes = useQuery({
    queryKey: ["pdv", "conexoes"],
    queryFn: async (): Promise<Conexao[]> =>
      (await apiClient.get<{ data: ConexaoApi[] }>("/api/v1/channel-sessions")).data.map((c) => ({
        id: c.id,
        rotulo: nomeDoCanal(c, t),
      })),
    retry: false,
  });

  const vazia = lojas.isSuccess && lojas.data.length === 0;

  // Só pergunta pelo ERP quando a lista está vazia: é a única hora em que "sem ERP" muda o que a
  // pessoa deve fazer. Falha do ERP aqui (fora do ar, lento) não vira erro de tela: cai no vazio.
  const erp = useQuery({
    queryKey: ["pdv", "lojas", "erp-configurado"],
    queryFn: async () => {
      try {
        await apiClient.get("/api/v1/pdv/lojas/erp");
        return true;
      } catch (e) {
        return !(e instanceof ApiError && e.code === "erp_nao_configurado");
      }
    },
    enabled: vazia,
    retry: false,
  });

  if (lojas.isPending) {
    return (
      <div className="flex flex-col gap-2" data-testid="lojas-carregando" role="status" aria-label={t("Carregando as lojas")}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (lojas.isError) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border border-border p-4" data-testid="lojas-erro" role="alert">
        <p className="text-sm text-danger">{t("Não foi possível carregar as lojas.")}</p>
        <Button variant="outline" className="h-11 lg:h-11" onClick={() => void lojas.refetch()}>
          {t("Tentar de novo")}
        </Button>
      </div>
    );
  }

  if (vazia) {
    if (erp.isPending) {
      return <Skeleton className="h-24 w-full" data-testid="lojas-carregando" />;
    }
    if (erp.data === false) {
      return (
        <div className="rounded-md border border-border p-4" data-testid="lojas-erp-nao-configurado" role="status">
          <p className="text-sm font-medium">{t("O ERP ainda não está configurado nesta instalação.")}</p>
          <p className="mt-1 text-sm text-text-muted">
            {t("Peça ao dono da instalação para cadastrar o endereço e a chave do ERP em Configurações da instalação. Depois disso, volte aqui para adicionar as lojas.")}
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-md border border-border p-4" data-testid="lojas-vazio" role="status">
        <p className="text-sm font-medium">{t("Este tenant ainda não tem lojas")}</p>
        <p className="mt-1 text-sm text-text-muted">
          {t("Quando você adicionar lojas do ERP, elas aparecem aqui.")}
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border" data-testid="lojas-lista">
      {lojas.data.map((loja) => (
        <LinhaDeLoja key={loja.id} loja={loja} conexoes={conexoes.data ?? null} />
      ))}
    </ul>
  );
}

export function LojasDoTenant() {
  const t = useT();
  const [adicionando, setAdicionando] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button className="h-11 lg:h-11" onClick={() => setAdicionando(true)} data-testid="adicionar-lojas">
          {t("Adicionar lojas do ERP")}
        </Button>
      </div>
      <Conteudo />
      <AdicionarLojasDoErp open={adicionando} onOpenChange={setAdicionando} />
    </div>
  );
}
