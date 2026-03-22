# APT — Deployment Guide

Two services, two platforms, perpetually online.

| Component | Platform | What it serves |
|-----------|----------|----------------|
| **Client UI** (React/Vite) | Vercel | Trading terminal for the client |
| **Server + Admin** (FastAPI) | Railway | API + WebSocket + Admin dashboard for you |

---

## Part 1: Deploy the Server to Railway

Railway runs the FastAPI backend as a persistent process with WebSocket support.

### 1.1 Create a Railway account
1. Go to [railway.app](https://railway.app) and sign up (GitHub OAuth is easiest).
2. You get $5/month free on the Trial plan. For production, upgrade to the Hobby plan ($5/month + usage).

### 1.2 Create a new project
1. From the Railway dashboard, click **"New Project"**.
2. Select **"Deploy from GitHub Repo"**.
3. Connect your GitHub account if not already connected.
4. Select the **auto-mm-pilot** repository.

### 1.3 Configure the service
After the repo is imported, Railway will auto-detect the `Procfile` and `requirements.txt` at the repo root.

1. Click on the deployed service card in the project canvas.
2. Go to the **Settings** tab:
   - **Start Command** should auto-detect as: `uvicorn server.api.main:app --host 0.0.0.0 --port ${PORT:-8000}`
   - If not, paste that manually.
3. Go to the **Variables** tab and add:
   ```
   OPENROUTER_API_KEY=sk-or-v1-your-actual-key
   APT_MODE=mock
   ```
   - Set `APT_MODE=prod` when you're ready for live data (no mock scenario).
   - Optionally add model overrides:
   ```
   OPENROUTER_INVESTIGATION_MODELS=anthropic/claude-sonnet-4,openai/gpt-4.1
   OPENROUTER_JUSTIFICATION_MODELS=anthropic/claude-sonnet-4,openai/gpt-4.1-mini
   ```

### 1.4 Generate a public URL
1. In the service **Settings** tab, scroll to **Networking**.
2. Click **"Generate Domain"** — Railway will assign something like:
   ```
   apt-server-production.up.railway.app
   ```
3. Copy this URL. You'll need it for the client deployment.

### 1.5 Verify
- Open `https://<your-railway-domain>/api/health` — should return `{"status": "ok"}`
- Open `https://<your-railway-domain>/admin` — your admin dashboard

---

## Part 2: Deploy the Client UI to Vercel

Vercel serves the React SPA as a static site.

### 2.1 Create a Vercel account
1. Go to [vercel.com](https://vercel.com) and sign up with GitHub.
2. The Hobby plan (free) is sufficient.

### 2.2 Import the project
1. From the Vercel dashboard, click **"Add New" → "Project"**.
2. Select the **auto-mm-pilot** repository from the list.
3. **IMPORTANT** — Configure these settings before deploying:

   **Root Directory:**
   ```
   client/ui
   ```
   (Click "Edit" next to Root Directory and type `client/ui`)

   **Build & Output Settings:**
   - Vercel should auto-detect from `vercel.json`. If not, set manually:
   - **Build Command:** `VITE_WEB=true npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`

### 2.3 Set environment variables
1. In the project settings, go to **"Environment Variables"**.
2. Add:
   ```
   VITE_API_BASE = https://<your-railway-domain>
   ```
   For example:
   ```
   VITE_API_BASE = https://apt-server-production.up.railway.app
   ```
   **No trailing slash.**

### 2.4 Deploy
1. Click **"Deploy"**. Vercel builds the SPA and gives you a URL like:
   ```
   https://auto-mm-pilot-client.vercel.app
   ```

### 2.5 Verify
- Open the Vercel URL — you should see the trading terminal.
- The connection indicator should show CONNECTED (WebSocket to Railway).

---

## Part 3: CORS (already handled)

The FastAPI server has `allow_origins=["*"]` in its CORS middleware, so cross-origin requests from Vercel → Railway work out of the box.

For production hardening, you can restrict origins to your Vercel domain:
```python
allow_origins=["https://your-app.vercel.app"]
```

---

## Quick Reference

| What | URL |
|------|-----|
| Client terminal | `https://<vercel-domain>` |
| Admin dashboard | `https://<railway-domain>/admin` |
| Health check | `https://<railway-domain>/api/health` |
| WebSocket | `wss://<railway-domain>/ws` |

## Redeployment

- **Server changes** — Push to `main`. Railway auto-deploys.
- **Client changes** — Push to `main`. Vercel auto-deploys.
- Both platforms support branch preview deployments.

## Local Development

Nothing changes. `./start.sh` still works — the client defaults to `http://localhost:8000` when `VITE_API_BASE` is unset.

---

## Cost Estimates

| Platform | Plan | Estimate |
|----------|------|----------|
| **Railway** (Hobby) | $5/mo base + ~$0.000231/min CPU | ~$5–15/mo for light usage |
| **Vercel** (Hobby) | Free | $0/mo for static hosting |
