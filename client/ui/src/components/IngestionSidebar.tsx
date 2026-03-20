import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../providers/WebSocketProvider";
import {
  createStream,
  deleteStream,
  listStreams,
  updateStream,
} from "../services/streamApi";
import type { RegisteredStream, RegisteredStreamStatus, StreamStatus } from "../types";

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

const LIVE_STATUS_COLORS: Record<StreamStatus, string> = {
  ONLINE: "bg-mm-accent",
  DEGRADED: "bg-mm-warn",
  OFFLINE: "bg-mm-error",
};

const LIVE_STATUS_TEXT: Record<StreamStatus, string> = {
  ONLINE: "text-mm-accent",
  DEGRADED: "text-mm-warn",
  OFFLINE: "text-mm-error",
};

const REG_STATUS_DOT: Record<RegisteredStreamStatus, string> = {
  PENDING: "bg-mm-warn",
  READY: "bg-mm-accent",
};

const REG_STATUS_TEXT: Record<RegisteredStreamStatus, string> = {
  PENDING: "text-mm-warn",
  READY: "text-mm-accent",
};

function formatAge(ms: number): string {
  if (ms < 1000) return "just now";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}

// ---------------------------------------------------------------------------
// Create Stream Form
// ---------------------------------------------------------------------------

function CreateStreamForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [keyCols, setKeyCols] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const cols = keyCols
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    if (!trimmedName) {
      setError("Stream name is required");
      return;
    }
    if (cols.length === 0) {
      setError("At least one key column is required");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createStream(trimmedName, cols);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-mm-accent/30 bg-mm-bg/80 p-3">
      <input
        ref={inputRef}
        type="text"
        placeholder="Stream name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        className="rounded border border-mm-border/40 bg-mm-bg-deep px-2 py-1 text-xs text-mm-text placeholder:text-mm-text-dim focus:border-mm-accent/60 focus:outline-none"
      />
      <input
        type="text"
        placeholder="Key columns (comma-separated)"
        value={keyCols}
        onChange={(e) => setKeyCols(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        className="rounded border border-mm-border/40 bg-mm-bg-deep px-2 py-1 text-xs text-mm-text placeholder:text-mm-text-dim focus:border-mm-accent/60 focus:outline-none"
      />
      {error && <p className="text-[10px] text-mm-error">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex-1 rounded bg-mm-accent/20 px-2 py-1 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30 disabled:opacity-50"
        >
          {submitting ? "Creating\u2026" : "Create"}
        </button>
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:text-mm-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit Stream Inline
// ---------------------------------------------------------------------------

function EditStreamInline({
  stream,
  onSaved,
  onCancel,
}: {
  stream: RegisteredStream;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(stream.stream_name);
  const [keyCols, setKeyCols] = useState(stream.key_cols.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const cols = keyCols
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);

    if (!trimmedName) {
      setError("Stream name is required");
      return;
    }
    if (cols.length === 0) {
      setError("At least one key column is required");
      return;
    }

    const patch: { stream_name?: string; key_cols?: string[] } = {};
    if (trimmedName !== stream.stream_name) patch.stream_name = trimmedName;
    if (JSON.stringify(cols) !== JSON.stringify(stream.key_cols)) patch.key_cols = cols;

    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateStream(stream.stream_name, patch);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-mm-accent/30 bg-mm-bg/80 p-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        className="rounded border border-mm-border/40 bg-mm-bg-deep px-2 py-1 text-xs text-mm-text focus:border-mm-accent/60 focus:outline-none"
      />
      <input
        type="text"
        value={keyCols}
        onChange={(e) => setKeyCols(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        className="rounded border border-mm-border/40 bg-mm-bg-deep px-2 py-1 text-xs text-mm-text focus:border-mm-accent/60 focus:outline-none"
      />
      {error && <p className="text-[10px] text-mm-error">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={submitting}
          className="flex-1 rounded bg-mm-accent/20 px-2 py-1 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30 disabled:opacity-50"
        >
          {submitting ? "Saving\u2026" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="rounded px-2 py-1 text-[10px] text-mm-text-dim transition-colors hover:text-mm-text"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registered Stream Card
// ---------------------------------------------------------------------------

function RegisteredStreamCard({
  stream,
  onRefresh,
}: {
  stream: RegisteredStream;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteStream(stream.stream_name);
      onRefresh();
    } catch {
      setDeleting(false);
    }
  };

  if (editing) {
    return (
      <EditStreamInline
        stream={stream}
        onSaved={() => {
          setEditing(false);
          onRefresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-mm-border/40 bg-mm-bg/50 p-3 transition-colors hover:bg-mm-bg/80">
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${REG_STATUS_DOT[stream.status]}`}
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-xs font-medium text-mm-text">
          {stream.stream_name}
        </span>

        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] font-medium ${REG_STATUS_TEXT[stream.status]}`}>
            {stream.status}
          </span>
          <span className="text-[10px] text-mm-text-dim">
            {stream.key_cols.join(", ")}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => setEditing(true)}
          title="Edit"
          className="rounded p-1 text-[10px] text-mm-text-dim transition-colors hover:text-mm-accent"
        >
          &#9998;
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          title="Delete"
          className="rounded p-1 text-[10px] text-mm-text-dim transition-colors hover:text-mm-error disabled:opacity-50"
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main sidebar
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5000;

export function IngestionSidebar() {
  const { payload } = useWebSocket();
  const liveStreams = payload?.streams ?? [];

  const [registeredStreams, setRegisteredStreams] = useState<RegisteredStream[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchStreams = useCallback(async () => {
    try {
      const streams = await listStreams();
      setRegisteredStreams(streams);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchStreams();
    const id = setInterval(fetchStreams, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStreams]);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-mm-border/40 pb-2">
        <h2 className="zone-header">Data Streams</h2>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="rounded bg-mm-accent/20 px-2 py-0.5 text-[10px] font-medium text-mm-accent transition-colors hover:bg-mm-accent/30"
          >
            + Add
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {/* Create form */}
        {showCreate && (
          <CreateStreamForm
            onCreated={() => {
              setShowCreate(false);
              fetchStreams();
            }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Registered streams (from REST API) */}
        {registeredStreams.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-mm-text-dim">
              Registry
            </p>
            {registeredStreams.map((stream) => (
              <RegisteredStreamCard
                key={stream.stream_name}
                stream={stream}
                onRefresh={fetchStreams}
              />
            ))}
          </div>
        )}

        {/* Live streams (from WS payload) */}
        {liveStreams.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-mm-text-dim">
              Live
            </p>
            {liveStreams.map((stream) => (
              <div
                key={stream.id}
                className="flex items-center gap-3 rounded-lg border border-mm-border/40 bg-mm-bg/50 p-3 transition-colors hover:bg-mm-bg/80"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${LIVE_STATUS_COLORS[stream.status]}`}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-xs font-medium text-mm-text">
                    {stream.name}
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[10px] font-medium ${LIVE_STATUS_TEXT[stream.status]}`}>
                      {stream.status}
                    </span>
                    <span className="text-[10px] text-mm-text-dim">
                      {formatAge(Date.now() - stream.lastHeartbeat)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {registeredStreams.length === 0 && liveStreams.length === 0 && !showCreate && (
          <p className="text-xs text-mm-text-dim">
            No streams registered. Click <strong>+ Add</strong> to create one.
          </p>
        )}

        {/* Load error */}
        {loadError && (
          <p className="text-[10px] text-mm-error">
            Failed to load streams: {loadError}
          </p>
        )}
      </div>
    </div>
  );
}
