import { describe, expect, it, vi } from "vitest";

import { hashCpf } from "@/lib/contacts/cpf";
import {
  atualizarContatoDoErp,
  consultarVinculo,
  ContatoEspelhoError,
  vincularClienteDoErp,
  type ClienteParaEspelho,
} from "./contato-espelho";

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
      // ADR-008: só o cliente do ERP é único; um contato pode ter várias fichas.
      return mesmaOrg.some((l) => l.erp_customer_id === nova.erp_customer_id);
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
    let modo: "select" | "insert" | "delete" | "update" = "select";
    let patch: Linha | null = null;
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
      if (modo === "update" && patch) {
        const alvos = daTabela(tabela).filter(casa);
        for (const alvo of alvos) {
          const outros = daTabela(tabela).filter(
            (l) => l !== alvo && l.organization_id === alvo.organization_id,
          );
          const novo = { ...alvo, ...patch };
          const dup = outros.some(
            (l) =>
              (novo.cpf_hash && l.cpf_hash === novo.cpf_hash) ||
              (novo.email &&
                typeof l.email === "string" &&
                l.email.toLowerCase() === String(novo.email).toLowerCase()),
          );
          if (dup) return { data: null, error: { code: "23505", message: "dup" } };
          Object.assign(alvo, patch);
        }
        return { data: null, error: null };
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
      update: (p: Linha) => ((modo = "update"), (patch = p), cadeia),
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

describe("vincularClienteDoErp (o telefone é a chave, ADR-007)", () => {
  it("cria o contato e o vínculo quando o telefone é novo", async () => {
    const { tabelas, supabase } = banco();
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toMatchObject({ contatoCriado: true, vinculoNovo: true, semCpfEmail: false, dadosAtualizados: false });
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

  it("acha por telefone, também na variante sem o nono dígito, e só vincula (não altera o contato)", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ phone_number: "+551998765432", name: "Nome do CRM" }));
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toEqual({
      contactId: "existente",
      contatoCriado: false,
      vinculoNovo: true,
      semCpfEmail: false,
      dadosAtualizados: false,
    });
    expect(tabelas.contacts).toHaveLength(1);
    expect(primeira(tabelas.contacts).name).toBe("Nome do CRM");
  });

  it("o mesmo CPF em contato de OUTRO telefone não vira candidato: cria um contato novo, sem o CPF", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "outro", phone_number: "+5511911110000", cpf_hash: hashCpf("52998224725") }),
    );
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toMatchObject({ contatoCriado: true, vinculoNovo: true, semCpfEmail: true });
    expect(r.contactId).not.toBe("outro");
    expect(tabelas.contacts).toHaveLength(2);
    const novo = tabelas.contacts.find((c) => c.id === r.contactId) as Linha;
    expect(novo.phone_number).toBe("+5519998765432");
    expect(novo.cpf_hash).toBeUndefined();
    expect(novo.email).toBeNull();
    expect(tabelas.pdv_customer_links).toHaveLength(1);
  });

  it("o mesmo e-mail em contato de OUTRO telefone também não vira candidato", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "outro", phone_number: "+5511911110000", email: "maria@exemplo.TEST" }));
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toMatchObject({ contatoCriado: true, semCpfEmail: true });
    expect(r.contactId).not.toBe("outro");
  });

  it("cliente sem telefone utilizável: cliente_sem_telefone, nada é escrito", async () => {
    const { tabelas, supabase } = banco();
    for (const telefone of [null, "123"]) {
      const erro = await vincularClienteDoErp(ORG, { ...CLIENTE, telefone }, { supabase }).catch((e) => e);
      expect(erro).toBeInstanceOf(ContatoEspelhoError);
      expect(erro.codigo).toBe("cliente_sem_telefone");
    }
    expect(tabelas.contacts).toHaveLength(0);
    expect(tabelas.pdv_customer_links).toHaveLength(0);
  });

  it("vínculo já existente é devolvido sem alterar nada (nem exige telefone)", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "ja" }));
    tabelas.pdv_customer_links.push({ organization_id: ORG, contact_id: "ja", erp_customer_id: "c-0001" });
    const antes = JSON.stringify(tabelas);
    const r = await vincularClienteDoErp(ORG, { ...CLIENTE, telefone: null }, { supabase });
    expect(r).toEqual({
      contactId: "ja",
      contatoCriado: false,
      vinculoNovo: false,
      semCpfEmail: false,
      dadosAtualizados: false,
    });
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

  it("dois contatos no mesmo número (com e sem o nono dígito): contato_ambiguo, nada é ligado", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "a", phone_number: "+5519998765432" }),
      contatoExistente({ id: "b", phone_number: "+551998765432" }),
    );
    const erro = await vincularClienteDoErp(ORG, CLIENTE, { supabase }).catch((e) => e);
    expect(erro).toBeInstanceOf(ContatoEspelhoError);
    expect(erro.codigo).toBe("contato_ambiguo");
    expect(tabelas.pdv_customer_links).toHaveLength(0);
    expect(tabelas.contacts).toHaveLength(2);
  });

  it("o contato do telefone já tem OUTRA ficha do ERP: acrescenta o vínculo e as duas fichas ficam no mesmo contato (ADR-008)", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "a", phone_number: "+5519998765432", name: "Dona do número" }));
    tabelas.pdv_customer_links.push({ organization_id: ORG, contact_id: "a", erp_customer_id: "c-OUTRO" });
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r).toMatchObject({ contactId: "a", contatoCriado: false, vinculoNovo: true, dadosAtualizados: false });
    expect(tabelas.pdv_customer_links.map((l) => l.erp_customer_id).sort()).toEqual(["c-0001", "c-OUTRO"]);
    expect(tabelas.contacts).toHaveLength(1);
    expect(primeira(tabelas.contacts).name).toBe("Dona do número");
  });

  it("sobrescrever: liga ao contato existente e o ERP sobrescreve nome, e-mail, CPF e nascimento; o telefone fica", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "a", phone_number: "+551998765432", name: "Nome antigo", email: "antigo@exemplo.test", birthdate: "1980-01-01" }),
    );
    tabelas.pdv_customer_links.push({ organization_id: ORG, contact_id: "a", erp_customer_id: "c-OUTRO" });
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase, sobrescrever: true });
    expect(r).toMatchObject({ contactId: "a", vinculoNovo: true, dadosAtualizados: true, semCpfEmail: false });
    expect(primeira(tabelas.contacts)).toMatchObject({
      name: "Maria Teste",
      email: "Maria@Exemplo.test",
      birthdate: "1990-05-17",
      phone_number: "+551998765432",
      cpf_hash: hashCpf("52998224725"),
    });
    expect(tabelas.pdv_customer_links).toHaveLength(2);
  });

  it("sobrescrever sem contato prévio: o contato nasce com os dados do ERP e não é gravado de novo", async () => {
    const { tabelas, supabase } = banco();
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase, sobrescrever: true });
    expect(r).toMatchObject({ contatoCriado: true, vinculoNovo: true, dadosAtualizados: false });
    expect(primeira(tabelas.contacts).name).toBe("Maria Teste");
  });

  it("sobrescrever com CPF que é de OUTRO contato: grava o resto e avisa com semCpfEmail", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "a", phone_number: "+5519998765432", name: "Nome antigo" }),
      contatoExistente({ id: "outro", phone_number: "+5511900000000", cpf_hash: hashCpf("52998224725") }),
    );
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase, sobrescrever: true });
    expect(r).toMatchObject({ contactId: "a", dadosAtualizados: true, semCpfEmail: true });
    expect(primeira(tabelas.contacts).name).toBe("Maria Teste");
    expect(primeira(tabelas.contacts).cpf_hash).toBeUndefined();
  });

  it("sem sobrescrever, o contato existente NÃO é alterado", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "a", phone_number: "+5519998765432", name: "Intacto", email: "intacto@exemplo.test" }));
    await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(primeira(tabelas.contacts)).toMatchObject({ name: "Intacto", email: "intacto@exemplo.test" });
  });

  it("isolamento: contato de outra organização não casa, e toda consulta filtra a organização", async () => {
    const { tabelas, consultas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "x", organization_id: OUTRA_ORG, phone_number: "+5519998765432" }),
    );
    const r = await vincularClienteDoErp(ORG, CLIENTE, { supabase });
    expect(r.contatoCriado).toBe(true);
    expect(r.contactId).not.toBe("x");
    expect(consultas.length).toBeGreaterThan(0);
    for (const c of consultas) {
      expect(c.filtros.find(([col]) => col === "organization_id")?.[1]).toBe(ORG);
    }
  });

  it("ignora e-mail, data e CPF fora do formato que o banco aceita", async () => {
    const { tabelas, supabase } = banco();
    await vincularClienteDoErp(
      ORG,
      { id: "c-5", nome: "Ana", telefone: "+5519991112222", email: "sem-arroba", data_nascimento: "17/05/1990", cpf: "123" },
      { supabase },
    );
    expect(primeira(tabelas.contacts)).toMatchObject({ email: null, birthdate: null });
    expect(primeira(tabelas.contacts).cpf_hash).toBeUndefined();
  });

  it("dado pessoal não aparece em log nem na mensagem do erro", async () => {
    const espioes = (["log", "info", "warn", "error", "debug"] as const).map((n) =>
      vi.spyOn(console, n).mockImplementation(() => {}),
    );
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(
      contatoExistente({ id: "a", phone_number: "+5519998765432" }),
      contatoExistente({ id: "b", phone_number: "+551998765432" }),
    );
    const erro = (await vincularClienteDoErp(ORG, CLIENTE, { supabase }).catch((e) => e)) as Error;
    const saida = JSON.stringify(espioes.flatMap((e) => e.mock.calls)) + erro.message + JSON.stringify(erro);
    espioes.forEach((e) => e.mockRestore());
    for (const segredo of ["52998224725", "529.982.247-25", "998765432", "maria@exemplo", "Maria Teste"]) {
      expect(saida.toLowerCase()).not.toContain(segredo.toLowerCase());
    }
  });
});

describe("consultarVinculo (só lê)", () => {
  it("vinculado: devolve o contato e o nome", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "ja", name: "Maria no CRM" }));
    tabelas.pdv_customer_links.push({ organization_id: ORG, contact_id: "ja", erp_customer_id: "c-0001" });
    expect(await consultarVinculo(ORG, CLIENTE, { supabase })).toEqual({
      estado: "vinculado",
      contactId: "ja",
      contatoNome: "Maria no CRM",
      outrasFichas: 0,
    });
  });

  it("vinculado: conta as OUTRAS fichas do mesmo contato", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "ja", name: "Maria no CRM" }));
    tabelas.pdv_customer_links.push(
      { organization_id: ORG, contact_id: "ja", erp_customer_id: "c-0001" },
      { organization_id: ORG, contact_id: "ja", erp_customer_id: "c-0002" },
    );
    expect(await consultarVinculo(ORG, CLIENTE, { supabase })).toMatchObject({ estado: "vinculado", outrasFichas: 1 });
  });

  it("livre: sem contato no telefone (contato null), e com contato no telefone (nome e fichas)", async () => {
    const { tabelas, supabase } = banco();
    expect(await consultarVinculo(ORG, CLIENTE, { supabase })).toEqual({ estado: "livre", contato: null });
    tabelas.contacts.push(contatoExistente({ id: "a", phone_number: "+5519998765432", name: "Dona do número" }));
    expect(await consultarVinculo(ORG, CLIENTE, { supabase })).toEqual({
      estado: "livre",
      contato: { nome: "Dona do número", fichas: 0 },
    });
    tabelas.pdv_customer_links.push({ organization_id: ORG, contact_id: "a", erp_customer_id: "c-OUTRO" });
    expect(await consultarVinculo(ORG, CLIENTE, { supabase })).toEqual({
      estado: "livre",
      contato: { nome: "Dona do número", fichas: 1 },
    });
  });

  it("telefone_ausente e ambiguo", async () => {
    const { tabelas, supabase } = banco();
    expect(await consultarVinculo(ORG, { id: "c-0001", telefone: null }, { supabase })).toEqual({
      estado: "telefone_ausente",
    });
    tabelas.contacts.push(
      contatoExistente({ id: "a", phone_number: "+5519998765432" }),
      contatoExistente({ id: "b", phone_number: "+551998765432" }),
    );
    expect(await consultarVinculo(ORG, CLIENTE, { supabase })).toEqual({ estado: "ambiguo" });
  });

  it("nunca escreve: nenhuma tabela muda, em qualquer estado, e toda consulta filtra a organização", async () => {
    const { tabelas, consultas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "a", phone_number: "+5519998765432" }));
    const antes = JSON.stringify(tabelas);
    await consultarVinculo(ORG, CLIENTE, { supabase });
    await consultarVinculo(ORG, { id: "c-9", telefone: "+5511900000000" }, { supabase });
    expect(JSON.stringify(tabelas)).toBe(antes);
    for (const c of consultas) {
      expect(c.filtros.find(([col]) => col === "organization_id")?.[1]).toBe(ORG);
    }
  });
});

describe("atualizarContatoDoErp", () => {
  function vinculado() {
    const b = banco();
    b.tabelas.contacts.push(
      contatoExistente({
        id: "ja",
        phone_number: "+5519998765432",
        name: "Nome antigo",
        email: "antigo@exemplo.test",
        birthdate: "1980-01-01",
      }),
    );
    b.tabelas.pdv_customer_links.push({ organization_id: ORG, contact_id: "ja", erp_customer_id: "c-0001" });
    return b;
  }

  it("o ERP sobrescreve nome, e-mail, CPF e nascimento; o telefone não muda", async () => {
    const { tabelas, supabase } = vinculado();
    const r = await atualizarContatoDoErp(ORG, { ...CLIENTE, telefone: "+5511900000000" }, { supabase });
    expect(r).toEqual({ contactId: "ja", semCpfEmail: false });
    expect(primeira(tabelas.contacts)).toMatchObject({
      name: "Maria Teste",
      email: "Maria@Exemplo.test",
      birthdate: "1990-05-17",
      phone_number: "+5519998765432",
      cpf_hash: hashCpf("52998224725"),
    });
    expect(JSON.stringify(tabelas.contacts)).not.toContain("52998224725");
  });

  it("dado que o ERP não tem (ou veio inválido) não apaga o que o CRM guarda", async () => {
    const { tabelas, supabase } = vinculado();
    await atualizarContatoDoErp(
      ORG,
      { ...CLIENTE, email: null, cpf: null, data_nascimento: "17/05/1990" },
      { supabase },
    );
    expect(primeira(tabelas.contacts)).toMatchObject({
      name: "Maria Teste",
      email: "antigo@exemplo.test",
      birthdate: "1980-01-01",
    });
  });

  it("CPF de outro contato: grava o resto e avisa com semCpfEmail", async () => {
    const { tabelas, supabase } = vinculado();
    tabelas.contacts.push(
      contatoExistente({ id: "outro", phone_number: "+5511900000000", cpf_hash: hashCpf("52998224725") }),
    );
    const r = await atualizarContatoDoErp(ORG, CLIENTE, { supabase });
    expect(r).toEqual({ contactId: "ja", semCpfEmail: true });
    const ja = tabelas.contacts.find((c) => c.id === "ja") as Linha;
    expect(ja.name).toBe("Maria Teste");
    expect(ja.birthdate).toBe("1990-05-17");
    expect(ja.cpf_hash).toBeUndefined();
    expect(ja.email).toBe("antigo@exemplo.test");
  });

  it("sem vínculo: sem_vinculo, e nada é escrito", async () => {
    const { tabelas, supabase } = banco();
    tabelas.contacts.push(contatoExistente({ id: "a", phone_number: "+5519998765432", name: "Intacto" }));
    const antes = JSON.stringify(tabelas);
    const erro = await atualizarContatoDoErp(ORG, CLIENTE, { supabase }).catch((e) => e);
    expect(erro).toBeInstanceOf(ContatoEspelhoError);
    expect(erro.codigo).toBe("sem_vinculo");
    expect(JSON.stringify(tabelas)).toBe(antes);
  });

  it("isolamento: só toca o contato vinculado da própria organização", async () => {
    const { tabelas, supabase } = vinculado();
    tabelas.contacts.push(
      contatoExistente({ id: "ja", organization_id: OUTRA_ORG, name: "De outra org", phone_number: "+5519998765432" }),
    );
    await atualizarContatoDoErp(ORG, CLIENTE, { supabase });
    const deOutraOrg = tabelas.contacts.find((c) => c.organization_id === OUTRA_ORG) as Linha;
    expect(deOutraOrg.name).toBe("De outra org");
  });
});
