import { CodeBlock, Section } from "../ApiDocsParts";

/** Authentication — API key requirements for all /api/* routes. */
export function AuthSection() {
  return (
    <Section id="auth" title="Authentication">
      <p>
        All <code className="text-mm-accent">/api/*</code> endpoints except{" "}
        <code>/api/health</code> require a valid API key. The key is checked
        before the request reaches any route handler.
      </p>

      <p className="font-medium text-mm-text">Pass the key in one of two ways:</p>
      <CodeBlock>{`# Header (preferred)
X-API-Key: YOUR_KEY

# Query parameter (useful for quick tests)
GET /api/streams?api_key=YOUR_KEY`}</CodeBlock>

      <p>
        A missing or invalid key returns{" "}
        <strong className="text-rose-400">401 Unauthorized</strong>:
      </p>
      <CodeBlock>{`{ "error": { "code": 401, "message": "Invalid or missing API key" } }`}</CodeBlock>

      <p className="font-medium text-mm-text">Server configuration:</p>
      <ul className="list-inside list-disc space-y-1 pl-1">
        <li>
          <code>POSIT_API_KEYS=key_a,key_b,key_c</code> — comma-separated
          list, one key per user or integration. Each firm / pipeline gets
          its own key so access can be revoked individually.
        </li>
        <li>
          Falls back to <code>CLIENT_WS_API_KEY</code> if{" "}
          <code>POSIT_API_KEYS</code> is unset (single-key compatibility).
        </li>
        <li>
          If neither env var is set, auth is disabled and a warning is
          logged — intended for local development only.
        </li>
      </ul>

      <p className="font-medium text-mm-text">
        WebSocket endpoints have separate auth:
      </p>
      <ul className="list-inside list-disc space-y-1 pl-1">
        <li>
          <code>/ws/client</code> — requires{" "}
          <code>X-API-Key</code> header or <code>?api_key=</code> query
          param, checked before the handshake is accepted.
        </li>
        <li>
          <code>/ws</code> — read-only position broadcast, no auth required.
        </li>
      </ul>
    </Section>
  );
}
