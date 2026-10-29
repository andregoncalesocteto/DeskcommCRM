"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/**
 * Leitura e escrita do cadastro de eventos de um funil (`/api/v1/pipelines/[id]/events`).
 *
 * Toda escrita invalida a lista: a tela mostra o que o servidor tem, não o eco do que foi pedido (um aviso, uma chave
 * que o servidor recusou, um `is_active` que mudou em outra aba).
 */

export interface EventoDoFunil {
  id: string;
  key: string;
  label: string;
  description: string | null;
  stage_id: string | null;
  respects_manual_move: boolean;
  state_key: string | null;
  value_path: string | null;
  value_unit: "reais" | "centavos" | null;
  dedupe_path: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** A hora do evento mais recente já registrado; `null` = nunca chegou nada. */
  ultimo_recebimento: string | null;
  recebidos_7_dias: number;
}

/** O que a tela manda ao criar ou editar. Na edição, só o que mudou. */
export type CorpoDoEvento = Partial<
  Pick<
    EventoDoFunil,
    "key" | "label" | "description" | "stage_id" | "respects_manual_move" | "state_key" | "value_path" | "value_unit" | "dedupe_path" | "is_active"
  >
>;

export interface RespostaDeEscrita {
  evento: EventoDoFunil;
  avisos: string[];
}

export const chaveDosEventos = (pipelineId: string) => ["pipeline-events", pipelineId];
const rota = (pipelineId: string) => `/api/v1/pipelines/${encodeURIComponent(pipelineId)}/events`;

export function useEventosDoFunil(pipelineId: string) {
  return useQuery({
    queryKey: chaveDosEventos(pipelineId),
    queryFn: () => apiClient.get<{ data: { eventos: EventoDoFunil[] } }>(rota(pipelineId)).then((r) => r.data.eventos),
  });
}

export function useCriarEvento(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: CorpoDoEvento) =>
      apiClient.post<{ data: RespostaDeEscrita }>(rota(pipelineId), corpo).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaveDosEventos(pipelineId) }),
  });
}

export function useEditarEvento(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: CorpoDoEvento }) =>
      apiClient.patch<{ data: RespostaDeEscrita }>(`${rota(pipelineId)}/${encodeURIComponent(id)}`, corpo).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaveDosEventos(pipelineId) }),
  });
}

export function useDesativarEvento(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ data: { evento: EventoDoFunil } }>(`${rota(pipelineId)}/${encodeURIComponent(id)}`).then((r) => r.data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaveDosEventos(pipelineId) }),
  });
}
