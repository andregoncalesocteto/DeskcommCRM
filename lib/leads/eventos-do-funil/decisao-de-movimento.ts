/**
 * As regras de "para onde o card vai" quando um evento chega, como funções puras (sem I/O).
 *
 * A operação do MCP lê o estado do pedido e do funil, chama estas funções e só então escreve. Separar a
 * decisão da escrita é o que permite provar a matriz inteira em tabela, sem banco.
 *
 * ## Não retrocede, sem tabela fixa de níveis
 *
 * Seja M o conjunto das etapas de destino dos eventos ATIVOS do funil. Se a etapa atual do pedido está em M,
 * o evento só avança para uma posição MAIOR. Se a etapa atual não está em M (Conversas, "Chamar humano" ou outra
 * que nenhum evento aponta), o pedido pode seguir para o destino: um desvio depois da Revisão não trava a compra.
 * A ordem é a das etapas do funil; não há "nível 1 a 5" escrito em lugar nenhum.
 *
 * ## Respeitar a equipe
 *
 * Com o flag do evento ligado, se o último movimento do pedido foi de uma PESSOA (`actor_kind = 'user'`), o evento
 * registra mas não move. O movimento do próprio evento sai com outro ator (token e webhook gravam `system`), então
 * o ciclo se refaz sozinho depois do primeiro evento que não respeita.
 */

/** O `actor_kind` que `crm_lead_activities` grava quando uma pessoa move o card. */
export const ATOR_HUMANO = "user";

export interface EtapaParaMover {
  id: string;
  /** `crm_stages.position` (ordem do quadro). */
  position: number;
}

export interface EtapaDeDestino extends EtapaParaMover {
  arquivada: boolean;
}

export type DecisaoDeMovimento =
  | "movido"
  | "sem_destino"
  | "ja_na_etapa_ou_adiante"
  | "respeita_movimento_manual"
  | "pedido_encerrado"
  | "etapa_arquivada";

export interface EntradaDoMovimento {
  /** Etapa em que o pedido está agora; `null` se não foi possível ler. */
  etapaAtual: EtapaParaMover | null;
  /** Destino cadastrado no evento; `null` = o evento só registra. */
  destino: EtapaDeDestino | null;
  /** Ids das etapas de destino de todos os eventos ativos do funil (o conjunto M). */
  etapasDeDestinoDoFunil: ReadonlySet<string>;
  /** Ganho ou perdido. */
  pedidoEncerrado: boolean;
  /** `respects_manual_move` do evento. */
  respeitaMovimentoManual: boolean;
  /** `actor_kind` do último `stage_changed` do pedido; `null` se nunca mudou de etapa. */
  atorDoUltimoMovimento: string | null;
}

/** Decide se o evento move o card. A ordem das perguntas é a precedência dos motivos. */
export function decidirMovimento(entrada: EntradaDoMovimento): DecisaoDeMovimento {
  const { etapaAtual, destino } = entrada;
  if (!destino) return "sem_destino";
  if (entrada.pedidoEncerrado) return "pedido_encerrado";
  if (destino.arquivada) return "etapa_arquivada";
  if (etapaAtual) {
    if (etapaAtual.id === destino.id) return "ja_na_etapa_ou_adiante";
    const atualEstaNoMapa = entrada.etapasDeDestinoDoFunil.has(etapaAtual.id);
    if (atualEstaNoMapa && destino.position <= etapaAtual.position) return "ja_na_etapa_ou_adiante";
  }
  if (entrada.respeitaMovimentoManual && entrada.atorDoUltimoMovimento === ATOR_HUMANO) {
    return "respeita_movimento_manual";
  }
  return "movido";
}

type Instante = string | number | Date;

/**
 * Num evento de estado ("o mais novo vence"), o conteúdo só substitui o anterior se a hora do evento for IGUAL ou
 * mais nova que a do último aplicado. Igual conta como verdadeiro: reaplicar o mesmo evento regrava o mesmo valor.
 * Sem último evento, prevalece. Hora ilegível no evento novo não prevalece; hora ilegível no anterior não impede.
 */
export function estadoDevePrevalecer(at: Instante, ultimoAt: Instante | null | undefined): boolean {
  const novo = new Date(at).getTime();
  if (Number.isNaN(novo)) return false;
  if (ultimoAt === null || ultimoAt === undefined) return true;
  const anterior = new Date(ultimoAt).getTime();
  if (Number.isNaN(anterior)) return true;
  return novo >= anterior;
}
