# Posit — a positional trading platform

Posit is an advisory trading terminal for crypto options market-making desks. It ingests configurable data streams, runs a proprietary pricing pipeline, and streams a recommended desired position (plus LLM-generated explanations) to the trader in real time.

- **Product theory** (Edge × Bankroll / Variance, stream epistemology, pipeline): [`docs/product.md`](docs/product.md)
- **System map** (client/server barrier, lanes, Key Files table): [`docs/architecture.md`](docs/architecture.md)
- **Component status** (PROD / MOCK / STUB / OFF per subsystem): [`docs/stack-status.md`](docs/stack-status.md)
- **User flows** (trader + operator personas): [`docs/user-journey.md`](docs/user-journey.md)

This file is the **operator's guide** — everything needed to run Posit locally or deploy it to production. It does not cover how the engine thinks; that lives in `docs/product.md`.

---

## Quick Start (Local Development)

### Prerequisites

- **Node.js 20+** (for the Electron/Vite client)
- **Python 3.12+** (for the FastAPI server + Polars pipeline)
- An **OpenRouter API key** (for the LLM investigation layer)
- macOS, Linux, or WSL2 on Windows

Verify with `node --version` and `python3 --version`. Both are required; the client ships Electron and the server runs the pricing engine.

### Install

```bash
git clone https://github.com/PlathsOven/auto-mm-pilot.git
cd auto-mm-pilot

# Server dependencies
pip install -r requirements.txt

# Client dependencies
npm --prefix client/ui install
```

### Configure

Create a `.env` file at the repo root:

```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
POSIT_MODE=mock
```

- `POSIT_MODE=mock` runs the pipeline on built-in scenario data. Use this for local development.
- `POSIT_MODE=prod` expects live data streams via the (not-yet-built) universal adapter. See `docs/stack-status.md` for current component status.
- Optionally override LLM routing: `OPENROUTER_INVESTIGATION_MODELS=anthropic/claude-sonnet-4,openai/gpt-4.1`

### Run

```bash
./start.sh
```

`start.sh` launches the FastAPI server (`uvicorn server.api.main:app`) and the Vite dev server for the client in parallel.

### Verify

- Client terminal: open `http://localhost:5173`
- The connection indicator should show **CONNECTED** within a few seconds (WebSocket to `ws://localhost:8000/ws`)
- Server health: `curl http://localhost:8000/api/health` returns `{"status": "ok"}`

If any of the above fails, see **Troubleshooting** below.

---

## Deployment (Production)

Two services, two platforms, perpetually online:

| Component | Platform | What it serves |
|-----------|----------|----------------|
| **Client UI** (React/Vite) | Vercel | Trading terminal for the client |
| **Server + Admin** (FastAPI) | Railway | API + WebSocket + Admin dashboard |

### Part 1: Deploy the Server to Railway

Railway runs the FastAPI backend as a persistent process with WebSocket support.

**1.1 Create a Railway account.** Go to [railway.app](https://railway.app) and sign up (GitHub OAuth is easiest). The Trial plan includes $5/month free; for production, upgrade to Hobby ($5/month + usage).

**1.2 Create a new project.**
1. From the Railway dashboard, click **New Project**.
2. Select **Deploy from GitHub Repo**.
3. Connect GitHub if not already connected.
4. Select the **auto-mm-pilot** repository.

**1.3 Configure the service.** Railway auto-detects the `Procfile` and `requirements.txt` at the repo root.
1. Click the deployed service card in the project canvas.
2. Under **Settings**, verify the **Start Command** is:
   ```
   uvicorn server.api.main:app --host 0.0.0.0 --port ${PORT:-8000}
   ```
   If not auto-detected, paste it manually.
3. Under **Variables**, add:
   ```
   OPENROUTER_API_KEY=sk-or-v1-your-actual-key
   POSIT_MODE=mock
   ```
   Set `POSIT_MODE=prod` when live data is available. Optional model overrides:
   ```
   OPENROUTER_INVESTIGATION_MODELS=anthropic/claude-sonnet-4,openai/gpt-4.1
   ```

**1.4 Generate a public URL.**
1. Under **Settings → Networking**, click **Generate Domain**.
2. Railway will assign something like `posit-server-production.up.railway.app`.
3. Copy this URL — you'll need it for the client deployment.

**1.5 Verify.**
- `https://<railway-domain>/api/health` returns `{"status": "ok"}`

### Part 2: Deploy the Client UI to Vercel

Vercel serves the React SPA as a static site.

**2.1 Create a Vercel account.** Sign up at [vercel.com](https://vercel.com) with GitHub. The Hobby (free) plan is sufficient.

**2.2 Import the project.**
1. From the Vercel dashboard, click **Add New → Project**.
2. Select the **auto-mm-pilot** repository.
3. **Before deploying**, configure:
   - **Root Directory:** `client/ui` (click Edit next to Root Directory and type `client/ui`)
   - **Build & Output Settings:** Vercel auto-detects from `vercel.json`. If not, set manually:
     - Build Command: `VITE_WEB=true npx vite build`
     - Output Directory: `dist`
     - Install Command: `npm install`

**2.3 Set environment variables.** Under **Environment Variables**, add:
```
VITE_API_BASE = https://<your-railway-domain>
```
For example: `VITE_API_BASE = https://posit-server-production.up.railway.app`. **No trailing slash.**

**2.4 Deploy.** Click **Deploy**. Vercel builds the SPA and returns a URL like `https://auto-mm-pilot-client.vercel.app`.

**2.5 Verify.**
- Open the Vercel URL — you should see the trading terminal.
- The connection indicator should show **CONNECTED** (WebSocket to Railway).

### CORS

The FastAPI server ships with `allow_origins=["*"]`, so cross-origin requests from Vercel → Railway work out of the box. For production hardening, restrict origins in `server/api/main.py`:
```python
allow_origins=["https://your-app.vercel.app"]
```

### Redeployment

- **Server changes** — push to `main`; Railway auto-deploys.
- **Client changes** — push to `main`; Vercel auto-deploys.
- Both platforms support branch preview deployments.

### Quick Reference

| What | URL |
|------|-----|
| Client terminal | `https://<vercel-domain>` |
| Health check | `https://<railway-domain>/api/health` |
| WebSocket (pipeline) | `wss://<railway-domain>/ws` |
| WebSocket (client ingest, auth-gated) | `wss://<railway-domain>/ws/client` |

### Cost Estimates

| Platform | Plan | Estimate |
|----------|------|----------|
| Railway (Hobby) | $5/mo base + ~$0.000231/min CPU | ~$5–15/mo for light usage |
| Vercel (Hobby) | Free | $0/mo for static hosting |

---

## Troubleshooting

**Client shows DISCONNECTED on startup.**
- Confirm the server is running: `curl http://localhost:8000/api/health`.
- Check the browser devtools Network tab for a failed WS upgrade to `/ws`. If present, the client is hitting the wrong host — confirm `VITE_API_BASE` is unset locally (it defaults to `http://localhost:8000`) or correctly set in Vercel.
- For production, check browser console for CORS errors. Verify `allow_origins` in `server/api/main.py`.

**`OPENROUTER_API_KEY` error on investigation request.**
- The key is missing or not loaded. Verify `.env` exists at the repo root and contains `OPENROUTER_API_KEY=...`.
- Local dev: `start.sh` loads `.env` automatically. If the server was started directly, run it from the repo root so the dotenv lookup finds the file.
- Production: confirm the variable is set in Railway's **Variables** tab and the service has been redeployed since adding it.

**Pipeline empty on startup in local dev.**
- Confirm `POSIT_MODE=mock` is set. In production with no adapter yet, `POSIT_MODE=prod` will produce an empty pipeline — switch to `mock` until adapters are wired.
- `server/api/llm/context_db.py` is currently MOCK-initialized with hardcoded stream metadata (see `docs/stack-status.md`). This is expected.

**Railway domain not generating / blank page.**
- The service must be actively deployed and healthy before **Generate Domain** is available. Check the **Deployments** tab for errors; the most common cause is a missing `OPENROUTER_API_KEY` at startup.
- Railway's build logs are under **Deployments → <latest> → View logs**.

**Vercel build fails with `vite: command not found`.**
- Confirm **Root Directory** is set to `client/ui`, not the repo root. Vercel runs `npm install` in that directory and looks for Vite there.

**`./start.sh` fails with "Python module not found".**
- Confirm dependencies are installed: `pip install -r requirements.txt` from the repo root.
- If using a virtualenv, activate it before running `./start.sh`. The script does not auto-activate.

**WebSocket hot-reload stops working after server code changes.**
- The server has a singleton background ticker (`server/api/ws.py`) that must be restarted after hot reloads. Restart the server to clear it. This is documented as a known gotcha in `CLAUDE.md`.

---

## Repository Layout

```
auto-mm-pilot/
├── client/              # Electron/React/Vite trading terminal (ingest + display)
│   ├── adapter/         # Exchange adapters (OFF — not yet built)
│   └── ui/              # React SPA
├── server/              # FastAPI + Polars server (proprietary compute)
│   ├── api/             # Routes, WS, LLM integration, engine state
│   └── core/            # Pricing pipeline — HUMAN ONLY (Manual Brain rule)
├── docs/                # Architecture, product theory, user flows, stack status
├── tasks/               # todo, lessons, progress trackers
├── pitch/               # Investor/demo materials
├── prototyping/         # Scratch experiments
├── CLAUDE.md            # Auto-loaded agent instructions (Claude Code + Windsurf)
├── .claude/             # Claude Code slash commands + hook settings
├── .windsurf/           # Windsurf workflows (sync partner for .claude/commands/)
├── start.sh             # Local dev launcher
├── Procfile             # Railway start command
├── requirements.txt     # Python deps
└── runtime.txt          # Railway Python version pin
```

See `docs/architecture.md` for the full component map, MVP pipeline, and Key Files table.

---

## Contributing

This repo uses a dual-harness agent setup. If you're making code changes through Claude Code or Windsurf, read `CLAUDE.md` first — it enumerates the Manual Brain rule (`server/core/` is HUMAN ONLY), the schema source-of-truth (`server/api/models.py` for Pydantic, `client/ui/src/types.ts` for TypeScript), and the commit discipline. Slash commands live in `.claude/commands/` and `.windsurf/workflows/` and must stay byte-identical.
