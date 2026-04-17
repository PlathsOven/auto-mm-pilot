#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Posit — Start all required services
#
# Services:
#   1. FastAPI backend   (server/api)  → http://localhost:8001
#   2. Vite dev server   (client/ui)   → http://localhost:5174
#
# Usage:
#   ./start.sh          Start all services (mock pipeline data)
#   ./start.sh --prod   Start all services (prod mode — waits for API data)
#   ./start.sh --stop   Kill any running Posit services on known ports
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$ROOT_DIR/server/venv"
LOG_DIR="$ROOT_DIR/.logs"
mkdir -p "$LOG_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Mode selection ────────────────────────────────────────────
POSIT_MODE="mock"
if [[ "${1:-}" == "--prod" ]]; then
  POSIT_MODE="prod"
  shift
fi

PIDS=()

cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down…${NC}"
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null || true
    fi
  done
  echo -e "${GREEN}All services stopped.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# --stop flag: kill anything on known ports
if [[ "${1:-}" == "--stop" ]]; then
  echo -e "${YELLOW}Stopping Posit services…${NC}"
  for port in 8001 5174; do
    pid=$(lsof -ti :"$port" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
      echo -e "  Killing PID $pid on port $port"
      kill "$pid" 2>/dev/null || true
    fi
  done
  echo -e "${GREEN}Done.${NC}"
  exit 0
fi

# ── 1. Check / create Python venv ──────────────────────────────
echo -e "${CYAN}[1/4]${NC} Checking Python virtual environment…"
if [[ ! -d "$VENV_DIR" ]]; then
  echo -e "  Creating venv at ${VENV_DIR}…"
  python3 -m venv "$VENV_DIR"
fi

echo -e "${CYAN}[2/4]${NC} Installing Python dependencies…"
"$VENV_DIR/bin/pip" install -q -r "$ROOT_DIR/server/api/requirements.txt"

# ── 2. Check .env ──────────────────────────────────────────────
if [[ ! -f "$ROOT_DIR/server/api/.env" ]]; then
  echo -e "${RED}WARNING:${NC} server/api/.env not found. Copy from .env.example and set OPENROUTER_API_KEY."
fi

# ── 3. Check node_modules ─────────────────────────────────────
echo -e "${CYAN}[3/4]${NC} Checking client dependencies…"
if [[ ! -d "$ROOT_DIR/client/ui/node_modules" ]]; then
  echo -e "  Installing npm packages…"
  (cd "$ROOT_DIR/client/ui" && npm install)
fi

# ── 4. Start services ─────────────────────────────────────────
echo -e "${CYAN}[4/4]${NC} Starting services…"
echo ""

# FastAPI backend
echo -e "  ${GREEN}▶${NC} FastAPI backend  → http://localhost:8001"
POSIT_MODE="$POSIT_MODE" PYTHONPATH="$ROOT_DIR" "$VENV_DIR/bin/uvicorn" server.api.main:app \
  --host 0.0.0.0 --port 8001 --reload \
  > "$LOG_DIR/server.log" 2>&1 &
PIDS+=($!)

# Vite dev server
echo -e "  ${GREEN}▶${NC} Vite dev server  → http://localhost:5174"
(cd "$ROOT_DIR/client/ui" && npm run dev) \
  > "$LOG_DIR/client.log" 2>&1 &
PIDS+=($!)

# Wait for servers to be ready
sleep 2
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Posit is running  (mode: ${POSIT_MODE})${NC}"
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "  Backend:  ${CYAN}http://localhost:8001${NC}"
echo -e "  Client:   ${CYAN}http://localhost:5174${NC}"
echo -e "  Admin:    ${CYAN}http://localhost:8001/admin${NC}"
echo -e "  Logs:     ${CYAN}.logs/server.log${NC}, ${CYAN}.logs/client.log${NC}"
echo ""
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop all services."
echo ""

# Keep alive until Ctrl+C
wait
