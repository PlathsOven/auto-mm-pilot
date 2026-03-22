/** Shared client configuration constants. */

const DEFAULT_API_BASE = "http://localhost:8000";

export const API_BASE = import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;

/** Derive WS URL from the HTTP base: http→ws, https→wss */
const wsProtocol = API_BASE.startsWith("https") ? "wss" : "ws";
export const WS_URL = `${wsProtocol}${API_BASE.slice(API_BASE.indexOf("://"))}/ws`;
