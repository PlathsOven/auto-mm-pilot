import { useCallback } from "react";
import { emptyRow, type Draft } from "./blockDrawerState";

type SetDraft = (updater: (d: Draft) => Draft) => void;

/**
 * Callbacks that mutate the snapshot table inside a block-drawer draft.
 *
 * Extracted from ``BlockDrawer.tsx`` to keep the component body focused
 * on layout and submission.  All six callbacks work off the same
 * ``setDraft`` setter — the hook just names them.
 */
export function useSnapshotEditor(setDraft: SetDraft) {
  const onHeaderChange = useCallback(
    (idx: number, val: string) => {
      setDraft((d) => {
        const old = d.snapshot_headers[idx];
        const headers = [...d.snapshot_headers];
        headers[idx] = val;
        const rows = d.snapshot_rows.map((r) => {
          const nr = { ...r };
          if (old in nr) {
            nr[val] = nr[old];
            delete nr[old];
          }
          return nr;
        });
        return { ...d, snapshot_headers: headers, snapshot_rows: rows };
      });
    },
    [setDraft],
  );

  const onAddHeader = useCallback(() => {
    setDraft((d) => {
      const name = `col_${d.snapshot_headers.length}`;
      return {
        ...d,
        snapshot_headers: [...d.snapshot_headers, name],
        snapshot_rows: d.snapshot_rows.map((r) => ({ ...r, [name]: "" })),
      };
    });
  }, [setDraft]);

  const onRemoveHeader = useCallback(
    (idx: number) => {
      setDraft((d) => {
        const col = d.snapshot_headers[idx];
        const headers = d.snapshot_headers.filter((_, i) => i !== idx);
        const rows = d.snapshot_rows.map((r) => {
          const nr = { ...r };
          delete nr[col];
          return nr;
        });
        return { ...d, snapshot_headers: headers, snapshot_rows: rows };
      });
    },
    [setDraft],
  );

  const onCellChange = useCallback(
    (rowIdx: number, col: string, val: string) => {
      setDraft((d) => {
        const rows = [...d.snapshot_rows];
        rows[rowIdx] = { ...rows[rowIdx], [col]: val };
        return { ...d, snapshot_rows: rows };
      });
    },
    [setDraft],
  );

  const onAddRow = useCallback(() => {
    setDraft((d) => ({
      ...d,
      snapshot_rows: [...d.snapshot_rows, emptyRow(d.snapshot_headers)],
    }));
  }, [setDraft]);

  const onRemoveRow = useCallback(
    (idx: number) => {
      setDraft((d) => ({
        ...d,
        snapshot_rows: d.snapshot_rows.filter((_, i) => i !== idx),
      }));
    },
    [setDraft],
  );

  return { onHeaderChange, onAddHeader, onRemoveHeader, onCellChange, onAddRow, onRemoveRow };
}
