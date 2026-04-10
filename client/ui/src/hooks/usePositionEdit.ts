import { useState, useRef, useCallback, useEffect } from "react";
import type { DesiredPosition } from "../types";
import { getCellValue } from "../components/grid-config";
import type { ViewMode } from "../components/grid-config";

export interface PendingEdit {
  key: string;
  symbol: string;
  expiry: string;
  value: string;
  aptValue: number;
}

export function usePositionEdit() {
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevEditKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (pendingEdit && inputRef.current && prevEditKeyRef.current !== pendingEdit.key) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    prevEditKeyRef.current = pendingEdit?.key ?? null;
  }, [pendingEdit]);

  const getDisplayValue = useCallback(
    (key: string, pos: DesiredPosition, mode: ViewMode, change: number): number => {
      if (mode === "position" && overrides.has(key)) return overrides.get(key)!;
      return getCellValue(pos, mode, change);
    },
    [overrides],
  );

  const startEdit = useCallback(
    (key: string, symbol: string, expiry: string, pos: DesiredPosition, viewMode: ViewMode) => {
      if (viewMode !== "position") return;
      const current = overrides.has(key) ? overrides.get(key)! : pos.desiredPos;
      setPendingEdit({ key, symbol, expiry, value: String(current), aptValue: pos.desiredPos });
    },
    [overrides],
  );

  const confirmEdit = useCallback(() => {
    if (!pendingEdit) return;
    const parsed = parseFloat(pendingEdit.value);
    if (isNaN(parsed)) { setPendingEdit(null); return; }
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(pendingEdit.key, parsed);
      return next;
    });
    setPendingEdit(null);
  }, [pendingEdit]);

  const cancelEdit = useCallback(() => setPendingEdit(null), []);

  const removeOverride = useCallback((key: string) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  return {
    pendingEdit, setPendingEdit, overrides, inputRef,
    startEdit, confirmEdit, cancelEdit, removeOverride,
    getDisplayValue,
  };
}
