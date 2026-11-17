"use client";
/**
 * Modal "Adicionar lojas do ERP": lista as lojas do ERP (`GET /pdv/lojas/erp`), deixa escolher e
 * confirma com `POST /pdv/lojas`. As já adicionadas aparecem marcadas e desabilitadas.
 *
 * Estados: carregando, erro do ERP (com "Tentar de novo"), nenhuma loja nova e falha ao salvar
 * (mantém a seleção). A sigla e o nome vão como o ERP os devolveu: a rota só grava o que o ERP tem.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type LojaDoErp = { codigo: string; sigla: string; nome: string; ja_cadastrada: boolean };

export function AdicionarLojasDoErp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());

  const erp = useQuery({
    queryKey: ["pdv", "lojas", "erp"],
    queryFn: async () => (await apiClient.get<{ data: LojaDoErp[] }>("/api/v1/pdv/lojas/erp")).data,
    enabled: open,
    retry: false,
    gcTime: 0,
  });

  const salvar = useMutation({
    mutationFn: async (lojas: LojaDoErp[]) =>
      apiClient.post("/api/v1/pdv/lojas", { lojas: lojas.map((l) => ({ codigo: l.codigo, sigla: l.sigla })) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pdv", "lojas"] });
      toast.success(t("Lojas adicionadas"));
      fechar(false);
    },
  });

  // Fechar zera seleção e erro: o que se marcou numa abertura não vale para a lista da próxima.
  function fechar(aberto: boolean) {
    if (!aberto) {
      setMarcadas(new Set());
      salvar.reset();
    }
    onOpenChange(aberto);
  }

  const novas = (erp.data ?? []).filter((l) => !l.ja_cadastrada);
  const semNovas = erp.isSuccess && novas.length === 0;

  function alternar(codigo: string) {
    setMarcadas((atual) => {
      const prox = new Set(atual);
      if (prox.has(codigo)) prox.delete(codigo);
      else prox.add(codigo);
      return prox;
    });
  }

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent data-testid="adicionar-lojas-modal">
        <DialogHeader>
          <DialogTitle>{t("Adicionar lojas do ERP")}</DialogTitle>
          <DialogDescription>{t("Escolha as lojas que este tenant vai atender.")}</DialogDescription>
        </DialogHeader>

        {erp.isPending ? (
          <div className="flex flex-col gap-2" data-testid="adicionar-carregando" role="status" aria-label={t("Carregando as lojas do ERP")}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : erp.isError ? (
          <div className="flex flex-col items-start gap-3" data-testid="adicionar-erro-erp" role="alert">
            <p className="text-sm text-danger">{t("Não foi possível buscar as lojas no ERP.")}</p>
            <Button variant="outline" className="h-11 lg:h-11" onClick={() => void erp.refetch()}>
              {t("Tentar de novo")}
            </Button>
          </div>
        ) : semNovas ? (
          <p className="text-sm text-text-muted" data-testid="adicionar-sem-novas" role="status">
            {t("Todas as lojas do ERP já foram adicionadas.")}
          </p>
        ) : (
          <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-md border border-border" data-testid="adicionar-lista">
            {(erp.data ?? []).map((l) => (
              <li key={l.codigo}>
                <label
                  className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                  data-testid={`erp-loja-${l.codigo}`}
                >
                  <input
                    type="checkbox"
                    className="size-4"
                    disabled={l.ja_cadastrada || salvar.isPending}
                    checked={l.ja_cadastrada || marcadas.has(l.codigo)}
                    onChange={() => alternar(l.codigo)}
                  />
                  <span className="w-16 font-mono text-sm font-semibold">{l.sigla}</span>
                  <span className="min-w-0 flex-1 text-sm">{l.nome}</span>
                  {l.ja_cadastrada ? <span className="text-xs text-text-muted">{t("Já adicionada")}</span> : null}
                </label>
              </li>
            ))}
          </ul>
        )}

        {salvar.isError ? (
          <p className="text-sm text-danger" data-testid="adicionar-erro-salvar" role="alert">
            {t("Não foi possível salvar. Tente de novo.")}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" className="h-11 lg:h-11" onClick={() => fechar(false)}>
            {t("Cancelar")}
          </Button>
          <Button
            className="h-11 lg:h-11"
            disabled={marcadas.size === 0 || salvar.isPending}
            onClick={() => salvar.mutate(novas.filter((l) => marcadas.has(l.codigo)))}
          >
            {salvar.isPending ? t("Salvando…") : t("Adicionar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
