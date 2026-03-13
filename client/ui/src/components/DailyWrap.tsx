import { useMemo } from "react";
import { generateDailyWrap } from "../providers/MockDataProvider";
import { valColor, formatUtcTime } from "../utils";
import type { WrapPositionEntry, WrapScenario } from "../types";

function EntryRow({ entry }: { entry: WrapPositionEntry }) {
  return (
    <div className="border-b border-mm-border/20 px-3 py-2">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-mm-text">
          {entry.asset} — {entry.expiry}
        </span>
        <span className={`text-[10px] tabular-nums font-semibold ${valColor(entry.delta)}`}>
          {entry.delta > 0 ? "+" : ""}
          {entry.delta.toLocaleString()} $vega
        </span>
      </div>
      <p className="text-[9px] leading-relaxed text-mm-text-dim">{entry.driver}</p>
    </div>
  );
}

function ScenarioRow({ scenario, accent }: { scenario: WrapScenario; accent: "blue" | "red" }) {
  const borderColor = accent === "blue" ? "border-mm-accent/40" : "border-mm-error/40";
  const descColor = accent === "blue" ? "text-mm-accent" : "text-mm-error";
  return (
    <div className={`rounded-lg border-l-2 ${borderColor} bg-mm-bg/30 px-3 py-2`}>
      <p className={`text-[10px] font-medium ${descColor}`}>{scenario.description}</p>
      <p className="mt-0.5 text-[9px] text-mm-text-dim">
        <span className="font-medium text-mm-text-dim">Trigger:</span> {scenario.trigger}
      </p>
    </div>
  );
}

export function DailyWrap() {
  const wrap = useMemo(() => generateDailyWrap(), []);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between border-b border-mm-border/40 pb-2">
        <h2 className="zone-header">Daily Trading Wrap</h2>
        <span className="text-[10px] tabular-nums text-mm-text-dim">
          Generated {formatUtcTime(wrap.generatedAt)} UTC
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-y-auto">
        {/* Left column: Position changes + Risks */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
          {/* Largest Position Changes */}
          <section>
            <h3 className="mb-1 text-[10px] font-semibold tracking-normal text-mm-text-dim">
              Largest Position Changes
            </h3>
            <div className="overflow-hidden rounded-lg border border-mm-border/40 bg-mm-bg/30">
              {wrap.largestPositionChanges.map((e, i) => (
                <EntryRow key={`pos-${i}`} entry={e} />
              ))}
            </div>
          </section>

          {/* Largest Desired Changes */}
          <section>
            <h3 className="mb-1 text-[10px] font-semibold tracking-normal text-mm-text-dim">
              Largest Desired Position Changes
            </h3>
            <div className="overflow-hidden rounded-lg border border-mm-border/40 bg-mm-bg/30">
              {wrap.largestDesiredChanges.map((e, i) => (
                <EntryRow key={`des-${i}`} entry={e} />
              ))}
            </div>
          </section>

          {/* Current Risks */}
          <section>
            <h3 className="mb-1 text-[10px] font-semibold tracking-normal text-mm-text-dim">
              Current Risks
            </h3>
            <div className="flex flex-col gap-1">
              {wrap.currentRisks.map((risk, i) => (
                <div
                  key={`risk-${i}`}
                  className="rounded-lg border-l-2 border-mm-warn/40 bg-mm-bg/30 px-3 py-2 text-[10px] leading-relaxed text-mm-text-dim"
                >
                  {risk}
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right column: Scenarios */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
          {/* Best Case */}
          <section>
            <h3 className="mb-1 text-[10px] font-semibold tracking-normal text-mm-accent">
              Best Case Scenarios
            </h3>
            <div className="flex flex-col gap-1">
              {wrap.bestCaseScenarios.map((s, i) => (
                <ScenarioRow key={`best-${i}`} scenario={s} accent="blue" />
              ))}
            </div>
          </section>

          {/* Worst Case */}
          <section>
            <h3 className="mb-1 text-[10px] font-semibold tracking-normal text-mm-error">
              Worst Case Scenarios
            </h3>
            <div className="flex flex-col gap-1">
              {wrap.worstCaseScenarios.map((s, i) => (
                <ScenarioRow key={`worst-${i}`} scenario={s} accent="red" />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
