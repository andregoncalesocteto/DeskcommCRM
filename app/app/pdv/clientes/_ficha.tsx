"use client";
/**
 * Ficha do cliente do PDV: blocos "Vínculo com o CRM", "Dados pessoais" e "Endereços (N)" de
 * `GET /api/v1/pdv/clientes/{id}`. Abrir a ficha só LÊ; o atendente liga o cliente ao contato do CRM
 * (pelo telefone) com "Vincular ao CRM" e puxa os dados do ERP com "Atualizar dados" (ADR-007).
 *
 * LGPD: CPF e data de nascimento vivem só no estado do react-query desta tela (`gcTime: 0`). Nunca
 * vão para URL, storage nem log; o CPF é exibido mascarado (`mascaraCpf`, quatro últimos dígitos).
 * Sem botão de editar, adicionar, remover, tornar principal ou selecionar: isso é de outras histórias
 * (edição de endereço depende da fatia E2 do ERP).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { mascaraCpf } from "@/lib/lgpd/mask";

type Endereco = {
  id: string;
  cep: string;
  uf: string;
  cidade: string;
  bairro: string;
  endereco: string;
  complemento: string | null;
  principal: boolean;
  loja_entrega: { codigo: string; sigla: string } | null;
};

type Vinculo =
  | { estado: "vinculado"; contact_id: string; contato_nome: string }
  | { estado: "telefone_de_outro"; contato_nome: string }
  | { estado: "livre" | "sem_telefone" | "ambiguo" };

type Ficha = {
  id: string;
  vinculo: Vinculo;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpf: string | null;
  data_nascimento: string | null;
  enderecos?: Endereco[];
};

/** `1988-03-14` (ou com hora) vira `14/03/1988` sem passar por `Date`, que deslocaria o dia pelo fuso. */
function dataBr(iso: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** `13060000` ou `13060-000` vira `13060-000`; qualquer outra forma segue como veio. */
function cepBr(cep: string): string {
  const d = cep.replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
}

/** Mensagem de erro do botão: o código da API diz o que o atendente pode fazer. */
function mensagemDoErro(erro: unknown, t: (k: string) => string): string {
  const codigo = erro instanceof ApiError ? erro.code : undefined;
  if (codigo === "contato_ambiguo") {
    return t(
      "Há mais de um contato com este telefone. Peça ao gerente que una os contatos antes de continuar.",
    );
  }
  if (codigo === "telefone_de_outro_cliente") {
    return t("Este telefone já está vinculado a outro cliente do ERP.");
  }
  if (codigo === "cliente_sem_telefone") return t("Este cliente não tem telefone no ERP.");
  return t("Não foi possível concluir. Tente de novo.");
}

function VinculoComOCrm({ erpId, vinculo }: { erpId: string; vinculo: Vinculo }) {
  const t = useT();
  const qc = useQueryClient();
  const rota = `/api/v1/pdv/clientes/${encodeURIComponent(erpId)}/vinculo`;
  const depois = async (r: { data: { sem_cpf_email: boolean } }, ok: string) => {
    await qc.invalidateQueries({ queryKey: ["pdv", "cliente", erpId] });
    toast.success(ok);
    if (r.data.sem_cpf_email) {
      toast.warning(t("CPF ou e-mail já pertencem a outro contato e não foram copiados."));
    }
  };
  const vincular = useMutation({
    mutationFn: () => apiClient.post<{ data: { sem_cpf_email: boolean } }>(rota, {}),
    onSuccess: (r) => depois(r, t("Cliente vinculado ao CRM")),
  });
  const atualizar = useMutation({
    mutationFn: () => apiClient.patch<{ data: { sem_cpf_email: boolean } }>(rota, {}),
    onSuccess: (r) => depois(r, t("Dados do contato atualizados")),
  });
  const erro = vincular.error ?? atualizar.error;
  const ocupado = vincular.isPending || atualizar.isPending;

  let texto: string;
  let acao: React.ReactNode = null;
  if (vinculo.estado === "vinculado") {
    texto = `${t("Vinculado ao contato")}: ${vinculo.contato_nome}`;
    acao = (
      <Button
        variant="outline"
        className="h-11 lg:h-11"
        disabled={ocupado}
        data-testid="vinculo-atualizar"
        onClick={() => atualizar.mutate()}
      >
        {t("Atualizar dados")}
      </Button>
    );
  } else if (vinculo.estado === "livre") {
    texto = t("Este cliente ainda não está no CRM.");
    acao = (
      <Button
        className="h-11 lg:h-11"
        disabled={ocupado}
        data-testid="vinculo-vincular"
        onClick={() => vincular.mutate()}
      >
        {t("Vincular ao CRM")}
      </Button>
    );
  } else if (vinculo.estado === "telefone_de_outro") {
    texto = `${t("Este telefone já está vinculado a outro cliente do ERP")}: ${vinculo.contato_nome}`;
  } else if (vinculo.estado === "sem_telefone") {
    texto = t("Este cliente não tem telefone no ERP. Sem telefone não há como vincular ao CRM.");
  } else {
    texto = t(
      "Há mais de um contato com este telefone. Peça ao gerente que una os contatos antes de continuar.",
    );
  }
  const bloqueado = vinculo.estado !== "vinculado" && vinculo.estado !== "livre";

  return (
    <section
      className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4"
      data-testid="vinculo"
      data-estado={vinculo.estado}
    >
      <h2 className="text-base font-semibold">{t("Vínculo com o CRM")}</h2>
      <p
        className={bloqueado ? "text-danger text-sm break-words" : "text-sm break-words"}
        data-testid="vinculo-estado"
        role={bloqueado ? "alert" : undefined}
      >
        {texto}
      </p>
      {acao ? <div className="flex">{acao}</div> : null}
      {erro ? (
        <p className="text-danger text-sm" role="alert" data-testid="vinculo-erro">
          {mensagemDoErro(erro, t)}
        </p>
      ) : null}
    </section>
  );
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

  const enderecos = c.enderecos ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <VinculoComOCrm erpId={c.id} vinculo={c.vinculo} />
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
      <section
        className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-4"
        data-testid="enderecos"
      >
        <h2 className="text-base font-semibold">{`${t("Endereços")} (${enderecos.length})`}</h2>
        {enderecos.length === 0 ? (
          <p className="text-sm text-text-muted" data-testid="enderecos-vazio">
            {t("Este cliente ainda não tem endereço")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {enderecos.map((e) => (
              <li
                key={e.id}
                className="flex min-w-0 flex-col gap-1 rounded-md border border-border p-3"
                data-testid="endereco"
              >
                {e.principal ? (
                  <span
                    className="bg-muted w-fit rounded-md px-2 py-0.5 text-xs font-semibold"
                    data-testid="endereco-principal"
                  >
                    {t("Principal")}
                  </span>
                ) : null}
                <p className="font-medium break-words" data-testid="endereco-linha">
                  {e.endereco}
                </p>
                {e.complemento ? (
                  <p className="text-sm break-words" data-testid="endereco-complemento">
                    {e.complemento}
                  </p>
                ) : null}
                <p className="text-sm break-words" data-testid="endereco-cidade">
                  {`${e.bairro}, ${e.cidade}/${e.uf}`}
                </p>
                <p className="text-sm text-text-muted" data-testid="endereco-cep">
                  {`${t("CEP")} ${cepBr(e.cep)}`}
                </p>
                {e.loja_entrega ? (
                  <p className="text-sm font-semibold break-words" data-testid="endereco-loja">
                    {`${t("Loja de entrega")}: ${e.loja_entrega.sigla}`}
                  </p>
                ) : (
                  <p className="text-text-muted text-sm" data-testid="endereco-sem-loja">
                    {t("Loja de entrega ainda não definida")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
