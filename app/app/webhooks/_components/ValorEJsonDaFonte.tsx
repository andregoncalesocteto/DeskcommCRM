"use client";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/i18n/useT";
import { usePipelineStages, useUpdateWebhookSource, type WebhookSourceRow } from "@/hooks/webhooks/useWebhookSources";
import { FORMA_DO_CAMINHO } from "@/lib/leads/eventos-do-funil/caminho-e-valor";

/**
 * Na fonte do webhook de entrada: onde está o valor do pedido e onde guardar a lista de itens.
 *
 * Quem integra um cardápio ou uma loja manda o total e os itens do pedido; sem esta seção o valor não chega ao card e a
 * lista de itens (que é aninhada) é descartada. Os dois avisos no fim existem porque a etapa padrão da fonte vale para
 * TODO envio dela: uma fonte que leva o card a uma etapa de ganho sem dizer o valor entrega vendas sem total.
 */

const FORMA_DA_CHAVE = /^[a-z][a-z0-9_]{0,63}$/;

interface Rascunho {
  caminho: string;
  unidade: "reais" | "centavos";
  chaveDoJson: string;
}

const doFonte = (s: Pick<WebhookSourceRow, "value_path" | "value_unit" | "payload_state_key">): Rascunho => ({
  caminho: s.value_path ?? "",
  unidade: s.value_unit ?? "reais",
  chaveDoJson: s.payload_state_key ?? "",
});

/** O que a tela mandaria ao salvar, ou o motivo de não poder. Puro: testado sem montar a tela. */
export function corpoDoSalvar(
  r: Rascunho,
  t: (s: string) => string = (s) => s,
): { ok: true; corpo: { value_path: string | null; value_unit: "reais" | "centavos" | null; payload_state_key: string | null } } | { ok: false; problema: string } {
  const caminho = r.caminho.trim();
  const chave = r.chaveDoJson.trim();
  if (caminho !== "" && !FORMA_DO_CAMINHO.test(caminho)) {
    return { ok: false, problema: t("Use só nomes de campo separados por ponto, como pedido.total.") };
  }
  if (chave !== "" && !FORMA_DA_CHAVE.test(chave)) {
    return { ok: false, problema: t("Guardar em: minúsculas, números e _, começando por letra.") };
  }
  return {
    ok: true,
    corpo: {
      value_path: caminho === "" ? null : caminho,
      value_unit: caminho === "" ? null : r.unidade,
      payload_state_key: chave === "" ? null : chave,
    },
  };
}

export function ValorEJsonDaFonte({ source, podeEditar }: { source: WebhookSourceRow; podeEditar: boolean }) {
  const t = useT();
  const update = useUpdateWebhookSource();
  const etapas = usePipelineStages(source.default_pipeline_id);
  const [salvo, setSalvo] = React.useState<{ id: string; r: Rascunho } | null>(null);
  const base = salvo?.id === source.id ? salvo.r : doFonte(source);
  const [rascunho, setRascunho] = React.useState<{ id: string; r: Rascunho } | null>(null);
  const atual = rascunho?.id === source.id ? rascunho.r : base;
  const mudar = (parte: Partial<Rascunho>) => setRascunho({ id: source.id, r: { ...atual, ...parte } });

  const etapaPadrao = etapas.data?.data?.stages?.find((e) => e.id === source.default_stage_id) ?? null;
  const resultado = corpoDoSalvar(atual, t);
  const mudou = JSON.stringify(corpoDoSalvar(base).ok ? (corpoDoSalvar(base) as { corpo: unknown }).corpo : null) !==
    JSON.stringify(resultado.ok ? resultado.corpo : "invalido");
  const caminhoSalvo = (salvo?.id === source.id ? salvo.r.caminho : source.value_path ?? "").trim();

  function salvar() {
    if (!resultado.ok) return;
    update.mutate(
      { id: source.id, ...resultado.corpo },
      {
        onSuccess: (res) => {
          const r = doFonte(res.data);
          setSalvo({ id: source.id, r });
          setRascunho(null);
        },
      },
    );
  }

  return (
    <section className="space-y-3 rounded-sm border border-border p-3" data-testid="valor-e-json-da-fonte">
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">{t("Valor e itens do pedido")}</p>
        <p className="text-sm text-muted-foreground">
          {t("Se quem envia (um cardápio, uma loja) manda o total do pedido, diga em qual campo ele vem: o CRM preenche o valor do card com ele. Os itens do pedido, que chegam como lista, ficam guardados na ficha do card se você escolher onde.")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fonte-valor-campo">{t("Campo do valor do pedido")}</Label>
          <Input
            id="fonte-valor-campo"
            className="font-mono"
            value={atual.caminho}
            placeholder="value"
            disabled={!podeEditar}
            onChange={(e) => mudar({ caminho: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {t("Como aparece no envio: value, ou pedido.total quando está dentro de outro bloco. Deixe vazio para não preencher o valor.")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fonte-valor-unidade">{t("O valor vem em")}</Label>
          <Select value={atual.unidade} onValueChange={(v) => mudar({ unidade: v as "reais" | "centavos" })} disabled={!podeEditar || atual.caminho.trim() === ""}>
            <SelectTrigger id="fonte-valor-unidade">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reais">{t("Reais (por exemplo, 73.90)")}</SelectItem>
              <SelectItem value="centavos">{t("Centavos (por exemplo, 7390)")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fonte-json-chave">{t("Guardar os itens e os demais dados aninhados em")}</Label>
        <Input
          id="fonte-json-chave"
          className="font-mono"
          value={atual.chaveDoJson}
          placeholder="pedido_json"
          disabled={!podeEditar}
          onChange={(e) => mudar({ chaveDoJson: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          {t("Opcional. Listas e blocos que o outro sistema manda (os itens, os dados do cliente) ficam guardados aqui, como estão. Sem isto, só os campos simples são aproveitados. Não pode ter o mesmo nome de um campo da ficha do funil.")}
        </p>
      </div>

      {!resultado.ok && (
        <p className="text-sm text-destructive" data-testid="valor-e-json-erro">
          {resultado.problema}
        </p>
      )}

      {podeEditar && (
        <Button type="button" variant="secondary" disabled={!mudou || !resultado.ok || update.isPending} onClick={salvar} data-testid="valor-e-json-salvar">
          {update.isPending ? t("Salvando…") : t("Salvar valor e itens")}
        </Button>
      )}

      {etapaPadrao?.is_won && caminhoSalvo === "" && (
        <p className="text-sm text-warning-fg" data-testid="aviso-ganho-sem-valor">
          {t("A etapa padrão desta fonte")} «{etapaPadrao.name}» {t("fecha a venda, mas nenhum campo do valor foi configurado: os cards chegam ganhos sem valor e a venda não é enviada como conversão.")}
        </p>
      )}
      {etapaPadrao && (
        <p className="text-xs text-muted-foreground" data-testid="aviso-etapa-padrao">
          {t("Todo envio desta fonte leva o card para a etapa")} «{etapaPadrao.name}». {t("Para o pedido andar por várias etapas conforme o que o cliente faz, use os eventos do funil.")}
        </p>
      )}
    </section>
  );
}
