import { describe, expect, it, vi } from "vitest";

import { hashCpf } from "@/lib/contacts/cpf";
import { ContatoEspelhoError, vincularClienteDoErp, type ClienteParaEspelho } from "./contato-espelho";

const ORG = "bcc12320-f555-4fef-8d90-38a0ac5950e0";
const OUTRA_ORG = "11111111-2222-4333-8444-555555555555";

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string } | null;

/** Banco em memória com as unicidades que o serviço usa: telefone, CPF, e-mail e o vínculo. */
function banco(opcoes: { rpcDeCpf?: boolean; aoInserirContato?: () => void } = {}) {
  const tabelas: { contacts: Linha[]; pdv_customer_links: Linha[]; [t: string]: Linha[] } = {
    contacts: [],
    pdv_customer_links: [],
  };
  const daTabela = (t: string): Linha[] => (tabelas[t] ??= []);
  const consultas: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = [];
  let seq = 0;

  const viola = (tabela: string, nova: Linha): boolean => {
    const mesmaOrg = daTabela(tabela).filter((l) => l.organization_id === nova.organization_id);
    if (tabela === "pdv_customer_links") {
      return mesmaOrg.some(
        (l) => l.erp_customer_id === nova.erp_customer_id || l.contact_id === nova.contact_id,
      );
    }
    return mesmaOrg.some(
      (l) =>
        (nova.phone_number && l.phone_number === nova.phone_number) ||
        (nova.cpf_hash && l.cpf_hash === nova.cpf_hash) ||
        (nova.email &&
          typeof l.email === "string" &&
          l.email.toLowerCase() === String(nova.email).toLowerCase()),
    );
  };

  function from(tabela: string) {
    const filtros: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const nulos: string[] = [];
    let modo: "select" | "insert" | "delete" = "select";
    let novo: Linha | null = null;

    const casa = (l: Linha) =>
      filtros.every(([c, v]) => {
        const valor = c === "email_normalized" ? String(l.email ?? "").toLowerCase() : l[c];
        return c === "email_normalized" ? valor === v : valor === v;
      }) &&
      ins.every(([c, vs]) => vs.includes(l[c])) &&
      nulos.every((c) => l[c] == null) &&
      (tabela !== "contacts" || filtros.every(([c, v]) => c !== "kind" || v === "person"));

    const executar = async (): Promise<{ data: unknown; error: Erro }> => {
      if (modo !== "insert") consultas.push({ tabela, filtros: [...filtros] });
      if (modo === "insert" && novo) {
        opcoes.aoInserirContato?.();
        if (viola(tabela, novo)) return { data: null, error: { code: "23505", message: "dup" } };
        const linha = { id: `id-${++seq}`, ...(tabela === "contacts" ? { kind: "person", is_merged_into: null } : {}), ...novo };
        daTabela(tabela).push(linha);
        return { data: linha, error: null };
      }
      if (modo === "delete") {
        tabelas[tabela] = daTabela(tabela).filter((l) => !casa(l));
        return { data: null, error: null };
      }
      return { data: daTabela(tabela).filter(casa), error: null };
    };

    const cadeia: Record<string, unknown> = {
      select: () => cadeia,
      eq: (c: string, v: unknown) => (filtros.push([c, v]), cadeia),
      is: (c: string) => (nulos.push(c), cadeia),
      in: (c: string, vs: unknown[]) => (ins.push([c, vs]), cadeia),
      insert: (linha: Linha) => ((modo = "insert"), (novo = linha), cadeia),
      delete: () => ((modo = "delete"), cadeia),
      single: async () => {
        const r = await executar();
        return Array.isArray(r.data) ? { data: r.data[0] ?? null, error: r.error } : r;
      },
      maybeSingle: async () => {
        const r = await executar();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => executar().then(ok, ko),
    };
    return cadeia;
  }

  const cliente = {
    from,
    rpc: async () =>
      opcoes.rpcDeCpf === false ? { data: null, error: { message: "sem rpc" } } : { data: new Uint8Array([1, 2, 3]), error: null },
  };
  return { tabelas, consultas, supabase: cliente as never };
}

const CLIENTE: ClienteParaEspelho = {
  id: "c-0001",
  nome: "Maria Teste",
  telefone: "+5519998765432",
  email: "Maria@Exemplo.test",
  cpf: "529.982.247-25",
  data_nascimento: "1990-05-17",
};

function primeira(linhas: Linha[]): Linha {
  const l = linhas[0];
  if (!l) throw new Error("tabela vazia");
  return l;
}

function contatoExistente(extra: Linha): Linha {
  return { id: "existente", organization_id: ORG, kind: "person", is_merged_into: null, ...extra };
}

describe("vincularClienteDoErp", () => {
  it("cria o contato e o vínculo quando ninguém casa", async () => {
    const { tabelas, supabase } = banco();
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toMatchObject({ contatoCriado: true, vinculoNovo: true });
    expect(tabelas.contacts).toHaveLength(1);
    expect(primeira(tabelas.contacts)).toMatchObject({
      organization_id: ORG,
      name: "Maria Teste",
      phone_number: "+5519998765432",
      email: "Maria@Exemplo.test",
      birthdate: "1990-05-17",
      source: "pdv",
    });
    expect(primeira(tabelas.pdv_customer_links)).toMatchObject({
      organization_id: ORG,
      contact_id: r.contactId,
      erp_customer_id: "c-0001",
    });
  });

  it("grava o CPF cifrado com o hash, nunca em claro", async () => {
    const { tabelas, supabase } = banco();
    await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    const linha = primeira(tabelas.contacts);
    expect(linha.cpf_hash).toBe(hashCpf("52998224725"));
    expect(linha.cpf_encrypted).toBeInstanceOf(Uint8Array);
    expect(JSON.stringify(linha)).not.toContain("52998224725");
  });

  it("sem cifra disponível, cria o contato sem CPF (os dois campos ou nenhum)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { tabelas, supabase } = banco({ rpcDeCpf: false });
    await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    aviso.mockRestore();
    expect(primeira(tabelas.contacts).cpf_hash).toBeUndefined();
    expect(primeira(tabelas.contacts).cpf_encrypted).toBeUndefined();
  });

  it("acha por telefone, também na variante sem o nono dígito, e só vincula", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ phone_number: "+551998765432" }));
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toEqual({ contactId: "existente", contatoCriado: false, vinculoNovo: true });
    expect(tabelas.contacts).toHaveLength(1);
    expect(primeira(tabelas.contacts).name).toBeUndefined();
  });

  it("acha por hash do CPF", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ cpf_hash: hashCpf("52998224725") }));
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toMatchObject({ contactId: "existente", contatoCriado: false, vinculoNovo: true });
  });

  it("acha por e-mail, sem diferenciar caixa", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ email: "maria@exemplo.TEST" }));
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toMatchObject({ contactId: "existente", contatoCriado: false, vinculoNovo: true });
  });

  it("vínculo já existente é devolvido sem alterar nada", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "ja" }));
    tabelas.pdv_customer_links.push({ organization_id: ORG, contact_id: "ja", erp_customer_id: "c-0001" });
    const antes = JSON.stringify(tabelas);
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toEqual({ contactId: "ja", contatoCriado: false, vinculoNovo: false });
    expect(JSON.stringify(tabelas)).toBe(antes);
  });

  it("duas chamadas em sequência para o mesmo cliente dão um contato e um vínculo", async () => {
    const { tabelas, supabase } = banco();
    const a = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    const b = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(b.contactId).toBe(a.contactId);
    expect(b).toMatchObject({ contatoCriado: false, vinculoNovo: false });
    expect(tabelas.contacts).toHaveLength(1);
    expect(tabelas.pdv_customer_links).toHaveLength(1);
  });

  it("duas chamadas simultâneas: o 23505 leva ao contato do vencedor, sem duplicar", async () => {
    const { tabelas, supabase } = banco();
    const [a, b] = await Promise.all([
      vincularClienteDoErp(ORG, CLIENTE, { supabase }),
      vincularClienteDoErp(ORG, CLIENTE, { supabase }),
    ]);
    expect(b.contactId).toBe(a.contactId);
    expect(tabelas.contacts).toHaveLength(1);
    expect(tabelas.pdv_customer_links).toHaveLength(1);
    expect([a.vinculoNovo, b.vinculoNovo].filter(Boolean)).toHaveLength(1);
  });

  it("corrida sem telefone, CPF nem e-mail: o contato órfão da perdedora é removido", async () => {
    const { tabelas, supabase } = banco();
    const semDados = { id: "c-9", nome: "Sem Dados", telefone: null, email: null };
    const [a, b] = await Promise.all([
      vincularClienteDoErp(ORG, semDados, { supabase }),
      vincularClienteDoErp(ORG, semDados, { supabase }),
    ]);
    expect(b.contactId).toBe(a.contactId);
    expect(tabelas.contacts).toHaveLength(1);
    expect(tabelas.pdv_customer_links).toHaveLength(1);
  });

  it("23505 no INSERT do contato (o concorrente grava no meio) leva ao contato que já existe", async () => {
    let tabelasRef: { contacts: Linha[] } | null = null;
    let jaApareceu = false;
    const { tabelas, supabase } = banco({
      aoInserirContato: () => {
        if (jaApareceu || !tabelasRef) return;
        jaApareceu = true;
        tabelasRef.contacts.push(contatoExistente({ phone_number: "+5519998765432" }));
      },
    });
    tabelasRef = tabelas;
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toMatchObject({ contactId: "existente", contatoCriado: false, vinculoNovo: true });
    expect(tabelas.contacts).toHaveLength(1);
  });

  it("mais de um candidato: não vincula nenhum e lança contato_ambiguo", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "a", phone_number: "+5519998765432" }),
      contatoExistente({ id: "b", cpf_hash: hashCpf("52998224725") }),
    );
    const erro = await vincularClienteDoErp(ORG, CLIENTE, { supabase }).catch((e) => e);
    expect(erro).toBeInstanceOf(ContatoEspelhoError);
    expect(erro.codigo).toBe("contato_ambiguo");
    expect(tabelas.pdv_customer_links).toHaveLength(0);
    expect(tabelas.contacts).toHaveLength(2);
  });

  it("contato já ligado a OUTRO cliente do ERP: contato_ambiguo, o vínculo não é roubado", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "a", phone_number: "+5519998765432" }));
    tabelas.pdv_customer_links.push({ organization_id: ORG, contact_id: "a", erp_customer_id: "c-OUTRO" });
    const erro = await vincularClienteDoErp(ORG, CLIENTE, { supabase }).catch((e) => e);
    expect(erro).toMatchObject({ codigo: "contato_ambiguo", detalhes: { motivo: "contato_de_outro_cliente" } });
    expect(tabelas.pdv_customer_links).toHaveLength(1);
  });

  it("isolamento: contato de outra organização não casa, e toda consulta filtra a organização", async () => {
    const { tabelas, consultas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "x", organization_id: OUTRA_ORG, phone_number: "+5519998765432" }),
    );
    // o filtro de org das consultas impede o casamento; a unicidade do falso é por organização
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r.contatoCriado).toBe(true);
    expect(r.contactId).not.toBe("x");
    expect(consultas.length).toBeGreaterThan(0);
    for (const c of consultas) {
      expect(c.filtros.find(([col]) => col === "organization_id")?.[1]).toBe(ORG);
    }
  });

  it("ignora e-mail, telefone e data fora do formato que o banco aceita", async () => {
    const { tabelas, supabase } = banco();
    await vincularClienteDoErp(
      ORG,
      { id: "c-5", nome: "Ana", telefone: "123", email: "sem-arroba", data_nascimento: "17/05/1990", cpf: "123" },
      { supabase },
    );
    expect(primeira(tabelas.contacts)).toMatchObject({ phone_number: null, email: null, birthdate: null });
    expect(primeira(tabelas.contacts).cpf_hash).toBeUndefined();
  });

  it("dado pessoal não aparece em log nem na mensagem do erro", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map((n) =>
      vi.spyOn(console, n).mockImplementation(() => {}),
    );
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "a", phone_number: "+5519998765432" }),
      contatoExistente({ id: "b", cpf_hash: hashCpf("52998224725") }),
    );
    const erro = (await vincularClienteDoErp(ORG, CLIENTE, { supabase }).catch((e) => e)) as Error;
    const saida = JSON.stringify(espioes.flatMap((e) => e.mock.calls)) + erro.message + JSON.stringify(erro);
    espioes.forEach((e) => e.mockRestore());
    for (const segredo of ["52998224725", "529.982.247-25", "998765432", "maria@exemplo", "Maria Teste"]) {
      expect(saida.toLowerCase()).not.toContain(segredo.toLowerCase());
    }
  });
});
