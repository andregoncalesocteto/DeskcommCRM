// Contato espelho do PDV: o ERP é o cadastro mestre do cliente (ADR-002); o CRM guarda só o contato
// para conversas, funil e LGPD, ligado ao id do ERP por `pdv_customer_links`.
//
// `organizationId` vem do chamador autenticado, NUNCA do cliente do ERP. Esta camada usa o admin
// client (ignora RLS), então toda consulta repete `organization_id`. Dado pessoal (CPF, telefone,
// e-mail, nome) não vai a log nem a mensagem de erro.
import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalPhoneBR, phoneLookupVariants } from "@/lib/channels/phone-variants";
import { camposCpfParaGravar, hashCpf, normalizeCpf } from "@/lib/contacts/cpf";
import { createAdminClient } from "@/lib/supabase/admin";

import type { Cliente } from "./erp/tipos";

export type CodigoContatoEspelho = "contato_ambiguo" | "falha_ao_vincular";

/** Erro tipado do espelho. A mensagem é fixa: nunca cita telefone, CPF, e-mail nem nome. */
export class ContatoEspelhoError extends Error {
  readonly codigo: CodigoContatoEspelho;
  readonly detalhes?: { motivo: string };
  constructor(codigo: CodigoContatoEspelho, message: string, detalhes?: { motivo: string }) {
    super(message);
    this.name = "ContatoEspelhoError";
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export interface ResultadoDoVinculo {
  contactId: string;
  /** O contato foi criado nesta chamada. */
  contatoCriado: boolean;
  /** O vínculo foi gravado nesta chamada (falso quando já existia). */
  vinculoNovo: boolean;
}

export interface OpcoesDoEspelho {
  /** Cliente do banco; o padrão é o admin client, sempre filtrado por `organization_id`. */
  supabase?: SupabaseClient;
}

/** Os campos do cliente do ERP que o espelho usa (CPF só chega com `campos_sensiveis`). */
export type ClienteParaEspelho = Pick<Cliente, "id" | "nome" | "telefone" | "email"> &
  Partial<Pick<Cliente, "cpf" | "data_nascimento">>;

const FORMATO_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const FORMATO_TELEFONE = /^\+\d{8,15}$/;
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const UNICIDADE = "23505";

const AMBIGUO = (motivo: string) =>
  new ContatoEspelhoError(
    "contato_ambiguo",
    "Há mais de um contato que pode ser deste cliente. Resolva o cadastro antes de continuar.",
    { motivo },
  );
const FALHA = () =>
  new ContatoEspelhoError("falha_ao_vincular", "Não foi possível vincular o contato do cliente.");

interface Erro {
  code?: string;
}

/** CPF utilizável: 11 dígitos; qualquer outra coisa é ignorada (o ERP é quem valida). */
function cpfDe(cliente: ClienteParaEspelho): string | null {
  if (!cliente.cpf) return null;
  const digitos = normalizeCpf(cliente.cpf);
  return digitos.length === 11 ? digitos : null;
}

async function vinculoDoErp(
  supabase: SupabaseClient,
  organizationId: string,
  erpCustomerId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("pdv_customer_links")
    .select("contact_id")
    .eq("organization_id", organizationId)
    .eq("erp_customer_id", erpCustomerId)
    .maybeSingle();
  if (error) throw FALHA();
  return (data as { contact_id: string } | null)?.contact_id ?? null;
}

/** Contatos vivos da organização (pessoa, não fundido) que casam por telefone, CPF ou e-mail. */
async function candidatos(
  supabase: SupabaseClient,
  organizationId: string,
  cliente: ClienteParaEspelho,
): Promise<string[]> {
  const base = () =>
    supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("kind", "person")
      .is("is_merged_into", null);

  const achados = new Set<string>();
  const juntar = (data: unknown) => {
    for (const linha of (data ?? []) as Array<{ id: string }>) achados.add(linha.id);
  };

  const variantes = cliente.telefone ? phoneLookupVariants(cliente.telefone) : [];
  if (variantes.length > 0) {
    const { data, error } = await base().in("phone_number", variantes);
    if (error) throw FALHA();
    juntar(data);
  }
  const cpf = cpfDe(cliente);
  if (cpf) {
    const { data, error } = await base().eq("cpf_hash", hashCpf(cpf));
    if (error) throw FALHA();
    juntar(data);
  }
  const email = cliente.email?.trim().toLowerCase();
  if (email) {
    const { data, error } = await base().eq("email_normalized", email);
    if (error) throw FALHA();
    juntar(data);
  }
  return [...achados];
}

async function criarContato(
  supabase: SupabaseClient,
  organizationId: string,
  cliente: ClienteParaEspelho,
): Promise<{ id: string } | { erro: Erro }> {
  const telefone = cliente.telefone ? canonicalPhoneBR(cliente.telefone) : null;
  const email = cliente.email?.trim() ?? null;
  const linha: Record<string, unknown> = {
    organization_id: organizationId,
    name: cliente.nome,
    phone_number: telefone && FORMATO_TELEFONE.test(telefone) ? telefone : null,
    email: email && FORMATO_EMAIL.test(email) ? email : null,
    birthdate:
      cliente.data_nascimento && FORMATO_DATA.test(cliente.data_nascimento)
        ? cliente.data_nascimento
        : null,
    source: "pdv",
    source_metadata: {},
  };
  const cpf = cpfDe(cliente);
  // Os DOIS campos ou NENHUM (`contacts_cpf_consistency`): sem cifra disponível o contato nasce sem CPF.
  if (cpf) Object.assign(linha, await camposCpfParaGravar(supabase, cpf));

  const { data, error } = await supabase.from("contacts").insert(linha).select("id").single();
  if (error) return { erro: error };
  return { id: (data as { id: string }).id };
}

async function removerContatoOrfao(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<void> {
  // Melhor esforço: o contato nasceu agora, sem conversa nem histórico.
  await supabase.from("contacts").delete().eq("organization_id", organizationId).eq("id", contactId);
}

/**
 * Acha ou cria o contato espelho de um cliente do ERP e grava o vínculo. Idempotente e seguro
 * sob concorrência: as unicidades do banco decidem, e o 23505 leva ao que já existe.
 */
export async function vincularClienteDoErp(
  organizationId: string,
  cliente: ClienteParaEspelho,
  opcoes: OpcoesDoEspelho = {},
): Promise<ResultadoDoVinculo> {
  const supabase = opcoes.supabase ?? createAdminClient();

  // 1. Vínculo já existente: devolve sem mudar nada.
  const existente = await vinculoDoErp(supabase, organizationId, cliente.id);
  if (existente) return { contactId: existente, contatoCriado: false, vinculoNovo: false };

  // 2. Procura o contato; mais de um = não escolhe sozinho.
  let ids = await candidatos(supabase, organizationId, cliente);
  if (ids.length > 1) throw AMBIGUO("varios_candidatos");

  // 3. Nenhum: cria. O 23505 (corrida, ou dado que a busca não alcançou) leva ao contato que já existe.
  let contatoCriado = false;
  if (ids.length === 0) {
    const criado = await criarContato(supabase, organizationId, cliente);
    if ("erro" in criado) {
      if (criado.erro.code !== UNICIDADE) throw FALHA();
      ids = await candidatos(supabase, organizationId, cliente);
      if (ids.length > 1) throw AMBIGUO("varios_candidatos");
      if (ids.length === 0) throw FALHA();
    } else {
      ids = [criado.id];
      contatoCriado = true;
    }
  }
  const contactId = ids[0] as string;

  // 4. Grava o vínculo. 23505: ou o outro pedido já vinculou ESTE cliente (devolve o dele), ou o
  //    contato já pertence a OUTRO cliente do ERP (ambíguo: não se rouba o vínculo).
  const { error } = await supabase
    .from("pdv_customer_links")
    .insert({ organization_id: organizationId, contact_id: contactId, erp_customer_id: cliente.id })
    .select("contact_id")
    .single();
  if (!error) return { contactId, contatoCriado, vinculoNovo: true };
  if (error.code !== UNICIDADE) throw FALHA();

  const doOutroPedido = await vinculoDoErp(supabase, organizationId, cliente.id);
  if (doOutroPedido) {
    if (contatoCriado && doOutroPedido !== contactId) {
      await removerContatoOrfao(supabase, organizationId, contactId);
    }
    return { contactId: doOutroPedido, contatoCriado: false, vinculoNovo: false };
  }
  throw AMBIGUO("contato_de_outro_cliente");
}
