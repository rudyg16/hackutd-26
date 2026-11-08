"use client";
// OWNER: Person C. Side drawer for a selected position: tickets, part timeline, repeat flag, AI known-issue.
import { useEffect, useState } from "react";
import { api } from "@/shared/api";
import type { KnownIssueSummary, PositionHistory, Severity } from "@/shared/types";

const SEV_TEXT: Record<Severity, string> = {
  low: "text-sev-low", medium: "text-sev-medium", high: "text-sev-high", critical: "text-sev-critical",
};
const REC_LABEL: Record<KnownIssueSummary["recommendation"], string> = {
  monitor: "Monitor",
  replace_part: "Replace part",
  replace_device: "Replace device",
  move_port: "Move to another port",
};
const REC_STYLE: Record<KnownIssueSummary["recommendation"], string> = {
  monitor: "border-neon-green text-neon-green",
  replace_part: "border-neon-amber text-neon-amber",
  replace_device: "border-sev-critical text-sev-critical",
  move_port: "border-neon-magenta text-neon-magenta",
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export function ItemDrawer({ positionId, onClose }: { positionId: string | null; onClose?: () => void }) {
  const [history, setHistory] = useState<PositionHistory | null>(null);
  const [known, setKnown] = useState<KnownIssueSummary | null>(null);
  const [error, setError] = useState("");
  const [knownError, setKnownError] = useState(false);

  useEffect(() => {
    if (!positionId) return;
    let cancelled = false;
    setHistory(null);
    setKnown(null);
    setError("");
    setKnownError(false);
    api.history(positionId).then((h) => !cancelled && setHistory(h)).catch((e) => !cancelled && setError(String(e.message ?? e)));
    // Independent request: the summary can lag (LLM) without blocking the history.
    api.knownIssue(positionId).then((k) => !cancelled && setKnown(k)).catch(() => !cancelled && setKnownError(true));
    return () => {
      cancelled = true;
    };
  }, [positionId]);

  if (!positionId) return null;

  const replaceSuggested = history?.repeatFlags.some((f) => f.replaceSuggested) ?? false;

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-neon-cyan neon-text">{history?.position.label ?? positionId}</h2>
          <p className="text-xs text-dim">{positionId}</p>
        </div>
        <div className="flex items-center gap-2">
          {replaceSuggested && (
            <span className="rounded border border-neon-amber px-2 py-0.5 text-xs text-neon-amber">⚠ Replace?</span>
          )}
          {onClose && (
            <button onClick={onClose} className="text-dim hover:text-ink" aria-label="Close">✕</button>
          )}
        </div>
      </div>

      {error && <p className="text-sev-critical">{error}</p>}

      <section className="rounded border border-line bg-panel-2 p-3">
        <h3 className="mb-1 text-xs uppercase tracking-wider text-dim">Known issue</h3>
        {known ? (
          <>
            <p className="text-ink">{known.summary}</p>
            <span className={`mt-2 inline-block rounded-full border px-2 py-0.5 text-xs ${REC_STYLE[known.recommendation]}`}>
              {REC_LABEL[known.recommendation]}
            </span>
          </>
        ) : knownError ? (
          <p className="text-dim">Summary unavailable.</p>
        ) : (
          <p className="text-dim">Summarising history…</p>
        )}
      </section>

      {history && (
        <>
          <section>
            <h3 className="mb-1 text-xs uppercase tracking-wider text-dim">Tickets ({history.tickets.length})</h3>
            {history.tickets.length === 0 ? (
              <p className="text-dim">No tickets for this position.</p>
            ) : (
              <ul className="space-y-1.5">
                {history.tickets.map((t) => (
                  <li key={t.id} className="rounded border border-line p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink">{t.title}</span>
                      <span className={`text-xs ${SEV_TEXT[t.severity]}`}>{t.severity}</span>
                    </div>
                    <div className="text-xs text-dim">
                      {day(t.createdAt)} · {t.status} · {t.category}
                      {t.resolutionAction ? ` · ${t.resolutionAction}` : ""}
                    </div>
                    {t.resolutionNote && <p className="mt-1 text-xs text-dim">{t.resolutionNote}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-xs uppercase tracking-wider text-dim">Part timeline</h3>
            {history.partEvents.length === 0 ? (
              <p className="text-dim">No parts recorded.</p>
            ) : (
              <ol className="space-y-1 border-l border-line pl-3">
                {history.partEvents.map((p) => (
                  <li key={p.id} className="text-xs">
                    <span className="text-ink">{p.kind} {p.serial}</span>{" "}
                    <span className="text-dim">
                      installed {day(p.installedAt)}{p.removedAt ? `, removed ${day(p.removedAt)}` : " (current)"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
      {!history && !error && <p className="text-dim">Loading history…</p>}
    </div>
  );
}

export default ItemDrawer;
