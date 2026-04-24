import { useCallback, useEffect, useState } from "react";
import type { RegisteredStream } from "../types";
import { listStreams } from "../services/streamApi";
import { POLL_INTERVAL_STREAMS_MS } from "../constants";

interface StreamsState {
  streams: RegisteredStream[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Optimistically inject a newly-created stream so subscribers see it
   *  without waiting for the next poll cycle. */
  addStream: (stream: RegisteredStream) => void;
}

// Module-level cache shared across subscribers so Anatomy's StreamNode
// popovers and StreamCanvas don't each hit the API independently.
interface Cache {
  streams: RegisteredStream[];
  loading: boolean;
  error: string | null;
  lastFetch: number;
  inFlight: Promise<void> | null;
  subscribers: Set<() => void>;
  intervalId: ReturnType<typeof setInterval> | null;
}

const cache: Cache = {
  streams: [],
  loading: true,
  error: null,
  lastFetch: 0,
  inFlight: null,
  subscribers: new Set(),
  intervalId: null,
};

function notify() {
  for (const cb of cache.subscribers) cb();
}

async function doFetch(): Promise<void> {
  if (cache.inFlight) return cache.inFlight;
  cache.inFlight = (async () => {
    try {
      const streams = await listStreams();
      cache.streams = streams;
      cache.error = null;
    } catch (err) {
      cache.error = err instanceof Error ? err.message : String(err);
    } finally {
      cache.loading = false;
      cache.lastFetch = Date.now();
      cache.inFlight = null;
      notify();
    }
  })();
  return cache.inFlight;
}

function ensurePolling() {
  if (cache.intervalId !== null) return;
  cache.intervalId = setInterval(() => {
    if (cache.subscribers.size > 0) doFetch();
  }, POLL_INTERVAL_STREAMS_MS);
}

function stopPolling() {
  if (cache.intervalId !== null && cache.subscribers.size === 0) {
    clearInterval(cache.intervalId);
    cache.intervalId = null;
  }
}

/**
 * Shared registered-streams hook.
 *
 * Every subscriber sees the same cached list and a single 5s poll drives all
 * of them. Consumers include Anatomy's `StreamNode` popover and
 * `StreamCanvas` (create/edit form).
 *
 * Returns `{ streams, loading, error, refresh }`. Call `refresh()` after a
 * mutation to force an immediate refetch for all subscribers.
 */
export function useRegisteredStreams(): StreamsState {
  const [, forceRerender] = useState(0);

  useEffect(() => {
    const subscriber = () => forceRerender((n) => n + 1);
    cache.subscribers.add(subscriber);
    ensurePolling();
    // First mount kicks a fetch if the cache is stale (or empty).
    if (cache.lastFetch === 0 || Date.now() - cache.lastFetch > POLL_INTERVAL_STREAMS_MS) {
      doFetch();
    }
    return () => {
      cache.subscribers.delete(subscriber);
      stopPolling();
    };
  }, []);

  const refresh = useCallback(async () => {
    await doFetch();
  }, []);

  const addStream = useCallback((stream: RegisteredStream) => {
    // Replace any existing entry with the same name (e.g. an admin re-create),
    // otherwise append. Notify synchronously so callers can rely on the new
    // entry being visible on the next render without awaiting any I/O.
    const idx = cache.streams.findIndex((s) => s.stream_name === stream.stream_name);
    if (idx === -1) {
      cache.streams = [...cache.streams, stream];
    } else {
      const next = cache.streams.slice();
      next[idx] = stream;
      cache.streams = next;
    }
    notify();
  }, []);

  return {
    streams: cache.streams,
    loading: cache.loading,
    error: cache.error,
    refresh,
    addStream,
  };
}
