import { apiFetch } from "./api";
import type {
  ApiKeyResponse,
  LoginRequest,
  LoginResponse,
  SignupRequest,
  UserPublic,
} from "../types";

/** POST /api/auth/signup — create a user + session (skips auth header). */
export function signup(req: SignupRequest): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(req),
    skipAuth: true,
  });
}

/** POST /api/auth/login — exchange username+password for a session. */
export function login(req: LoginRequest): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(req),
    skipAuth: true,
  });
}

/** POST /api/auth/logout — invalidate the current session token. */
export function logout(): Promise<void> {
  return apiFetch<void>("/api/auth/logout", { method: "POST" });
}

/** GET /api/account — refresh the profile for the signed-in user. */
export function getAccount(): Promise<UserPublic> {
  return apiFetch<UserPublic>("/api/account");
}

/** GET /api/account/key — read the current SDK API key. */
export function getApiKey(): Promise<ApiKeyResponse> {
  return apiFetch<ApiKeyResponse>("/api/account/key");
}

/** POST /api/account/key/regenerate — mint a fresh key, invalidates the old one. */
export function regenerateApiKey(): Promise<ApiKeyResponse> {
  return apiFetch<ApiKeyResponse>("/api/account/key/regenerate", {
    method: "POST",
  });
}
