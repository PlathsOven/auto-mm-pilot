import { useFocus } from "../../providers/FocusProvider";
import { CellInspector } from "./inspectors/CellInspector";
import { SymbolExpiryInspector } from "./inspectors/SymbolExpiryInspector";
import { StreamInspector } from "./inspectors/StreamInspector";
import { OpinionInspector } from "./inspectors/OpinionInspector";
import { BlockInspector } from "./inspectors/BlockInspector";
import { EmptyInspector } from "./inspectors/EmptyInspector";

/**
 * Right-rail Inspector tab content.
 *
 * Pure router: switches on `focus.kind` and delegates to the matching
 * inspector component. Each inspector reads the focus payload itself so
 * adding a new focusable kind is a one-line addition here plus a new
 * inspector file.
 */
export function InspectorRouter() {
  const { focus } = useFocus();

  if (!focus) return <EmptyInspector />;

  switch (focus.kind) {
    case "cell":
      return <CellInspector symbol={focus.symbol} expiry={focus.expiry} />;
    case "symbol":
      return <SymbolExpiryInspector symbol={focus.symbol} expiry={null} />;
    case "expiry":
      return <SymbolExpiryInspector symbol={null} expiry={focus.expiry} />;
    case "stream":
      return <StreamInspector name={focus.name} />;
    case "opinion":
      return <OpinionInspector name={focus.name} />;
    case "block":
      return <BlockInspector blockKey={focus.key} />;
  }
}
