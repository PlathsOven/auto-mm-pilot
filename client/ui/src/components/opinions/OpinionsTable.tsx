/**
 * Opinions tab table — the trader-facing list of beliefs driving the book.
 *
 * Columns: concerns dot · name · description (inline editable) · last
 * update · source · active toggle · delete. Click a row body to set
 * opinion focus; the OpinionInspector opens in the right rail. Click the
 * description cell to edit inline; click the trash to reveal a "Delete?"
 * confirmation that a second click actually deletes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useFocus } from "../../providers/FocusProvider";
import {
  deleteOpinion,
  fetchOpinions,
  patchOpinionActive,
  patchOpinionDescription,
} from "../../services/opinionsApi";
import type { Opinion } from "../../types";
import { formatAge } from "../../utils";

const POLL_INTERVAL_OPINIONS_MS = 4000;

export function OpinionsTable() {
  const { toggleFocus, isFocused } = useFocus();
  const [opinions, setOpinions] = useState<Opinion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, "active" | "delete">>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const confirmTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let aborted = false;
    const load = async () => {
      try {
        const next = await fetchOpinions();
        if (aborted) return;
        setOpinions(next);
        setError(null);
      } catch (err) {
        if (aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    load();
    const id = setInterval(load, POLL_INTERVAL_OPINIONS_MS);
    return () => {
      aborted = true;
      clearInterval(id);
    };
  }, []);

  // Clear a lingering confirm-delete prompt when the user moves focus elsewhere.
  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current != null) window.clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  const onRowClick = useCallback(
    (name: string) => toggleFocus({ kind: "opinion", name }),
    [toggleFocus],
  );

  const onToggleActive = useCallback(
    async (name: string, active: boolean) => {
      setPending((p) => ({ ...p, [name]: "active" }));
      setError(null);
      try {
        const updated = await patchOpinionActive(name, active);
        setOpinions((prev) =>
          prev ? prev.map((o) => (o.name === name ? updated : o)) : prev,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[name];
          return next;
        });
      }
    },
    [],
  );

  const onSaveDescription = useCallback(
    async (name: string, description: string | null) => {
      try {
        const updated = await patchOpinionDescription(name, description);
        setOpinions((prev) =>
          prev ? prev.map((o) => (o.name === name ? updated : o)) : prev,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const onDelete = useCallback(
    async (name: string) => {
      setPending((p) => ({ ...p, [name]: "delete" }));
      setError(null);
      try {
        await deleteOpinion(name);
        setOpinions((prev) => (prev ? prev.filter((o) => o.name !== name) : prev));
        setConfirmDelete(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending((p) => {
          const next = { ...p };
          delete next[name];
          return next;
        });
      }
    },
    [],
  );

  const onRequestDelete = useCallback((name: string) => {
    setConfirmDelete(name);
    if (confirmTimeoutRef.current != null) window.clearTimeout(confirmTimeoutRef.current);
    // Auto-clear the confirm after 4 seconds so the row doesn't stay armed forever.
    confirmTimeoutRef.current = window.setTimeout(() => {
      setConfirmDelete((cur) => (cur === name ? null : cur));
      confirmTimeoutRef.current = null;
    }, 4000);
  }, []);

  if (opinions == null) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[11px] text-mm-text-dim">Loading opinions…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <p className="mx-3 mt-2 rounded-md border border-mm-error/30 bg-mm-error/[0.06] px-2 py-1 text-[10px] text-mm-error">
          {error}
        </p>
      )}
      {opinions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex max-w-sm flex-col gap-1 text-center">
            <p className="text-[12px] font-medium text-mm-text">No opinions yet.</p>
            <p className="text-[11px] text-mm-text-dim">
              Register a data stream in Anatomy, or click <span className="font-mono text-mm-text">+ New opinion</span> to capture a discretionary view.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-white/70 backdrop-blur text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
              <tr>
                <th className="px-2 py-1.5 text-left" />
                <th className="px-2 py-1.5 text-left">Name</th>
                <th className="px-2 py-1.5 text-left">Description</th>
                <th className="px-2 py-1.5 text-left">Last update</th>
                <th className="px-2 py-1.5 text-left">Source</th>
                <th className="px-2 py-1.5 text-left">Blocks</th>
                <th className="px-2 py-1.5 text-right">Status</th>
                <th className="px-2 py-1.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {opinions.map((o) => (
                <OpinionRow
                  key={o.name}
                  opinion={o}
                  focused={isFocused({ kind: "opinion", name: o.name })}
                  pendingAction={pending[o.name] ?? null}
                  confirmingDelete={confirmDelete === o.name}
                  onClick={() => onRowClick(o.name)}
                  onToggleActive={() => onToggleActive(o.name, !o.active)}
                  onSaveDescription={(next) => onSaveDescription(o.name, next)}
                  onRequestDelete={() => onRequestDelete(o.name)}
                  onConfirmDelete={() => onDelete(o.name)}
                  onCancelDelete={() => setConfirmDelete(null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  opinion: Opinion;
  focused: boolean;
  pendingAction: "active" | "delete" | null;
  confirmingDelete: boolean;
  onClick: () => void;
  onToggleActive: () => void;
  onSaveDescription: (next: string | null) => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function OpinionRow({
  opinion,
  focused,
  pendingAction,
  confirmingDelete,
  onClick,
  onToggleActive,
  onSaveDescription,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: RowProps) {
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState(opinion.description ?? "");

  useEffect(() => {
    setDescDraft(opinion.description ?? "");
  }, [opinion.description]);

  const commitDescription = useCallback(() => {
    setEditingDescription(false);
    const current = opinion.description ?? "";
    if (descDraft !== current) {
      onSaveDescription(descDraft.trim() ? descDraft : null);
    }
  }, [descDraft, opinion.description, onSaveDescription]);

  const cancelDescription = useCallback(() => {
    setDescDraft(opinion.description ?? "");
    setEditingDescription(false);
  }, [opinion.description]);

  const hasExplicitDescription =
    opinion.description != null && opinion.description.trim().length > 0;
  const displayDescription = hasExplicitDescription
    ? opinion.description
    : opinion.original_phrasing;

  const inactive = !opinion.active;
  const lastUpdateLabel = opinion.last_update
    ? formatAge(Date.now() - new Date(opinion.last_update).getTime())
    : "—";

  return (
    <tr
      className={`cursor-pointer border-t border-black/[0.04] transition-colors ${
        focused ? "bg-mm-accent-soft" : "hover:bg-mm-accent/5"
      } ${inactive ? "opacity-60" : ""}`}
      onClick={onClick}
    >
      <td className="px-2 py-1.5 align-middle" onClick={(e) => e.stopPropagation()}>
        {opinion.has_concerns ? (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
            title="Build-orchestrator flagged concerns at commit"
          />
        ) : null}
      </td>
      <td className="px-2 py-1.5 align-middle">
        <span className={`font-medium ${focused ? "text-mm-accent" : "text-mm-text"}`}>
          {opinion.name}
        </span>
      </td>
      <td
        className="px-2 py-1.5 align-middle"
        onClick={(e) => {
          e.stopPropagation();
          setEditingDescription(true);
        }}
        title="Click to edit"
      >
        {editingDescription ? (
          <input
            type="text"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDescription}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDescription();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelDescription();
              }
            }}
            placeholder={opinion.original_phrasing ?? "What's this opinion about?"}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded border border-mm-accent bg-white px-1.5 py-0.5 text-[11px] text-mm-text focus:outline-none focus:ring-1 focus:ring-mm-accent/40"
          />
        ) : displayDescription ? (
          <span
            className={`block truncate ${hasExplicitDescription ? "text-mm-text" : "italic text-mm-text-subtle"}`}
          >
            {hasExplicitDescription ? displayDescription : `"${displayDescription}"`}
          </span>
        ) : (
          <span className="italic text-mm-text-subtle">click to add</span>
        )}
      </td>
      <td className="px-2 py-1.5 align-middle tabular-nums text-[10px] text-mm-text-subtle">
        {lastUpdateLabel}
      </td>
      <td className="px-2 py-1.5 align-middle">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
            opinion.kind === "stream"
              ? "bg-mm-accent/10 text-mm-accent"
              : "bg-mm-warn/15 text-mm-warn"
          }`}
        >
          {opinion.kind === "stream" ? "Data" : "View"}
        </span>
      </td>
      <td className="px-2 py-1.5 align-middle tabular-nums text-mm-text-dim">
        {opinion.block_count}
      </td>
      <td className="px-2 py-1.5 align-middle text-right" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onToggleActive}
          disabled={pendingAction === "active"}
          className={`rounded-md p-1 text-[11px] transition-colors disabled:cursor-wait disabled:opacity-50 ${
            inactive
              ? "text-mm-text-dim hover:bg-mm-accent/10 hover:text-mm-accent"
              : "text-mm-text-subtle hover:bg-mm-warn/10 hover:text-mm-warn"
          }`}
          title={inactive ? "Include in pipeline" : "Hide from pipeline (data is preserved)"}
          aria-label={inactive ? `Reactivate ${opinion.name}` : `Deactivate ${opinion.name}`}
        >
          {POWER_ICON}
        </button>
      </td>
      <td className="px-2 py-1.5 align-middle text-right" onClick={(e) => e.stopPropagation()}>
        {confirmingDelete ? (
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={pendingAction === "delete"}
              className="rounded-md border border-mm-error/40 bg-mm-error/10 px-2 py-0.5 text-[10px] font-semibold text-mm-error transition-colors hover:bg-mm-error/20 disabled:cursor-wait disabled:opacity-50"
            >
              Delete?
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="rounded-md px-1 py-0.5 text-[10px] text-mm-text-subtle transition-colors hover:bg-black/[0.04]"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onRequestDelete}
            className="rounded-md p-1 text-[11px] text-mm-text-subtle transition-colors hover:bg-mm-error/10 hover:text-mm-error"
            title="Delete opinion"
            aria-label={`Delete ${opinion.name}`}
          >
            {TRASH_ICON}
          </button>
        )}
      </td>
    </tr>
  );
}

const POWER_ICON = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M8 2v6" />
    <path d="M4.5 4.5a5 5 0 1 0 7 0" />
  </svg>
);

const TRASH_ICON = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M3 4h10" />
    <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M4.5 4.5l.6 9a1 1 0 0 0 1 1h3.8a1 1 0 0 0 1-1l.6-9" />
    <path d="M6.5 7v5" />
    <path d="M9.5 7v5" />
  </svg>
);
