"use client";
/**
 * Linha de uma loja: interruptor de ativa e seletor de conexão de WhatsApp.
 *
 * Mudar um dos dois cria um rascunho na tela; "Salvar" confirma com `PATCH /pdv/lojas/[id]`.
 * Se falhar, o rascunho continua e a mensagem aparece na linha. Loja inativa fica esmaecida.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

export type Loja = {
  id: string;
  erp_store_code: string;
  sigla: string;
  nome: string;
  ativa: boolean;
  channel_session_id: string | null;
};
export type Conexao = { id: string; rotulo: string };

const SEM_CONEXAO = "__sem_conexao__";

export function LinhaDeLoja({ loja, conexoes }: { loja: Loja; conexoes: Conexao[] | null }) {
  const t = useT();
  const qc = useQueryClient();
  const [ativa, setAtiva] = useState<boolean | undefined>(undefined);
  const [conexao, setConexao] = useState<string | null | undefined>(undefined);

  const ativaAgora = ativa ?? loja.ativa;
  const conexaoAgora = conexao === undefined ? loja.channel_session_id : conexao;
  const mudou = ativaAgora !== loja.ativa || conexaoAgora !== loja.channel_session_id;

  const salvar = useMutation({
    mutationFn: async () =>
      apiClient.patch(`/api/v1/pdv/lojas/${loja.id}`, { ativa: ativaAgora, channel_session_id: conexaoAgora }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["pdv", "lojas"] });
      setAtiva(undefined);
      setConexao(undefined);
      toast.success(t("Loja atualizada"));
    },
  });

  function descartar() {
    setAtiva(undefined);
    setConexao(undefined);
    salvar.reset();
  }

  const opcoes = [...(conexoes ?? [])];
  if (conexaoAgora && !opcoes.some((c) => c.id === conexaoAgora)) {
    opcoes.push({ id: conexaoAgora, rotulo: t("Conexão removida") });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-testid={`loja-${loja.id}`} data-ativa={loja.ativa}>
      <div className={`flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 ${loja.ativa ? "" : "opacity-60"}`} data-testid={`loja-${loja.id}-dados`}>
        <span className="w-16 font-mono text-sm font-semibold">{loja.sigla}</span>
        <span className="min-w-0 flex-1 text-sm">{loja.nome}</span>
        <span className="text-xs text-text-muted">
          {t("Código do ERP")}: <span className="tabular-nums">{loja.erp_store_code}</span>
        </span>
        <Badge variant={loja.ativa ? "success" : "neutral"}>{loja.ativa ? t("Ativa") : t("Inativa")}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          checked={ativaAgora}
          onCheckedChange={(v) => setAtiva(v)}
          disabled={salvar.isPending}
          aria-label={`${t("Loja ativa")} ${loja.sigla}`}
          data-testid={`loja-${loja.id}-ativa`}
        />
        <div className="w-full max-w-xs">
          <Select
            value={conexaoAgora ?? SEM_CONEXAO}
            onValueChange={(v) => setConexao(v === SEM_CONEXAO ? null : v)}
            disabled={salvar.isPending}
          >
            <SelectTrigger className="h-11 lg:h-11 lg:min-h-11" aria-label={`${t("Conexão de WhatsApp da loja")} ${loja.sigla}`} data-testid={`loja-${loja.id}-conexao`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_CONEXAO}>{t("Sem conexão")}</SelectItem>
              {opcoes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {mudou && (
          <>
            <Button className="h-11 lg:h-11" onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid={`loja-${loja.id}-salvar`}>
              {t("Salvar")}
            </Button>
            <Button variant="outline" className="h-11 lg:h-11" onClick={descartar} disabled={salvar.isPending}>
              {t("Cancelar")}
            </Button>
          </>
        )}
      </div>
      {salvar.isError && (
        <p className="text-sm text-danger" role="alert" data-testid={`loja-${loja.id}-erro`}>
          {t("Não foi possível salvar. Tente de novo.")}
        </p>
      )}
    </li>
  );
}
