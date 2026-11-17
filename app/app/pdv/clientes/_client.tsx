"use client";
/**
 * Busca de cliente do PDV: seletor Telefone/Nome/CPF, campo com máscara, botão "Buscar" (ou Enter)
 * e a lista de candidatos que `GET /api/v1/pdv/clientes` devolve.
 *
 * LGPD: o termo digitado (que pode ser CPF ou telefone) vive só em estado de componente. Nunca vai
 * para a URL do navegador, para `localStorage` nem para log. Abrir a ficha de um candidato é da
 * US-016: nesta tela a lista é só de exibição.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { isValidCpf } from "@/lib/legal/perfil-do-pais";

type Modo = "telefone" | "nome" | "cpf";

type Candidato = { id: string; nome: string; endereco_principal: string | null };
type Resposta = { data: { clientes: Candidato[]; total_encontrado: number; truncado: boolean } };

type Busca = { modo: Modo; termo: string };

function soDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/** Máscara conforme o modo: `(00) 00000-0000`, `000.000.000-00`, ou texto livre em "nome". */
function mascarar(modo: Modo, v: string): string {
  if (modo === "nome") return v;
  const d = soDigitos(v).slice(0, 11);
  if (modo === "cpf") {
    const [a, b, c, e] = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9, 11)];
    return [a, b && `.${b}`, c && `.${c}`, e && `-${e}`].filter(Boolean).join("");
  }
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  const corte = resto.length > 8 ? 5 : 4;
  const fim = resto.slice(corte);
  return `(${ddd}) ${resto.slice(0, corte)}${fim ? `-${fim}` : ""}`;
}

export function IdentificarCliente() {
  const t = useT();
  const [modo, setModo] = useState<Modo>("telefone");
  const [valor, setValor] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState<Busca | null>(null);

  const resultado = useQuery({
    queryKey: ["pdv", "clientes", busca?.modo, busca?.termo],
    queryFn: async () => {
      const b = busca!;
      const q = new URLSearchParams({ modo: b.modo, q: b.termo });
      return (await apiClient.get<Resposta>(`/api/v1/pdv/clientes?${q.toString()}`)).data;
    },
    enabled: busca !== null,
    retry: false,
    // O termo pode ser CPF/telefone: não fica em cache além do uso.
    gcTime: 0,
    staleTime: 0,
  });

  function validar(): string | null {
    const termo = valor.trim();
    if (!termo) return t("Digite algo para buscar");
    if (modo === "telefone" && soDigitos(termo).length < 10) return t("Informe o telefone com DDD");
    if (modo === "cpf" && !isValidCpf(termo)) return t("CPF inválido");
    return null;
  }

  function buscar(e?: FormEvent) {
    e?.preventDefault();
    const erro = validar();
    setAviso(erro);
    if (erro) return;
    const termo = modo === "nome" ? valor.trim() : soDigitos(valor);
    // Mesma busca repetida = nova consulta.
    if (busca && busca.modo === modo && busca.termo === termo) void resultado.refetch();
    else setBusca({ modo, termo });
  }

  function trocarModo(novo: string) {
    setModo(novo as Modo);
    setValor("");
    setAviso(null);
    setBusca(null);
  }

  const carregando = busca !== null && resultado.isFetching;
  const idCampo = "pdv-busca-termo";

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <form onSubmit={buscar} className="flex flex-col gap-2" noValidate>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="pdv-busca-modo">
              {t("Buscar por")}
            </label>
            <Select value={modo} onValueChange={trocarModo}>
              <SelectTrigger id="pdv-busca-modo" data-testid="busca-modo" className="h-11 w-full sm:w-40 lg:h-11 lg:min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="telefone">{t("Telefone")}</SelectItem>
                <SelectItem value="nome">{t("Nome")}</SelectItem>
                <SelectItem value="cpf">{t("CPF")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label className="text-sm font-medium" htmlFor={idCampo}>
              {modo === "telefone" ? t("Telefone") : modo === "nome" ? t("Nome") : t("CPF")}
            </label>
            <Input
              id={idCampo}
              data-testid="busca-termo"
              className="h-11 lg:h-11 lg:min-h-11"
              inputMode={modo === "nome" ? "text" : "numeric"}
              autoComplete="off"
              maxLength={modo === "nome" ? 100 : 16}
              placeholder={modo === "telefone" ? t("Digite o telefone") : modo === "nome" ? t("Digite o nome") : t("Digite o CPF")}
              value={valor}
              aria-invalid={aviso ? true : undefined}
              aria-describedby={aviso ? "pdv-busca-aviso" : undefined}
              onChange={(e) => {
                setValor(mascarar(modo, e.target.value));
                if (aviso) setAviso(null);
              }}
            />
          </div>
          <Button type="submit" data-testid="busca-buscar" className="h-11 lg:h-11" disabled={carregando}>
            {t("Buscar")}
          </Button>
        </div>
        {aviso ? (
          <p id="pdv-busca-aviso" data-testid="busca-aviso" role="alert" className="text-sm text-danger">
            {aviso}
          </p>
        ) : null}
      </form>

      <Resultados
        busca={busca}
        carregando={carregando && !resultado.data}
        erro={resultado.isError ? resultado.error : null}
        dados={resultado.isError ? undefined : resultado.data}
        onTentar={() => void resultado.refetch()}
      />
    </div>
  );
}

function Resultados({
  busca,
  carregando,
  erro,
  dados,
  onTentar,
}: {
  busca: Busca | null;
  carregando: boolean;
  erro: Error | null;
  dados: { clientes: Candidato[]; total_encontrado: number; truncado: boolean } | undefined;
  onTentar: () => void;
}) {
  const t = useT();

  if (busca === null) {
    return (
      <p data-testid="resultados-inicial" className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">
        {t("Digite um telefone, nome ou CPF para buscar o cliente")}
      </p>
    );
  }

  if (carregando) {
    return (
      <div className="flex flex-col gap-2" data-testid="resultados-carregando" role="status" aria-label={t("Buscando o cliente")}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (erro) {
    const semErp = erro instanceof ApiError && erro.code === "erp_nao_configurado";
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border border-border p-4" data-testid="resultados-erro" role="alert">
        <p className="text-sm text-danger">
          {semErp
            ? t("O ERP ainda não está configurado. Avise o dono da instalação.")
            : t("Não foi possível buscar o cliente agora.")}
        </p>
        {semErp ? null : (
          <Button variant="outline" className="h-11 lg:h-11" onClick={onTentar}>
            {t("Tentar de novo")}
          </Button>
        )}
      </div>
    );
  }

  if (!dados) return null;

  if (dados.clientes.length === 0) {
    return (
      <p data-testid="resultados-vazio" className="rounded-md border border-border p-4 text-sm">
        {t("Nenhum cliente encontrado para")} &ldquo;{busca.modo === "nome" ? busca.termo : mascarar(busca.modo, busca.termo)}&rdquo;.
      </p>
    );
  }

  const n = dados.clientes.length;
  return (
    <section className="flex flex-col gap-2" data-testid="resultados">
      <p className="text-sm text-text-muted" data-testid="resultados-contagem">
        {n === 1 ? t("1 cliente encontrado") : `${n} ${t("clientes encontrados")}`}
        {dados.truncado ? ` — ${t("mostrando os primeiros; refine a busca")}` : ""}
      </p>
      <ul className="flex flex-col gap-2" data-testid="resultados-lista">
        {dados.clientes.map((c) => (
          <li
            key={c.id}
            data-testid={`cliente-${c.id}`}
            className="flex min-h-14 min-w-0 flex-col justify-center rounded-md border border-border bg-bg px-4 py-2"
          >
            <span className="truncate font-semibold">{c.nome}</span>
            <span className="truncate text-sm text-text-muted">{c.endereco_principal ?? t("Sem endereço cadastrado")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
