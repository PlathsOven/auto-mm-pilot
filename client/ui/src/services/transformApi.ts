import type { TransformListResponse } from "../types";
import { apiFetch } from "./api";

export async function fetchTransforms(signal?: AbortSignal): Promise<TransformListResponse> {
  return apiFetch<TransformListResponse>("/api/transforms", { signal });
}

export async function updateTransforms(
  config: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TransformListResponse> {
  return apiFetch<TransformListResponse>("/api/transforms", {
    method: "PATCH",
    body: JSON.stringify(config),
    signal,
  });
}
