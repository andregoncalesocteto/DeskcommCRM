"use client";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import {
  useChavesDoRastreador,
  useCriarChave,
  useRevogarChave,
  type ChaveDoRastreador,
} from "@/hooks/pipelines/useChavesDoRastreador";
import { Plus } from "@/lib/ui/icons";
import { normalizarOrigens } from "@/lib/tracker/origens";
import { mensagemDeErro } from "./_mapping";

/**
 * Onde o gerente instala o rastreador no site do cardápio: cria a chave pública do funil, diz de quais sites ela vale
 * e copia o código pronto. Fica logo abaixo dos eventos, porque o rastreador só conta eventos que o funil cadastrou.
 *
 * O texto é de quem usa: a chave é apresentada como o ENDEREÇO do funil (não uma senha), e a tela diz o que ela não
 * faz — ler dados do CRM e cancelar pedido.
 */

export const ancoraDoRastreador = (pipelineId: string) => `rastreador-${pipelineId}`;

/**
 * O código que o gerente cola no site. O trecho de cima só enfileira as chamadas e carrega o arquivo sem travar a
 * página; o endereço do CRM vai explícito para o script não depender de adivinhá-lo.
 */
export function trechoDeInstalacao(enderecoDoCrm: string, chave: string): string {
  const base = enderecoDoCrm.replace(/\/+$/, "");
  return [
    "<script>",
    "(function(w,d,s){w.deskcomm=w.deskcomm||function(){(w.deskcomm.q=w.deskcomm.q||[]).push([].slice.call(arguments))};" +
      'var e=d.createElement("script");e.async=1;e.src=s;d.head.appendChild(e)})' +
      `(window,document,"${base}/deskcomm-rastreador.js");`,
    `deskcomm("init",{key:"${chave}",endpoint:"${base}"});`,
    "</script>",
  ].join("\n");
}

/** Um site por linha → lista de origens, ou a primeira linha que não serve (para a mensagem apontar para ela). */
export function origensDoTexto(texto: string): { ok: true; origens: string[] } | { ok: false; invalida: string | null } {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (linhas.length === 0) return { ok: false, invalida: null };
  const r = normalizarOrigens(linhas);
  return r.ok ? { ok: true, origens: r.origens } : { ok: false, invalida: r.invalida };
}

export function usoDaChave(c: ChaveDoRastreador, t: (s: string) => string, tagDeIdioma: string): string {
  if (!c.ultimo_recebimento) return t("Ainda não recebeu nenhum evento.");
  const quando = new Date(c.ultimo_recebimento).toLocaleString(tagDeIdioma, { dateStyle: "short", timeStyle: "short" });
  return `${t("Visto pela última vez em")} ${quando} · ${c.recebidos_7_dias} ${t("nos últimos 7 dias")}`;
}

function FormularioDaChave({
  pendente,
  erro,
  onCriar,
  onCancelar,
}: {
  pendente: boolean;
  erro: string | null;
  onCriar: (nome: string, origens: string[]) => void;
  onCancelar: () => void;
}) {
  const t = useT();
  const [nome, setNome] = useState("");
  const [sites, setSites] = useState("");
  const [tocou, setTocou] = useState(false);

  const origens = origensDoTexto(sites);
  let problema: string | null = null;
  if (nome.trim() === "") problema = t("Dê um nome à chave.");
  else if (!origens.ok && origens.invalida === null) problema = t("Informe ao menos um site, um por linha.");
  else if (!origens.ok) problema = `${t("Site não aceito: use https://seu-site.com.br, sem caminho (http só em localhost).")} («${origens.invalida}»)`;

  return (
    <div className="space-y-4 rounded-md border border-border bg-surface-2 p-4" data-testid="form-chave">
      <div className="space-y-1.5">
        <Label htmlFor="chave-nome">{t("Nome da chave")}</Label>
        <Input
          id="chave-nome"
          value={nome}
          maxLength={80}
          placeholder={t("Cardápio digital")}
          onChange={(e) => setNome(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="chave-sites">{t("Sites onde o código vai rodar (um por linha)")}</Label>
        <textarea
          id="chave-sites"
          rows={3}
          value={sites}
          placeholder="https://cardapio.minhaloja.com.br"
          onChange={(e) => setSites(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
        />
        <p className="text-xs text-text-muted">
          {t("Use o endereço do site, começando por https://, sem nada depois do nome. Para testar no seu computador, http://localhost também vale.")}
        </p>
      </div>
      {(tocou && problema) || erro ? (
        <Card className="flex items-start gap-3 border-warning bg-warning-bg p-3" data-testid="chave-erro">
          <p className="text-sm">{erro ?? problema}</p>
        </Card>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pendente}
          data-testid="chave-criar"
          onClick={() => {
            setTocou(true);
            if (problema || !origens.ok) return;
            onCriar(nome.trim(), origens.origens);
          }}
        >
          {t("Criar chave")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
          {t("Cancelar")}
        </Button>
      </div>
    </div>
  );
}

export function RastreadorSection({ pipelineId }: { pipelineId: string }) {
  const t = useT();
  const tagDeIdioma = useTagDeIdioma();
  const chaves = useChavesDoRastreador(pipelineId);
  const criar = useCriarChave(pipelineId);
  const revogar = useRevogarChave(pipelineId);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [verCodigo, setVerCodigo] = useState<string | null>(null);

  if (chaves.isError) {
    return (
      <p className="text-sm text-text-muted" data-testid="rastreador-erro-leitura">
        {t("Não foi possível carregar as chaves do rastreador agora. Recarregue a página.")}
      </p>
    );
  }
  if (!chaves.data) {
    return (
      <p className="text-sm text-text-muted" data-testid="rastreador-carregando">
        {t("Carregando as chaves do rastreador…")}
      </p>
    );
  }

  const enderecoDoCrm = typeof window === "undefined" ? "" : window.location.origin;

  async function copiar(c: ChaveDoRastreador) {
    try {
      await navigator.clipboard.writeText(trechoDeInstalacao(enderecoDoCrm, c.public_key));
      toast.success(t("Código copiado. Cole no site, dentro de <head>."));
    } catch {
      setVerCodigo(c.id);
      toast.error(t("Não consegui copiar. O código está aberto abaixo: selecione e copie."));
    }
  }

  function criarChave(nome: string, origens: string[]) {
    setErro(null);
    criar.mutate(
      { label: nome, allowed_origins: origens },
      {
        onSuccess: () => {
          setCriando(false);
          toast.success(t("Chave criada."));
        },
        onError: (e) => setErro(mensagemDeErro(e, t)),
      },
    );
  }

  return (
    <div className="space-y-4" id={ancoraDoRastreador(pipelineId)} data-testid={`rastreador-${pipelineId}`}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("Rastreador para o site do cardápio")}</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-text-muted">
          {t("Se o seu cardápio roda num site próprio, cole um pequeno código nele para contar ao CRM o que o cliente faz: viu um item, montou o carrinho, comprou. Só chegam os eventos cadastrados acima.")}
        </p>
      </div>

      <Card className="space-y-2 bg-surface-2 p-4 text-sm leading-relaxed" data-testid="rastreador-explicacao">
        <p>
          <strong>{t("A chave pública não é uma senha.")}</strong>{" "}
          {t("Ela é o endereço do seu funil e vai dentro do código da página. Quem a vê consegue só enviar eventos, e apenas a partir dos sites que você cadastrar abaixo; não consegue ler nada do CRM. Se desconfiar de mau uso, revogue a chave e crie outra.")}
        </p>
        <p className="text-text-muted">
          {t("O cancelamento de um pedido não passa por aqui: quem cancela é o servidor do cardápio, com o token de API.")}
        </p>
      </Card>

      {chaves.data.length === 0 && !criando ? (
        <div className="rounded-md border border-dashed border-border p-4" data-testid="rastreador-vazio">
          <p className="text-sm text-text-muted">{t("Este funil ainda não tem chave. Crie uma para gerar o código de instalação.")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {chaves.data.map((c) => (
            <li key={c.id} className="space-y-3 p-4" data-testid={`chave-${c.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {c.label}
                    <span
                      className="ml-2 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted"
                      data-testid={`situacao-${c.id}`}
                    >
                      {c.is_active ? t("Ativa") : t("Revogada")}
                    </span>
                  </p>
                  <p className="break-all font-mono text-xs text-text-muted" data-testid={`valor-${c.id}`}>
                    {c.public_key}
                  </p>
                  <p className="text-xs text-text-muted" data-testid={`sites-${c.id}`}>
                    {t("Vale nos sites")}: {c.allowed_origins.join(", ")}
                  </p>
                  <p className="text-xs text-text-muted" data-testid={`uso-${c.id}`}>
                    {usoDaChave(c, t, tagDeIdioma)}
                  </p>
                </div>
                {c.is_active && (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void copiar(c)} data-testid={`copiar-${c.id}`}>
                      {t("Copiar código de instalação")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setVerCodigo(verCodigo === c.id ? null : c.id)}
                      data-testid={`ver-codigo-${c.id}`}
                    >
                      {verCodigo === c.id ? t("Esconder o código") : t("Ver o código")}
                    </Button>
                    {confirmando === c.id ? (
                      <>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          disabled={revogar.isPending}
                          data-testid={`confirmar-revogar-${c.id}`}
                          onClick={() =>
                            revogar.mutate(c.id, {
                              onSuccess: () => {
                                setConfirmando(null);
                                toast.success(t("Chave revogada."));
                              },
                              onError: (e) => toast.error(mensagemDeErro(e, t)),
                            })
                          }
                        >
                          {t("Sim, revogar agora")}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmando(null)}>
                          {t("Cancelar")}
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmando(c.id)} data-testid={`revogar-${c.id}`}>
                        {t("Revogar")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {c.is_active && confirmando === c.id && (
                <p className="text-xs text-text-muted" data-testid={`aviso-revogar-${c.id}`}>
                  {t("O código deixa de funcionar na hora, em todos os sites onde estiver instalado.")}
                </p>
              )}
              {c.is_active && verCodigo === c.id && (
                <div className="space-y-2" data-testid={`codigo-${c.id}`}>
                  <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 text-xs">
                    {trechoDeInstalacao(enderecoDoCrm, c.public_key)}
                  </pre>
                  <p className="text-xs text-text-muted">
                    {t("Depois, onde algo acontecer na página, conte ao CRM com uma linha como esta (o link que leva o cliente ao cardápio precisa trazer ?idtrack=):")}
                  </p>
                  <pre className="overflow-x-auto rounded-md border border-border bg-surface-2 p-3 text-xs">
                    {'deskcomm("track","page_view",{screen_name:"home"});'}
                  </pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {criando ? (
        <FormularioDaChave pendente={criar.isPending} erro={erro} onCriar={criarChave} onCancelar={() => { setCriando(false); setErro(null); }} />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => { setErro(null); setCriando(true); }} data-testid="nova-chave">
          <Plus size={14} aria-hidden /> {t("Criar chave do rastreador")}
        </Button>
      )}
    </div>
  );
}
