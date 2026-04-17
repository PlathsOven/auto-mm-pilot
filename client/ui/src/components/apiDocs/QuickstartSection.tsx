import { CodeBlock, Collapsible, Section } from "../ApiDocsParts";

/**
 * Quickstart — end-to-end send & receive walkthrough using the pre-configured
 * ``__test__`` stream.  By far the longest ApiDocs section; extracted to keep
 * ApiDocs.tsx under the 300-LOC convention.
 */
export function QuickstartSection() {
  return (
    <Section id="quickstart" title="Quickstart — Test Send & Receive">
      <p>
        This walkthrough verifies end-to-end connectivity using the
        pre-configured{" "}
        <code className="text-emerald-300">__test__</code> stream. No
        stream registration or admin setup required.
      </p>
      <p className="font-medium text-mm-text">You will open two connections:</p>
      <ul className="list-inside list-disc space-y-1 pl-1">
        <li>
          <code>/ws/client</code> — authenticated channel to <strong>send</strong> test
          data and receive ACKs
        </li>
        <li>
          <code>/ws</code> — read-only stream to <strong>receive</strong> position
          broadcasts (no auth required)
        </li>
      </ul>

      <div className="mt-3 space-y-3">
        <p className="text-xs font-semibold text-emerald-400">Step 1 — Open the position listener</p>
        <p>
          Connect to the read-only WebSocket. The server pushes a JSON
          payload every ~2 s. Before any data is ingested you will
          receive heartbeat frames with an empty <code>positions</code>{" "}
          array.
        </p>
        <CodeBlock>{`# Python (websockets)
import asyncio, websockets, json

async def listen():
    async with websockets.connect("wss://posit-admin.up.railway.app/ws") as ws:
        async for msg in ws:
            payload = json.loads(msg)
            n = len(payload["positions"])
            ts = payload["context"]["lastUpdateTimestamp"]
            print(f"[{ts}] {n} positions")

asyncio.run(listen())`}</CodeBlock>
        <p>
          In a browser console you can use the native WebSocket API:
        </p>
        <CodeBlock>{`const ws = new WebSocket("wss://posit-admin.up.railway.app/ws");
ws.onmessage = (e) => {
  const d = JSON.parse(e.data);
  console.log(d.context.lastUpdateTimestamp, d.positions.length, "positions");
};`}</CodeBlock>

        <p className="text-xs font-semibold text-emerald-400">Step 2 — Send test data</p>
        <p>
          In a <strong>separate</strong> terminal / script, connect to the
          authenticated client endpoint and push a snapshot frame to the{" "}
          <code>__test__</code> stream.
        </p>
        <CodeBlock>{`# Python (websockets)
import asyncio, websockets, json

API_KEY = "YOUR_KEY"  # must match CLIENT_WS_API_KEY on the server

async def send_test():
    uri = f"wss://posit-admin.up.railway.app/ws/client?api_key={API_KEY}"
    async with websockets.connect(uri) as ws:
        frame = {
            "seq": 1,
            "stream_name": "__test__",
            "rows": [
                {
                    "timestamp": "2026-01-15T12:00:00",
                    "raw_value": 0.55,
                    "symbol": "BTC"
                }
            ]
        }
        await ws.send(json.dumps(frame))
        ack = json.loads(await ws.recv())
        print("ACK:", ack)

asyncio.run(send_test())`}</CodeBlock>
        <p>You should receive:</p>
        <CodeBlock>{`{"type": "ack", "seq": 1, "rows_accepted": 1, "pipeline_rerun": true}`}</CodeBlock>

        <p className="text-xs font-semibold text-emerald-400">Step 3 — Observe positions</p>
        <p>
          Switch back to your <code>/ws</code> listener. After the ACK,
          the engine re-runs and broadcasts positions. You should see the
          <code> positions</code> count flip from 0 to a non-zero value.
        </p>
        <CodeBlock>{`[1710000000000] 0 positions
[1710000002000] 0 positions
[1710000004000] 4 positions   # ← engine produced output`}</CodeBlock>

        <p className="mt-1">
          The <code>__test__</code> stream uses an identity transform
          (scale=1, offset=0, exponent=1) with a default block
          configuration. It accepts rows with <code>timestamp</code>,{" "}
          <code>raw_value</code>, and <code>symbol</code>.
        </p>
      </div>

      <Collapsible title="Complete script — posit_test.py (copy & paste)">
        <p className="mb-2 text-mm-text-dim">
          Single-file script that sends a test snapshot and listens for
          position broadcasts. Requires <code>pip install websockets</code>.
        </p>
        <CodeBlock>{`#!/usr/bin/env python3
"""posit_test.py — Minimal Posit send & receive test.

Usage:
    pip install websockets
    python posit_test.py
"""

import asyncio
import json
import websockets

# ── Config ────────────────────────────────────────────────────────────────
HOST = "posit-admin.up.railway.app"
API_KEY = "YOUR_KEY"  # must match CLIENT_WS_API_KEY on the server

SEND_URI = f"wss://{HOST}/ws/client?api_key={API_KEY}"
LISTEN_URI = f"wss://{HOST}/ws"

TEST_FRAME = {
    "seq": 1,
    "stream_name": "__test__",
    "rows": [
        {
            "timestamp": "2026-01-15T12:00:00",
            "raw_value": 0.55,
            "symbol": "BTC",
        }
    ],
}

MAX_TICKS = 5  # how many position broadcasts to print before exiting


# ── Listener (read-only /ws) ──────────────────────────────────────────────
async def listen(started: asyncio.Event) -> None:
    async with websockets.connect(LISTEN_URI) as ws:
        started.set()
        count = 0
        async for msg in ws:
            payload = json.loads(msg)
            ts = payload["context"]["lastUpdateTimestamp"]
            n = len(payload["positions"])
            print(f"  [listen] {ts} — {n} positions")
            count += 1
            if count >= MAX_TICKS:
                break


# ── Sender (authenticated /ws/client) ─────────────────────────────────────
async def send(started: asyncio.Event) -> None:
    await started.wait()  # wait for listener to connect first
    await asyncio.sleep(0.5)
    async with websockets.connect(SEND_URI) as ws:
        print(f"  [send]   sending test frame ...")
        await ws.send(json.dumps(TEST_FRAME))
        ack = json.loads(await ws.recv())
        print(f"  [send]   ACK: {json.dumps(ack)}")


# ── Main ──────────────────────────────────────────────────────────────────
async def main() -> None:
    print(f"Connecting to {HOST} ...\\n")
    started = asyncio.Event()
    listener = asyncio.create_task(listen(started))
    sender = asyncio.create_task(send(started))
    await asyncio.gather(sender, listener)
    print("\\nDone.")


if __name__ == "__main__":
    asyncio.run(main())`}</CodeBlock>
      </Collapsible>
    </Section>
  );
}
