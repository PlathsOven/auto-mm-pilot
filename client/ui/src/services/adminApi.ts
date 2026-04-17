import { apiFetch } from "./api";
import type { AdminUserListResponse } from "../types";

/** GET /api/admin/users — admin-only usage overview. */
export function listUsers(): Promise<AdminUserListResponse> {
  return apiFetch<AdminUserListResponse>("/api/admin/users");
}
