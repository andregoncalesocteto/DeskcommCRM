"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/**
 * Leitura e escrita das chaves públicas do rastreador de um funil (`/api/v1/pipelines/[id]/tracker-keys`).
 *
 * A chave é um endereço público, não um segredo: a API a devolve inteira em toda leitura, e a tela a mostra e a copia
 * sem cerimônia. Toda escrita invalida a lista (a tela mostra o que o servidor tem).
 */

export interface ChaveDoRastreador {
  id: string;
  pipeline_id: string;
  public_key: string;
  label: string;
  allowed_origins: string[];
  is_active: boolean;
  revoked_at: string | null;
  created_at: string;
  /** A hora do evento mais recente que a chave trouxe; `null` = nunca chegou nada. */
  ultimo_recebimento: string | null;
  recebidos_7_dias: number;
}

export interface NovaChave {
  label: string;
  allowed_origins: string[];
}

export const chaveDasChaves = (pipelineId: string) => ["tracker-keys", pipelineId];
const rota = (pipelineId: string) => `/api/v1/pipelines/${encodeURIComponent(pipelineId)}/tracker-keys`;

export function useChavesDoRastreador(pipelineId: string) {
  return useQuery({
    queryKey: chaveDasChaves(pipelineId),
    queryFn: () => apiClient.get<{ data: { chaves: ChaveDoRastreador[] } }>(rota(pipelineId)).then((r) => r.data.chaves),
  });
}

export function useCriarChave(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (corpo: NovaChave) =>
      apiClient.post<{ data: { chave: ChaveDoRastreador } }>(rota(pipelineId), corpo).then((r) => r.data.chave),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaveDasChaves(pipelineId) }),
  });
}

export function useRevogarChave(pipelineId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ data: { chave: ChaveDoRastreador } }>(`${rota(pipelineId)}/${encodeURIComponent(id)}`).then((r) => r.data.chave),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chaveDasChaves(pipelineId) }),
  });
}
