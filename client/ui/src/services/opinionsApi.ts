/**
 * HTTP client for the Opinions aggregation endpoint.
 *
 * An opinion is the trader-facing view over a registered stream + its
 * BlockIntent + derived block count. See server/api/routers/opinions.py.
 */

import type { Opinion, OpinionsListResponse } from "../types";
import { apiFetch } from "./api";

export async function fetchOpinions(): Promise<Opinion[]> {
  const data = await apiFetch<OpinionsListResponse>("/api/opinions");
  return data.opinions;
}

/** Update the editable trader description. Pass null to clear. */
export async function patchOpinionDescription(
  name: string,
  description: string | null,
): Promise<Opinion> {
  return apiFetch<Opinion>(
    `/api/opinions/${encodeURIComponent(name)}/description`,
    {
      method: "PATCH",
      body: JSON.stringify({ description }),
    },
  );
}

/** Toggle pipeline contribution. Non-destructive — data stays in the registry. */
export async function patchOpinionActive(
  name: string,
  active: boolean,
): Promise<Opinion> {
  return apiFetch<Opinion>(
    `/api/opinions/${encodeURIComponent(name)}/active`,
    {
      method: "PATCH",
      body: JSON.stringify({ active }),
    },
  );
}

/** Delete the opinion (delegates to stream delete on the server). */
export async function deleteOpinion(name: string): Promise<void> {
  return apiFetch<void>(`/api/opinions/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}
