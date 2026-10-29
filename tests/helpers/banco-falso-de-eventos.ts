/**
 * Dublê mínimo do cliente do Supabase para as rotas e operações de eventos do funil.
 *
 * Ele APLICA os filtros de verdade (`eq`, `gte`, `in`), a ordenação, o teto, a contagem exata e o caminho em JSON
 * (`payload->>event`) ou em junção (`lead.pipeline_id`). Um dublê que devolve linha fixa faria o teste de outra
 * organização passar mesmo com o `eq("organization_id", …)` apagado da rota: mediria o dublê, não o código.
 */
export type Linha = Record<string, unknown>;

/** Lê o valor de uma coluna, entrando no JSON (`payload->>event`) ou na junção (`lead.pipeline_id`). */
export function valorDa(l: Linha, coluna: string): unknown {
  const json = coluna.split("->>");
  if (json.length === 2) return (l[json[0]!] as Linha | undefined)?.[json[1]!];
  let atual: unknown = l;
  for (const parte of coluna.split(".")) {
    if (atual === null || typeof atual !== "object") return undefined;
    atual = (atual as Linha)[parte];
  }
  return atual;
}

export interface Chamada {
  tabela: string;
  operacao: "select" | "insert" | "update" | "delete";
  filtros: Array<[string, unknown]>;
  valores?: unknown;
}

export interface OpcoesDoBancoFalso {
  /** Simula uma falha do banco numa tabela e operação. */
  erroEm?: (tabela: string, operacao: Chamada["operacao"]) => { code?: string; message: string } | null;
}

export function criarBancoFalso(tabelas: Record<string, Linha[]>, opcoes: OpcoesDoBancoFalso = {}) {
  const chamadas: Chamada[] = [];

  function from(tabela: string) {
    const filtros: Array<[string, unknown]> = [];
    const maiorOuIgual: Array<[string, string]> = [];
    let emIn: [string, unknown[]] | null = null;
    let ordem: { coluna: string; crescente: boolean } | null = null;
    let teto: number | null = null;
    let contar = false;
    let operacao: Chamada["operacao"] = "select";
    let valores: unknown;

    const casam = () =>
      (tabelas[tabela] ??= []).filter(
        (l) =>
          filtros.every(([c, v]) => valorDa(l, c) === v) &&
          maiorOuIgual.every(([c, v]) => String(valorDa(l, c)) >= v) &&
          (!emIn || emIn[1].includes(valorDa(l, emIn[0]))),
      );

    function executar(): { data: Linha[] | null; error: { code?: string; message: string } | null; count: number | null } {
      chamadas.push({ tabela, operacao, filtros: [...filtros], valores });
      const erro = opcoes.erroEm?.(tabela, operacao) ?? null;
      if (erro) return { data: null, error: erro, count: null };
      if (operacao === "insert") {
        const novas = (Array.isArray(valores) ? valores : [valores]) as Linha[];
        const gravadas = novas.map((n) => ({ id: `novo-${(tabelas[tabela] ??= []).length + 1}`, ...n }));
        tabelas[tabela]!.push(...gravadas);
        return { data: gravadas.map((l) => ({ ...l })), error: null, count: null };
      }
      if (operacao === "update") {
        const alvo = casam();
        for (const l of alvo) Object.assign(l, valores as Linha);
        return { data: alvo.map((l) => ({ ...l })), error: null, count: null };
      }
      if (operacao === "delete") {
        const alvo = casam();
        tabelas[tabela] = (tabelas[tabela] ?? []).filter((l) => !alvo.includes(l));
        return { data: alvo, error: null, count: null };
      }
      let linhas = [...casam()];
      const total = linhas.length;
      if (ordem) {
        const { coluna, crescente } = ordem;
        linhas.sort((a, b) => {
          const x = String(valorDa(a, coluna)), y = String(valorDa(b, coluna));
          return (x < y ? -1 : x > y ? 1 : 0) * (crescente ? 1 : -1);
        });
      }
      if (teto !== null) linhas = linhas.slice(0, teto);
      // Cópias, como o banco real: quem lê não segura uma referência que o UPDATE seguinte altera.
      return { data: linhas.map((l) => ({ ...l })), error: null, count: contar ? total : null };
    }

    const b = {
      select: (_colunas?: string, opts?: { count?: string }) => {
        contar = opts?.count === "exact";
        return b;
      },
      insert: (v: unknown) => {
        operacao = "insert";
        valores = v;
        return b;
      },
      update: (v: unknown) => {
        operacao = "update";
        valores = v;
        return b;
      },
      delete: () => {
        operacao = "delete";
        return b;
      },
      eq: (c: string, v: unknown) => {
        filtros.push([c, v]);
        return b;
      },
      gte: (c: string, v: string) => {
        maiorOuIgual.push([c, v]);
        return b;
      },
      in: (c: string, v: unknown[]) => {
        emIn = [c, v];
        return b;
      },
      order: (coluna: string, o?: { ascending?: boolean }) => {
        ordem = { coluna, crescente: o?.ascending !== false };
        return b;
      },
      limit: (n: number) => {
        teto = n;
        return b;
      },
      maybeSingle: async () => {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error ?? (r.data?.length ? null : { message: "sem linha" }) };
      },
      then: (resolve: (v: unknown) => unknown, rejeitar?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(resolve, rejeitar),
    };
    return b;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dublê mínimo do SupabaseClient
  return { client: { from } as any, chamadas, tabelas };
}
