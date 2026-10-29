"use client";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useAgentMapping, type EtapaDoFunil } from "@/hooks/pipelines/useAgentMapping";
import {
  useCriarEvento,
  useDesativarEvento,
  useEditarEvento,
  useEventosDoFunil,
  type CorpoDoEvento,
  type EventoDoFunil,
} from "@/hooks/pipelines/useEventosDoFunil";
import { ArrowRight, Plus, Warning } from "@/lib/ui/icons";
import { mensagemDeErro } from "./_mapping";

/**
 * Onde o gerente cadastra o que um sistema de fora (um cardápio digital, uma agenda online) pode contar ao CRM e
 * para onde o card vai em cada fato. Fica logo abaixo de "Para onde o card vai em cada passo": aquela é do assistente;
 * esta é de quem integra.
 *
 * Nada nasce cadastrado: cada funil declara os seus eventos à mão. O texto da tela é de quem usa — sem os nomes de
 * coluna do banco —, e a chave é o único dado técnico, porque é o que o outro sistema precisa enviar.
 */

/** Sentinela do «não mover»: o Radix Select proíbe item com valor vazio. */
const SEM_ETAPA = "__sem_etapa__";
const FORMA_DA_CHAVE = /^[a-z][a-z0-9_]{0,63}$/;
const FORMA_DO_CAMINHO = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export const ancoraDosEventos = (pipelineId: string) => `eventos-${pipelineId}`;

/**
 * O que merece atenção num evento já cadastrado. Avisos NÃO bloqueiam: são o laço de retorno de quem configura.
 *  • fecha a venda sem dizer o valor: a venda não chegaria como conversão de anúncio;
 *  • etapa de destino arquivada: o evento passa a só registrar;
 *  • dois eventos ativos guardando no mesmo lugar: o último que chegar sobrescreve o outro.
 */
export function avisosDoEvento(
  e: EventoDoFunil,
  todos: readonly EventoDoFunil[],
  etapas: readonly EtapaDoFunil[],
  t: (s: string) => string = (s) => s,
): string[] {
  if (!e.is_active) return [];
  const avisos: string[] = [];
  const destino = e.stage_id ? etapas.find((x) => x.id === e.stage_id) : undefined;
  if (e.stage_id && !destino) {
    avisos.push(t("A etapa de destino foi arquivada, então este evento só registra e não move mais o card."));
  }
  if (destino?.is_won && !e.value_path) {
    avisos.push(t("Esta etapa fecha a venda, mas o evento não define o valor, então a venda não será enviada como conversão."));
  }
  if (e.state_key) {
    const outros = todos.filter((o) => o.id !== e.id && o.is_active && o.state_key === e.state_key);
    for (const o of outros) {
      avisos.push(`${t("O evento")} «${o.label}» ${t("guarda o conteúdo no mesmo lugar: o último que chegar sobrescreve o outro.")}`);
    }
  }
  return avisos;
}

/** "Visto pela última vez…" ou, sem nenhum registro, a frase que diz isso. */
export function usoDoEvento(e: EventoDoFunil, t: (s: string) => string, tagDeIdioma: string): string {
  if (!e.ultimo_recebimento) return t("Ainda não recebeu nada.");
  const quando = new Date(e.ultimo_recebimento).toLocaleString(tagDeIdioma, { dateStyle: "short", timeStyle: "short" });
  return `${t("Visto pela última vez em")} ${quando} · ${e.recebidos_7_dias} ${t("nos últimos 7 dias")}`;
}

interface Campos {
  label: string;
  key: string;
  stage_id: string;
  respects_manual_move: boolean;
  state_key: string;
  value_path: string;
  value_unit: "reais" | "centavos";
  dedupe_path: string;
}

const VAZIO: Campos = {
  label: "",
  key: "",
  stage_id: SEM_ETAPA,
  respects_manual_move: true,
  state_key: "",
  value_path: "",
  value_unit: "reais",
  dedupe_path: "",
};

function camposDe(e: EventoDoFunil): Campos {
  return {
    label: e.label,
    key: e.key,
    stage_id: e.stage_id ?? SEM_ETAPA,
    respects_manual_move: e.respects_manual_move,
    state_key: e.state_key ?? "",
    value_path: e.value_path ?? "",
    value_unit: e.value_unit ?? "reais",
    dedupe_path: e.dedupe_path ?? "",
  };
}

const nulo = (v: string) => (v.trim() === "" ? null : v.trim());

/** Traduz os campos da tela para o corpo da API. `null` é "sem isto"; o par do valor vai junto ou nenhum dos dois. */
export function corpoDosCampos(c: Campos): CorpoDoEvento {
  const caminho = nulo(c.value_path);
  return {
    key: c.key.trim(),
    label: c.label.trim(),
    stage_id: c.stage_id === SEM_ETAPA ? null : c.stage_id,
    respects_manual_move: c.respects_manual_move,
    state_key: nulo(c.state_key),
    value_path: caminho,
    value_unit: caminho === null ? null : c.value_unit,
    dedupe_path: nulo(c.dedupe_path),
  };
}

/** Só o que mudou em relação ao que está gravado: a edição manda um delta, e reenviar igual é no-op no servidor. */
export function deltaDosCampos(atual: EventoDoFunil, c: Campos): CorpoDoEvento {
  const novo = corpoDosCampos(c) as Record<string, unknown>;
  const antes = atual as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.entries(novo).filter(([campo, valor]) => antes[campo] !== valor)) as CorpoDoEvento;
}

/** O que a tela confere antes de enviar; o servidor repete a conferência e é quem manda. */
export function problemaDosCampos(
  c: Campos,
  t: (s: string) => string = (s) => s,
  camposDaFicha: readonly string[] = [],
): string | null {
  if (c.label.trim() === "") return t("Dê um nome ao evento.");
  if (!FORMA_DA_CHAVE.test(c.key.trim())) {
    return t("A chave usa minúsculas, números e _, começa por letra e tem até 64 caracteres.");
  }
  // "Guardar em" é um nome simples (uma chave do pedido), não um caminho: tem a mensagem própria e vem antes.
  if (c.state_key.trim() !== "" && !FORMA_DA_CHAVE.test(c.state_key.trim())) {
    return t("Guardar em: minúsculas, números e _, começando por letra.");
  }
  // Bloqueia: guardar o evento numa chave que já é campo da ficha sobrescreveria o que a equipe edita à mão.
  if (c.state_key.trim() !== "" && camposDaFicha.includes(c.state_key.trim())) {
    return `«${c.state_key.trim()}» ${t("já é um campo da ficha deste funil: escolha outro nome para guardar o conteúdo do evento.")}`;
  }
  for (const caminho of [c.value_path, c.dedupe_path]) {
    if (caminho.trim() !== "" && !FORMA_DO_CAMINHO.test(caminho.trim())) {
      return t("Use só nomes de campo separados por ponto, como pedido.total.");
    }
  }
  return null;
}

function FormularioDoEvento({
  inicial,
  etapas,
  chaveTrancada,
  camposDaFicha,
  pendente,
  erro,
  onSalvar,
  onCancelar,
  idBase,
}: {
  inicial: Campos;
  etapas: EtapaDoFunil[];
  chaveTrancada: boolean;
  camposDaFicha: readonly string[];
  pendente: boolean;
  erro: string | null;
  onSalvar: (c: Campos) => void;
  onCancelar: () => void;
  idBase: string;
}) {
  const t = useT();
  const [c, setC] = useState<Campos>(inicial);
  const [avancado, setAvancado] = useState(
    inicial.state_key !== "" || inicial.value_path !== "" || inicial.dedupe_path !== "" || !inicial.respects_manual_move,
  );
  const mudar = <K extends keyof Campos>(campo: K, valor: Campos[K]) => setC((a) => ({ ...a, [campo]: valor }));
  const problema = problemaDosCampos(c, t, camposDaFicha);

  return (
    <div className="space-y-4 rounded-md border border-border bg-surface-2 p-4" data-testid={`form-${idBase}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-nome`}>{t("Nome do evento")}</Label>
          <Input id={`${idBase}-nome`} value={c.label} maxLength={80} onChange={(e) => mudar("label", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-chave`}>{t("Chave que o outro sistema envia")}</Label>
          <Input
            id={`${idBase}-chave`}
            className="font-mono"
            value={c.key}
            maxLength={64}
            disabled={chaveTrancada}
            onChange={(e) => mudar("key", e.target.value)}
          />
          <p className="text-xs text-text-muted">
            {chaveTrancada
              ? t("Este evento já recebeu registros, então a chave não pode mais mudar.")
              : t("Minúsculas, números e _ (por exemplo, compra_concluida). Depois do primeiro registro ela não muda.")}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idBase}-etapa`}>{t("Para onde o card vai quando o evento chega")}</Label>
        <Select value={c.stage_id} onValueChange={(v) => mudar("stage_id", v)}>
          <SelectTrigger id={`${idBase}-etapa`} data-testid={`${idBase}-etapa`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_ETAPA}>{t("Não mover o card (só registrar)")}</SelectItem>
            {etapas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <button
          type="button"
          className="text-sm underline underline-offset-2"
          aria-expanded={avancado}
          onClick={() => setAvancado((v) => !v)}
          data-testid={`${idBase}-avancado`}
        >
          {avancado ? t("Esconder as opções avançadas") : t("Mostrar as opções avançadas")}
        </button>
      </div>

      {avancado && (
        <div className="space-y-4" data-testid={`${idBase}-opcoes`}>
          <div className="space-y-1.5">
            <Label htmlFor={`${idBase}-guardar`}>{t("Guardar o último conteúdo recebido em")}</Label>
            <Input id={`${idBase}-guardar`} className="font-mono" value={c.state_key} onChange={(e) => mudar("state_key", e.target.value)} />
            <p className="text-xs text-text-muted">
              {t("O pedido guarda aqui o conteúdo do evento mais recente (por exemplo, o carrinho). Não pode ter o mesmo nome de um campo da ficha.")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${idBase}-valor`}>{t("Campo do valor da venda")}</Label>
              <Input id={`${idBase}-valor`} className="font-mono" value={c.value_path} onChange={(e) => mudar("value_path", e.target.value)} />
              <p className="text-xs text-text-muted">{t("Onde o outro sistema manda o total, como value ou pedido.total.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${idBase}-unidade`}>{t("O valor vem em")}</Label>
              <Select value={c.value_unit} onValueChange={(v) => mudar("value_unit", v as Campos["value_unit"])}>
                <SelectTrigger id={`${idBase}-unidade`} disabled={c.value_path.trim() === ""}>
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
            <Label htmlFor={`${idBase}-repeticao`}>{t("Reconhecer o mesmo fato por")}</Label>
            <Input id={`${idBase}-repeticao`} className="font-mono" value={c.dedupe_path} onChange={(e) => mudar("dedupe_path", e.target.value)} />
            <p className="text-xs text-text-muted">
              {t("Se dois eventos trazem o mesmo valor neste campo (por exemplo, o número do pedido), o segundo conta como repetição.")}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id={`${idBase}-manual`}
              checked={c.respects_manual_move}
              onCheckedChange={(v) => mudar("respects_manual_move", v)}
            />
            <div>
              <Label htmlFor={`${idBase}-manual`}>{t("Respeitar o que a equipe moveu à mão")}</Label>
              <p className="text-xs text-text-muted">
                {t("Ligado: se uma pessoa moveu o card por último, o evento é registrado mas não move. Desligue em eventos que devem fechar mesmo assim, como a compra.")}
              </p>
            </div>
          </div>
        </div>
      )}

      {(erro || problema) && (
        <Card className="flex items-start gap-3 border-warning bg-warning-bg p-3" data-testid={`${idBase}-erro`}>
          <Warning size={16} className="mt-0.5 shrink-0 text-warning-fg" aria-hidden />
          <p className="text-sm">{erro ?? problema}</p>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancelar}>
          {t("Cancelar")}
        </Button>
        <Button type="button" size="sm" disabled={!!problema || pendente} onClick={() => onSalvar(c)} data-testid={`${idBase}-salvar`}>
          {pendente ? t("Salvando…") : t("Salvar evento")}
        </Button>
      </div>
    </div>
  );
}

export function EventosDoFunilSection({
  pipelineId,
  camposDaFicha = [],
}: {
  pipelineId: string;
  /** As chaves dos campos declarados da ficha deste funil: o "guardar em" não pode ser uma delas. */
  camposDaFicha?: readonly string[];
}) {
  const t = useT();
  const tagDeIdioma = useTagDeIdioma();
  const eventos = useEventosDoFunil(pipelineId);
  const funil = useAgentMapping(pipelineId);
  const criar = useCriarEvento(pipelineId);
  const editar = useEditarEvento(pipelineId);
  const desativar = useDesativarEvento(pipelineId);
  const [aberto, setAberto] = useState<string | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);

  if (eventos.isError) {
    return (
      <p className="text-sm text-text-muted" data-testid="eventos-erro-leitura">
        {t("Não foi possível carregar os eventos deste funil agora. Recarregue a página.")}
      </p>
    );
  }
  if (!eventos.data) {
    return (
      <p className="text-sm text-text-muted" data-testid="eventos-carregando">
        {t("Carregando os eventos deste funil…")}
      </p>
    );
  }

  // A rota do funil não devolve etapa arquivada: quem não está nela e ainda é destino de um evento foi arquivada.
  const todasAsEtapas = funil.data?.etapas ?? [];
  // As etapas de perda nunca são destino de evento.
  const etapas = todasAsEtapas.filter((e) => !e.is_lost);
  const nomeDaEtapa = (id: string | null) => etapas.find((e) => e.id === id)?.name ?? null;

  function aposEscrever(resposta: { avisos: string[] }, mensagem: string) {
    setAberto(null);
    setErro(null);
    setAvisos(resposta.avisos);
    toast.success(mensagem);
  }

  function salvarNovo(c: Campos) {
    setErro(null);
    criar.mutate(corpoDosCampos(c), {
      onSuccess: (r) => aposEscrever(r, t("Evento cadastrado.")),
      onError: (e) => setErro(mensagemDeErro(e, t)),
    });
  }

  function salvarEdicao(atual: EventoDoFunil, c: Campos) {
    setErro(null);
    const delta = deltaDosCampos(atual, c);
    if (Object.keys(delta).length === 0) {
      setAberto(null);
      return;
    }
    editar.mutate(
      { id: atual.id, corpo: delta },
      { onSuccess: (r) => aposEscrever(r, t("Evento atualizado.")), onError: (e) => setErro(mensagemDeErro(e, t)) },
    );
  }

  function alternar(e: EventoDoFunil) {
    setErro(null);
    if (e.is_active) {
      desativar.mutate(e.id, {
        onSuccess: () => toast.success(t("Evento desativado.")),
        onError: (x) => toast.error(mensagemDeErro(x, t)),
      });
    } else {
      editar.mutate(
        { id: e.id, corpo: { is_active: true } },
        { onSuccess: () => toast.success(t("Evento ativado.")), onError: (x) => toast.error(mensagemDeErro(x, t)) },
      );
    }
  }

  return (
    <div className="space-y-4" id={ancoraDosEventos(pipelineId)} data-testid={`eventos-${pipelineId}`}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("Para onde o card vai em cada evento")}</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-text-muted">
          {t("Um sistema de fora, como o seu cardápio digital, conta ao CRM o que o cliente fez: viu um item, montou o carrinho, comprou. Cadastre aqui cada fato e escolha para onde o card vai quando ele chegar. Fato que não está cadastrado é recusado.")}
        </p>
      </div>

      {eventos.data.length === 0 && aberto !== "novo" ? (
        <div className="rounded-md border border-dashed border-border p-4" data-testid="eventos-vazio">
          <p className="text-sm text-text-muted">
            {t("Este funil ainda não tem eventos cadastrados. Enquanto não houver, nenhum sistema de fora consegue mover os cards daqui.")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {eventos.data.map((e) => (
            <li key={e.id} className="space-y-3 p-4" data-testid={`evento-${e.key}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 sm:w-64">
                  <p className="text-sm font-medium">
                    {e.label}
                    {!e.is_active && (
                      <span className="ml-2 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted" data-testid={`desativado-${e.key}`}>
                        {t("Desativado")}
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-xs text-text-muted">{e.key}</p>
                </div>
                <ArrowRight size={16} className="hidden shrink-0 text-text-muted sm:block" aria-hidden />
                <p className="min-w-0 flex-1 text-sm" data-testid={`destino-${e.key}`}>
                  {e.stage_id
                    ? `${t("O card vai para")} «${nomeDaEtapa(e.stage_id) ?? t("uma etapa que não está mais disponível")}»`
                    : t("Só registra, não move o card")}
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => { setErro(null); setAberto(aberto === e.id ? null : e.id); }} data-testid={`editar-${e.key}`}>
                    {t("Editar")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => alternar(e)} data-testid={`alternar-${e.key}`}>
                    {e.is_active ? t("Desativar") : t("Ativar")}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-text-muted" data-testid={`uso-${e.key}`}>
                {usoDoEvento(e, t, tagDeIdioma)}
              </p>
              {avisosDoEvento(e, eventos.data, todasAsEtapas, t).map((a) => (
                <p key={a} className="flex items-start gap-2 text-xs text-warning-fg" data-testid={`aviso-${e.key}`}>
                  <Warning size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{a}</span>
                </p>
              ))}
              {aberto === e.id && (
                <FormularioDoEvento
                  idBase={`editar-${e.key}`}
                  inicial={camposDe(e)}
                  etapas={etapas}
                  chaveTrancada={e.ultimo_recebimento !== null}
                  camposDaFicha={camposDaFicha}
                  pendente={editar.isPending}
                  erro={erro}
                  onSalvar={(c) => salvarEdicao(e, c)}
                  onCancelar={() => setAberto(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {avisos.length > 0 && (
        <Card className="space-y-1 border-warning bg-warning-bg p-3" data-testid="eventos-avisos">
          {avisos.map((a) => (
            <p key={a} className="text-sm">{a}</p>
          ))}
        </Card>
      )}

      {aberto === "novo" ? (
        <FormularioDoEvento
          idBase="novo"
          inicial={VAZIO}
          etapas={etapas}
          chaveTrancada={false}
          camposDaFicha={camposDaFicha}
          pendente={criar.isPending}
          erro={erro}
          onSalvar={salvarNovo}
          onCancelar={() => setAberto(null)}
        />
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => { setErro(null); setAvisos([]); setAberto("novo"); }} data-testid="novo-evento">
          <Plus size={14} aria-hidden className="mr-1" /> {t("Cadastrar um evento")}
        </Button>
      )}
    </div>
  );
}
