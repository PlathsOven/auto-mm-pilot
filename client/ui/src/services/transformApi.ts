import type { TransformListResponse } from "../types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export async function fetchTransforms(): Promise<TransformListResponse> {
  const res = await fetch(`${BASE}/api/transforms`);
  if (!res.ok) throw new Error(`Failed to fetch transforms: ${res.status}`);
  return res.json();
}

export async function updateTransforms(
  config: Record<string, unknown>,
): Promise<TransformListResponse> {
  const res = await fetch(`${BASE}/api/transforms`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to update transforms: ${res.status}`);
  return res.json();
}
