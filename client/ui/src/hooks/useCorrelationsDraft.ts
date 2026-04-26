import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ExpiryCorrelationEntry,
  ExpiryCorrelationListResponse,
  SymbolCorrelationEntry,
  SymbolCorrelationListResponse,
} from "../types";
import {
  applyExpiryCorrelationMethod,
  confirmExpiryCorrelations,
  confirmSymbolCorrelations,
  discardExpiryCorrelations,
  discardSymbolCorrelations,
  listExpiryCorrelations,
  listSymbolCorrelations,
  setExpiryCorrelationsDraft,
  setSymbolCorrelationsDraft,
} from "../services/correlationsApi";

// Debounce the per-edit PUT so a drag-adjust or rapid typing fires one
// request, not N. 500ms matches the market-value edit pattern.
const DRAFT_PUT_DEBOUNCE_MS = 500;

export type CorrelationKind = "symbols" | "expiries";
type Entry = SymbolCorrelationEntry | ExpiryCorrelationEntry;

type ListResponse = SymbolCorrelationListResponse | ExpiryCorrelationListResponse;

interface ApiHandlers {
  list: () => Promise<ListResponse>;
  setDraft: (entries: Entry[]) => Promise<ListResponse>;
  confirm: () => Promise<ListResponse>;
  discard: () => Promise<ListResponse>;
}

function handlersFor(kind: CorrelationKind): ApiHandlers {
  if (kind === "symbols") {
    return {
      list: listSymbolCorrelations,
      setDraft: (entries) =>
        setSymbolCorrelationsDraft({ entries: entries as SymbolCorrelationEntry[] }),
      confirm: confirmSymbolCorrelations,
      discard: discardSymbolCorrelations,
    };
  }
  return {
    list: listExpiryCorrelations,
    setDraft: (entries) =>
      setExpiryCorrelationsDraft({ entries: entries as ExpiryCorrelationEntry[] }),
    confirm: confirmExpiryCorrelations,
    discard: discardExpiryCorrelations,
  };
}

/** Canonicalise a ``(a, b)`` pair into the upper-triangle order the
 *  server uses. Keeps the in-memory map keys stable regardless of which
 *  direction the caller edits from. */
export function canonicalPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

export interface CorrelationsDraftState {
  committed: Entry[];
  /** Local draft — ``null`` when no draft is live. Reflects the in-flight
   *  edits immediately; the debounce flushes to the server. */
  localDraft: Entry[] | null;
  /** Loading state for the initial GET. Editor renders a skeleton while true. */
  loading: boolean;
  /** Non-null when a PUT / confirm / discard failed. Editor renders inline. */
  error: string | null;
  /** Set to true while a debounced PUT is in flight. */
  saving: boolean;

  /** Apply an edit to the draft matrix at ``(a, b)``. Normalises the pair
   *  to upper-triangle + schedules the debounced PUT. */
  setRho: (a: string, b: string, rho: number) => void;
  /** Promote draft → committed. No-op when no draft is live. */
  confirm: () => Promise<void>;
  /** Clear the draft slot. */
  discard: () => Promise<void>;
  /** Re-fetch (e.g. after a WS reconnect). */
  refresh: () => Promise<void>;
  /** Expiries only — fills the draft via a named calculator. ``null`` on
   *  the symbols slot. Cancels any pending PUT debounce so the method's
   *  matrix isn't overwritten by a stale per-cell edit. */
  applyMethod:
    | ((methodName: string, params: Record<string, number>, expiries: string[]) => Promise<void>)
    | null;
}

/**
 * Owns the two-slot client state for one correlation matrix (symbols or
 * expiries). Every edit debounces into a PUT to ``/draft`` — the server
 * sets the dirty flag and the WS ticker picks it up on the next tick.
 * Confirm and Discard bypass debounce (user-driven transitions).
 */
export function useCorrelationsDraft(kind: CorrelationKind): CorrelationsDraftState {
  const handlers = useMemo(() => handlersFor(kind), [kind]);

  const [committed, setCommitted] = useState<Entry[]>([]);
  const [localDraft, setLocalDraft] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<Entry[] | null>(null);
  // Track cancellation of the in-flight PUT so a rapid edit sequence
  // doesn't stomp a newer draft with a stale server response.
  const putGenerationRef = useRef(0);

  const applyResponse = useCallback((r: ListResponse) => {
    setCommitted(r.committed);
    setLocalDraft(r.draft);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await handlers.list();
      applyResponse(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [handlers, applyResponse]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await handlers.list();
        if (!cancelled) applyResponse(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [handlers, applyResponse]);

  const flushDraft = useCallback(async () => {
    const toSend = pendingDraftRef.current;
    if (toSend === null) return;
    const generation = ++putGenerationRef.current;
    setSaving(true);
    try {
      const r = await handlers.setDraft(toSend);
      if (generation !== putGenerationRef.current) return;  // superseded
      applyResponse(r);
    } catch (e) {
      if (generation === putGenerationRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (generation === putGenerationRef.current) setSaving(false);
    }
  }, [handlers, applyResponse]);

  const scheduleFlush = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void flushDraft();
    }, DRAFT_PUT_DEBOUNCE_MS);
  }, [flushDraft]);

  const setRho = useCallback((a: string, b: string, rho: number) => {
    const [ca, cb] = canonicalPair(a, b);
    setLocalDraft((prev) => {
      // Seed from committed when no draft exists yet.
      const base = prev ?? committed;
      const next: Entry[] = [];
      let replaced = false;
      for (const e of base) {
        if (e.a === ca && e.b === cb) {
          next.push({ ...e, rho } as Entry);
          replaced = true;
        } else {
          next.push(e);
        }
      }
      if (!replaced) next.push({ a: ca, b: cb, rho } as Entry);
      pendingDraftRef.current = next;
      return next;
    });
    scheduleFlush();
  }, [committed, scheduleFlush]);

  const confirm = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      // Wait for any in-flight PUT the debounce was about to issue so
      // we don't confirm a stale server-side draft.
      if (pendingDraftRef.current !== null) {
        await flushDraft();
      }
    }
    try {
      const r = await handlers.confirm();
      applyResponse(r);
      pendingDraftRef.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [handlers, applyResponse, flushDraft]);

  const discard = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingDraftRef.current = null;
    try {
      const r = await handlers.discard();
      applyResponse(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [handlers, applyResponse]);

  // applyMethod is expiry-only — the server exposes no symbol calculator.
  // We memoize a stable callback per-kind so MethodPicker's useEffect deps
  // stay well-behaved.
  const applyMethod = useMemo<CorrelationsDraftState["applyMethod"]>(() => {
    if (kind !== "expiries") return null;
    return async (
      methodName: string,
      params: Record<string, number>,
      expiries: string[],
    ) => {
      // Cancel any queued per-cell PUT; the method's matrix becomes the
      // new draft and we don't want a stale edit to clobber it.
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingDraftRef.current = null;
      putGenerationRef.current += 1;  // supersede any in-flight PUT
      try {
        const r = await applyExpiryCorrelationMethod({
          method_name: methodName,
          params,
          expiries,
        });
        applyResponse(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    };
  }, [kind, applyResponse]);

  return {
    committed,
    localDraft,
    loading,
    error,
    saving,
    setRho,
    confirm,
    discard,
    refresh,
    applyMethod,
  };
}
