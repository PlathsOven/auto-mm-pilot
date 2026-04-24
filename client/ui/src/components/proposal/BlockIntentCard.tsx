/**
 * Read-only "Why this block exists" card.
 *
 * Mounted by StreamInspector + BlockInspector for any stream that was
 * committed via the Build orchestrator. Renders the trader's verbatim
 * phrasing, the preset name or custom-derivation reasoning, and the
 * commit timestamp. Hidden entirely when the server reports 404 — showing
 * a "no intent recorded" placeholder for every pre-M3 or manual-drawer
 * block would just be noise.
 */
import { useStreamIntent } from "../../hooks/useStreamIntent";
import type { StoredBlockIntent } from "../../types";

interface Props {
  streamName: string;
}

export function BlockIntentCard({ streamName }: Props) {
  const state = useStreamIntent(streamName);

  if (state.status === "loading" || state.status === "hidden") return null;

  if (state.status === "error") {
    return (
      <section className="rounded-md border border-black/[0.06] bg-white/40 px-3 py-2 text-[10px] text-mm-text-dim">
        Couldn&rsquo;t load intent — {state.error}
      </section>
    );
  }

  return <IntentCardBody intent={state.intent} />;
}

function IntentCardBody({ intent }: { intent: StoredBlockIntent }) {
  const choice = intent.synthesis.choice;
  const heading =
    choice.mode === "preset" ? `Preset · ${choice.preset_id}` : "Custom derivation";
  const concerns =
    choice.mode === "custom" ? choice.critique?.concerns ?? [] : [];

  return (
    <section className="flex flex-col gap-2 rounded-md border border-black/[0.06] bg-white/40 px-3 py-2">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-mm-text-dim">
        Why this block exists
      </span>
      <p className="text-[12px] italic text-mm-text">
        &ldquo;{intent.original_phrasing}&rdquo;
      </p>
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-semibold text-mm-text">{heading}</span>
        <p className="text-[11px] text-mm-text-subtle">{choice.reasoning}</p>
      </div>
      {concerns.length > 0 && (
        <div className="rounded-md border border-amber-400/40 bg-amber-50/60 px-2 py-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-800">
            Concerns raised
          </span>
          <ul className="mt-0.5 list-disc pl-4 text-[11px] text-amber-900">
            {concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <span className="text-[9px] text-mm-text-subtle">
        Committed {formatCommitTimestamp(intent.created_at)}
      </span>
    </section>
  );
}

function formatCommitTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const datePart = date.toISOString().slice(0, 10);
  const relative = formatRelative(date);
  return relative ? `${datePart} (${relative})` : datePart;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = 604800;
const SECONDS_PER_MONTH = 2592000;
const SECONDS_PER_YEAR = 31536000;

function formatRelative(date: Date): string {
  const diffSecs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (diffSecs < SECONDS_PER_MINUTE) return fmt.format(-diffSecs, "second");
  if (diffSecs < SECONDS_PER_HOUR)
    return fmt.format(-Math.round(diffSecs / SECONDS_PER_MINUTE), "minute");
  if (diffSecs < SECONDS_PER_DAY)
    return fmt.format(-Math.round(diffSecs / SECONDS_PER_HOUR), "hour");
  if (diffSecs < SECONDS_PER_WEEK)
    return fmt.format(-Math.round(diffSecs / SECONDS_PER_DAY), "day");
  if (diffSecs < SECONDS_PER_MONTH)
    return fmt.format(-Math.round(diffSecs / SECONDS_PER_WEEK), "week");
  if (diffSecs < SECONDS_PER_YEAR)
    return fmt.format(-Math.round(diffSecs / SECONDS_PER_MONTH), "month");
  return fmt.format(-Math.round(diffSecs / SECONDS_PER_YEAR), "year");
}
