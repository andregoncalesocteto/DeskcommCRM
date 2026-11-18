// Contato espelho do PDV: o ERP é o cadastro mestre do cliente (ADR-002); o CRM guarda só o contato
// para conversas, funil e LGPD, ligado ao id do ERP por `pdv_customer_links`.
//
// O TELEFONE é a única chave entre as duas pontas (ADR-007). Abrir a ficha só LÊ
// (`consultarVinculo`); quem escreve é o atendente, pelos botões "Vincular" e "Atualizar e vincular"
// (`vincularClienteDoErp`) e "Atualizar dados" (`atualizarContatoDoErp`). CPF e e-mail são dados
// do contato, nunca critério de busca do contato. Um contato pode ter VÁRIAS fichas do ERP
// (ADR-008): o ERP duplica a mesma pessoa, e cada ficha tem a própria linha de vínculo.
//
// `organizationId` vem do chamador autenticado, NUNCA do cliente do ERP. Esta camada usa o admin
// client (ignora RLS), então toda consulta repete `organization_id`. Dado pessoal (CPF, telefone,
// e-mail, nome) não vai a log nem a mensagem de erro.
import type { SupabaseClient } from "@supabase/supabase-js";

import { canonicalPhoneBR, phoneLookupVariants } from "@/lib/channels/phone-variants";
import { camposCpfParaGravar, normalizeCpf } from "@/lib/contacts/cpf";
import { createAdminClient } from "@/lib/supabase/admin";

import type { Cliente } from "./erp/tipos";

export type CodigoContatoEspelho =
  | "contato_ambiguo"
  | "cliente_sem_telefone"
  | "sem_vinculo"
  | "falha_ao_vincular";

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

/** Situação do vínculo de um cliente do ERP com o CRM, lida sem escrever nada. */
export type EstadoDoVinculo =
  /** `outrasFichas`: quantas OUTRAS fichas do ERP apontam para o mesmo contato. */
  | { estado: "vinculado"; contactId: string; contatoNome: string; outrasFichas: number }
  /**
   * Pode vincular. `contato` é o contato que já tem este telefone (e a quantas fichas do ERP ele
   * está ligado), ou null quando o botão criará um.
   */
  | { estado: "livre"; contato: { nome: string; fichas: number } | null }
  | { estado: "telefone_ausente" }
  /** Mais de um contato vivo para o mesmo número (grafias com e sem o nono dígito). */
  | { estado: "ambiguo" };

export interface ResultadoDoVinculo {
  contactId: string;
  /** O contato foi criado nesta chamada. */
  contatoCriado: boolean;
  /** O vínculo foi gravado nesta chamada (falso quando já existia). */
  vinculoNovo: boolean;
  /** CPF e e-mail não foram copiados porque pertencem a outro contato (a chave é o telefone). */
  semCpfEmail: boolean;
  /** Os dados do ERP sobrescreveram o contato (botão "Atualizar e vincular"). */
  dadosAtualizados: boolean;
}

export interface OpcoesDoVinculo extends OpcoesDoEspelho {
  /** "Atualizar e vincular": além de ligar, o ERP sobrescreve os dados do contato do telefone. */
  sobrescrever?: boolean;
}

export interface ResultadoDaAtualizacao {
  contactId: string;
  semCpfEmail: boolean;
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
    "Há mais de um contato com este telefone. Peça ao gerente que una os contatos antes de continuar.",
    { motivo },
  );
const SEM_TELEFONE = () =>
  new ContatoEspelhoError(
    "cliente_sem_telefone",
    "Este cliente não tem telefone no ERP, e o telefone é o que liga o cliente ao contato do CRM.",
  );
const SEM_VINCULO = () =>
  new ContatoEspelhoError("sem_vinculo", "Este cliente ainda não está vinculado ao CRM.");
const FALHA = () =>
  new ContatoEspelhoError("falha_ao_vincular", "Não foi possível vincular o contato do cliente.");

/** Telefone do ERP em E.164 utilizável, ou null. */
function telefoneDe(cliente: ClienteParaEspelho): string | null {
  if (!cliente.telefone) return null;
  const canonico = canonicalPhoneBR(cliente.telefone);
  return FORMATO_TELEFONE.test(canonico) ? canonico : null;
}

/** CPF utilizável: 11 dígitos; qualquer outra coisa é ignorada (o ERP é quem valida). */
function cpfDe(cliente: ClienteParaEspelho): string | null {
  if (!cliente.cpf) return null;
  const digitos = normalizeCpf(cliente.cpf);
  return digitos.length === 11 ? digitos : null;
}

function emailDe(cliente: ClienteParaEspelho): string | null {
  const email = cliente.email?.trim() ?? null;
  return email && FORMATO_EMAIL.test(email) ? email : null;
}

function dataDe(cliente: ClienteParaEspelho): string | null {
  return cliente.data_nascimento && FORMATO_DATA.test(cliente.data_nascimento)
    ? cliente.data_nascimento
    : null;
}

interface ContatoVivo {
  id: string;
  name: string;
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

/** Quantas fichas do ERP apontam para este contato (0 = livre). */
async function fichasDoContato(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("pdv_customer_links")
    .select("erp_customer_id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId);
  if (error) throw FALHA();
  return ((data ?? []) as unknown[]).length;
}

async function nomeDoContato(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .maybeSingle();
  if (error) throw FALHA();
  return (data as { name: string | null } | null)?.name ?? "";
}

/** Contatos vivos da organização (pessoa, não fundido) que têm este telefone, em qualquer grafia. */
async function contatosDoTelefone(
  supabase: SupabaseClient,
  organizationId: string,
  telefone: string,
): Promise<ContatoVivo[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("kind", "person")
    .is("is_merged_into", null)
    .in("phone_number", phoneLookupVariants(telefone));
  if (error) throw FALHA();
  return (data ?? []) as ContatoVivo[];
}

/**
 * Lê a situação do vínculo, sem escrever nada. É o que a ficha mostra ao abrir.
 * `cliente.id` e `cliente.telefone` vêm do ERP; a organização, do chamador autenticado.
 */
export async function consultarVinculo(
  organizationId: string,
  cliente: Pick<ClienteParaEspelho, "id" | "telefone">,
  opcoes: OpcoesDoEspelho = {},
): Promise<EstadoDoVinculo> {
  const supabase = opcoes.supabase ?? createAdminClient();

  const existente = await vinculoDoErp(supabase, organizationId, cliente.id);
  if (existente) {
    return {
      estado: "vinculado",
      contactId: existente,
      contatoNome: await nomeDoContato(supabase, organizationId, existente),
      outrasFichas: Math.max(0, (await fichasDoContato(supabase, organizationId, existente)) - 1),
    };
  }

  const telefone = telefoneDe(cliente as ClienteParaEspelho);
  if (!telefone) return { estado: "telefone_ausente" };

  const contatos = await contatosDoTelefone(supabase, organizationId, telefone);
  if (contatos.length > 1) return { estado: "ambiguo" };
  const unico = contatos[0];
  if (!unico) return { estado: "livre", contato: null };
  return {
    estado: "livre",
    contato: {
      nome: unico.name ?? "",
      fichas: await fichasDoContato(supabase, organizationId, unico.id),
    },
  };
}

/** A linha de um contato novo. CPF e e-mail entram só quando `completo`. */
async function linhaDoContato(
  supabase: SupabaseClient,
  organizationId: string,
  cliente: ClienteParaEspelho,
  telefone: string,
  completo: boolean,
): Promise<Record<string, unknown>> {
  const linha: Record<string, unknown> = {
    organization_id: organizationId,
    name: cliente.nome,
    phone_number: telefone,
    email: completo ? emailDe(cliente) : null,
    birthdate: dataDe(cliente),
    source: "pdv",
    source_metadata: {},
  };
  const cpf = cpfDe(cliente);
  // Os DOIS campos ou NENHUM (`contacts_cpf_consistency`): sem cifra disponível o contato nasce sem CPF.
  if (completo && cpf) Object.assign(linha, await camposCpfParaGravar(supabase, cpf));
  return linha;
}

async function criarContato(
  supabase: SupabaseClient,
  organizationId: string,
  cliente: ClienteParaEspelho,
  telefone: string,
  completo: boolean,
): Promise<{ id: string } | { erro: { code?: string } }> {
  const linha = await linhaDoContato(supabase, organizationId, cliente, telefone, completo);
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
 * Grava no contato os dados do ERP (o ERP é o mestre, ADR-002): nome, e-mail, CPF e nascimento.
 * O TELEFONE nunca muda (é a chave do vínculo). Dado que o ERP não tem, ou que veio fora do
 * formato, não apaga o que o CRM já guarda. CPF ou e-mail que já são de OUTRO contato ficam de
 * fora e o resultado avisa (`semCpfEmail`).
 */
async function gravarDadosDoErp(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  cliente: ClienteParaEspelho,
): Promise<{ semCpfEmail: boolean }> {
  const base: Record<string, unknown> = {};
  if (cliente.nome.trim()) base.name = cliente.nome;
  const data = dataDe(cliente);
  if (data) base.birthdate = data;

  const sensiveis: Record<string, unknown> = {};
  const email = emailDe(cliente);
  if (email) sensiveis.email = email;
  const cpf = cpfDe(cliente);
  if (cpf) Object.assign(sensiveis, await camposCpfParaGravar(supabase, cpf));

  const gravar = async (patch: Record<string, unknown>) => {
    if (Object.keys(patch).length === 0) return null;
    const { error } = await supabase
      .from("contacts")
      .update(patch)
      .eq("organization_id", organizationId)
      .eq("id", contactId);
    return error;
  };

  const erro = await gravar({ ...base, ...sensiveis });
  if (!erro) return { semCpfEmail: false };
  if (erro.code !== UNICIDADE) throw FALHA();

  // CPF ou e-mail já são de OUTRO contato: grava o resto e avisa.
  const semSensiveis = await gravar(base);
  if (semSensiveis) throw FALHA();
  return { semCpfEmail: true };
}

/**
 * Vincula o cliente do ERP a um contato do CRM pelo TELEFONE. Idempotente e seguro sob
 * concorrência: as unicidades do banco decidem, e o 23505 leva ao que já existe.
 *
 *  - já vinculado: devolve o vínculo, sem mudar nada;
 *  - sem telefone utilizável: `cliente_sem_telefone`;
 *  - dois ou mais contatos no número: `contato_ambiguo`;
 *  - um contato no número (livre ou já ligado a OUTRA ficha do ERP, ADR-008): liga, e com
 *    `sobrescrever` o ERP também sobrescreve os dados do contato;
 *  - nenhum: cria com os dados do ERP e liga.
 */
export async function vincularClienteDoErp(
  organizationId: string,
  cliente: ClienteParaEspelho,
  opcoes: OpcoesDoVinculo = {},
): Promise<ResultadoDoVinculo> {
  const supabase = opcoes.supabase ?? createAdminClient();

  // 1. Vínculo já existente: devolve sem mudar nada.
  const existente = await vinculoDoErp(supabase, organizationId, cliente.id);
  if (existente) {
    return {
      contactId: existente,
      contatoCriado: false,
      vinculoNovo: false,
      semCpfEmail: false,
      dadosAtualizados: false,
    };
  }

  // 2. O telefone é a chave: sem ele não há como ligar.
  const telefone = telefoneDe(cliente);
  if (!telefone) throw SEM_TELEFONE();

  // 3. Procura o contato do número; mais de um = não escolhe sozinho.
  let contatos = await contatosDoTelefone(supabase, organizationId, telefone);
  if (contatos.length > 1) throw AMBIGUO("varios_contatos_no_telefone");

  let contatoCriado = false;
  let semCpfEmail = false;
  if (contatos.length === 0) {
    // 4. Nenhum: cria. O 23505 é corrida pelo telefone, ou CPF/e-mail que já são de OUTRO contato.
    let criado = await criarContato(supabase, organizationId, cliente, telefone, true);
    if ("erro" in criado) {
      if (criado.erro.code !== UNICIDADE) throw FALHA();
      contatos = await contatosDoTelefone(supabase, organizationId, telefone);
      if (contatos.length > 1) throw AMBIGUO("varios_contatos_no_telefone");
      if (contatos.length === 0) {
        // Não foi o telefone: CPF ou e-mail pertencem a outro contato. O telefone manda; o resto fica fora.
        criado = await criarContato(supabase, organizationId, cliente, telefone, false);
        if ("erro" in criado) {
          if (criado.erro.code !== UNICIDADE) throw FALHA();
          contatos = await contatosDoTelefone(supabase, organizationId, telefone);
          if (contatos.length !== 1) throw FALHA();
        } else {
          semCpfEmail = true;
        }
      }
    }
    if ("id" in criado) contatoCriado = true;
    if (contatos.length === 0 && "id" in criado) contatos = [{ id: criado.id, name: cliente.nome }];
  }
  const contactId = (contatos[0] as ContatoVivo).id;

  // 5. Grava o vínculo. Um contato pode ter várias fichas; só ESTA ficha é única (23505 = o outro
  //    pedido já vinculou o mesmo cliente do ERP: devolve o dele).
  const { error } = await supabase
    .from("pdv_customer_links")
    .insert({ organization_id: organizationId, contact_id: contactId, erp_customer_id: cliente.id })
    .select("contact_id")
    .single();
  if (error) {
    if (error.code !== UNICIDADE) throw FALHA();
    const doOutroPedido = await vinculoDoErp(supabase, organizationId, cliente.id);
    if (!doOutroPedido) throw FALHA();
    if (contatoCriado && doOutroPedido !== contactId) {
      await removerContatoOrfao(supabase, organizationId, contactId);
    }
    return {
      contactId: doOutroPedido,
      contatoCriado: false,
      vinculoNovo: false,
      semCpfEmail: false,
      dadosAtualizados: false,
    };
  }

  // 6. "Atualizar e vincular" num contato que já existia: o ERP sobrescreve. Contato recém-criado
  //    já nasceu com os dados do ERP.
  let dadosAtualizados = false;
  if (opcoes.sobrescrever && !contatoCriado) {
    ({ semCpfEmail } = await gravarDadosDoErp(supabase, organizationId, contactId, cliente));
    dadosAtualizados = true;
  }
  return { contactId, contatoCriado, vinculoNovo: true, semCpfEmail, dadosAtualizados };
}

/**
 * Atualiza o contato vinculado com os dados do ERP (o ERP é o mestre, ADR-002): nome, e-mail, CPF
 * e data de nascimento. O TELEFONE nunca muda (é a chave do vínculo). Dado que o ERP não tem, ou
 * que veio fora do formato, não apaga o que o CRM já guarda.
 */
export async function atualizarContatoDoErp(
  organizationId: string,
  cliente: ClienteParaEspelho,
  opcoes: OpcoesDoEspelho = {},
): Promise<ResultadoDaAtualizacao> {
  const supabase = opcoes.supabase ?? createAdminClient();

  const contactId = await vinculoDoErp(supabase, organizationId, cliente.id);
  if (!contactId) throw SEM_VINCULO();

  const { semCpfEmail } = await gravarDadosDoErp(supabase, organizationId, contactId, cliente);
  return { contactId, semCpfEmail };
}
