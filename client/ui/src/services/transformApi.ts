import type { TransformListResponse } from "../types";
import { apiFetch } from "./api";

export async function fetchTransforms(): Promise<TransformListResponse> {
  return apiFetch<TransformListResponse>("/api/transforms");
}

export async function updateTransforms(
  config: Record<string, unknown>,
): Promise<TransformListResponse> {
  return apiFetch<TransformListResponse>("/api/transforms", {
    method: "PATCH",
    body: JSON.stringify(config),
  });
}
