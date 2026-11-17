// Formatos do ERP lidos pelo PDV. Fonte: contrato-mcp-erp-formatos.md (fatias E0 e E1).
// Esquemas Zod porque a resposta vem de fora; os tipos saem deles.
import { z } from "zod";

export const LojaSchema = z.object({
  codigo: z.string(),
  sigla: z.string(),
  nome: z.string(),
  endereco: z.string(),
  ativa: z.boolean(),
});
export type Loja = z.infer<typeof LojaSchema>;

export const ListaDeLojasSchema = z.object({ lojas: z.array(LojaSchema) });
export type ListaDeLojas = z.infer<typeof ListaDeLojasSchema>;

export const ClienteResumoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  // O ERP real não tem endereço principal e omite a chave (devolutiva E0/E1, divergência 5 e 6):
  // ausente e null significam o mesmo, "sem endereço para mostrar". A API normaliza para null.
  endereco_principal: z.string().nullable().optional(),
});
export type ClienteResumo = z.infer<typeof ClienteResumoSchema>;

export const ResultadoBuscaSchema = z.object({
  clientes: z.array(ClienteResumoSchema),
  total_encontrado: z.number().int().nonnegative(),
  truncado: z.boolean(),
});
export type ResultadoBusca = z.infer<typeof ResultadoBuscaSchema>;

export const EnderecoSchema = z.object({
  id: z.string(),
  cep: z.string(),
  uf: z.string(),
  cidade: z.string(),
  bairro: z.string(),
  endereco: z.string(),
  complemento: z.string().nullable(),
  // Idem: o ERP real não marca endereço principal. Ausente = nenhum endereço marcado.
  principal: z.boolean().optional(),
  loja_entrega: z.object({ codigo: z.string(), sigla: z.string() }).nullable(),
});
export type Endereco = z.infer<typeof EnderecoSchema>;

export const ClienteSchema = z.object({
  id: z.string(),
  nome: z.string(),
  telefone: z.string().nullable(),
  email: z.string().nullable(),
  // Sensíveis: omitidos sem `campos_sensiveis: true`; podem ser null mesmo com a flag.
  // Ausente (undefined) e não cadastrado (null) são coisas diferentes.
  cpf: z.string().nullable().optional(),
  data_nascimento: z.string().nullable().optional(),
  enderecos: z.array(EnderecoSchema),
});
export type Cliente = z.infer<typeof ClienteSchema>;

export const ObterClienteSchema = z.object({ cliente: ClienteSchema });
export type ObterCliente = z.infer<typeof ObterClienteSchema>;
