/**
 * Default Inspector content when nothing is focused.
 *
 * Tells the user what the panel does without screaming. Lists the click
 * gestures that channel content here so the discovery cost is obvious.
 */
export function EmptyInspector() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-baseline gap-2 border-b border-black/[0.06] pb-2">
        <h2 className="zone-header">Inspector</h2>
        <span className="text-[10px] text-mm-text-dim">— click anything to channel</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto text-[11px] text-mm-text-dim">
        <p>Select an entity from the workbench to inspect it here.</p>
        <ul className="flex flex-col gap-1.5 text-[10px]">
          <li className="flex items-baseline gap-2">
            <span className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px]">cell</span>
            <span>position grid → edge / variance / contributing blocks</span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px]">symbol</span>
            <span>row header → pipeline chart channelled to that symbol</span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px]">expiry</span>
            <span>column header → pipeline chart channelled to that expiry</span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px]">stream</span>
            <span>data streams list → key-column time series</span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px]">block</span>
            <span>block table → engine parameters + outputs</span>
          </li>
        </ul>
        <p className="mt-2 text-[10px] text-mm-text-subtle">Press <kbd className="rounded border border-black/[0.08] bg-black/[0.03] px-1 font-mono text-[9px]">?</kbd> for the full keyboard cheatsheet.</p>
      </div>
    </div>
  );
}
