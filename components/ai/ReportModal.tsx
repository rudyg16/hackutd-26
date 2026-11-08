"use client";
// OWNER: Person C. Free-text report -> AI TicketDraft -> editable review -> create ticket.
// <ReportIssueButton /> is the header trigger (drop into the TODO slot in app/layout.tsx).
import { useEffect, useState } from "react";
import { api } from "@/shared/api";
import { ISSUE_CATEGORIES, type Device, type FloorView, type Severity, type TicketDraft } from "@/shared/types";

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const SEV_TEXT: Record<Severity, string> = {
  low: "text-sev-low", medium: "text-sev-medium", high: "text-sev-high", critical: "text-sev-critical",
};

const field = "w-full rounded border border-line bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-neon-cyan";
const label = "mb-1 block text-xs uppercase tracking-wider text-dim";
const btn = "rounded border px-3 py-1.5 text-sm disabled:opacity-40";

export function ReportIssueButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${btn} border-neon-magenta text-neon-magenta hover:bg-neon-magenta/10`}
      >
        Report issue
      </button>
      <ReportModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function ReportModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [reportText, setReportText] = useState("");
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [floor, setFloor] = useState<FloorView | null>(null);
  const [busy, setBusy] = useState<"drafting" | "saving" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    api.floor().then(setFloor).catch(() => setFloor(null));
  }, [open]);

  if (!open) return null;

  const close = () => {
    setReportText("");
    setDraft(null);
    setError("");
    setBusy(null);
    onClose();
  };

  const submit = async () => {
    setBusy("drafting");
    setError("");
    try {
      setDraft(await api.draftTicket(reportText));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drafting failed");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!draft) return;
    setBusy("saving");
    setError("");
    try {
      await api.createTicket({ ...draft, status: "open" });
      onCreated?.();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create ticket");
      setBusy(null);
    }
  };

  const set = <K extends keyof TicketDraft>(k: K, v: TicketDraft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const visibleRacks = floor?.racks.filter((r) => r.visible) ?? [];
  const rackDevices: Device[] = floor?.devices.filter((d) => d.rackId === draft?.rackId) ?? [];

  const onDevice = (deviceId: string) => {
    const dev = floor?.devices.find((d) => d.id === deviceId);
    setDraft((d) => (d ? { ...d, deviceId: deviceId || null, rackId: dev?.rackId ?? d.rackId, positionId: null } : d));
  };

  // Position is edited as its local id ("port-13"); the full id is deviceId + "/" + localId.
  const localId = draft?.positionId && draft.deviceId ? draft.positionId.slice(draft.deviceId.length + 1) : "";
  const onLocal = (v: string) =>
    setDraft((d) => (d ? { ...d, positionId: v.trim() && d.deviceId ? `${d.deviceId}/${v.trim()}` : null } : d));

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="max-h-full w-full max-w-xl overflow-y-auto rounded border border-line bg-panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-neon-cyan neon-text tracking-widest">REPORT ISSUE</h2>
          <button onClick={close} className="text-dim hover:text-ink" aria-label="Close">✕</button>
        </div>

        {!draft ? (
          <>
            <label className={label} htmlFor="report-text">What&apos;s wrong?</label>
            <textarea
              id="report-text"
              className={`${field} h-32`}
              placeholder="e.g. port 13 on the C4 top switch dropping again"
              value={reportText}
              onChange={(e) => setReportText(e.target.value)}
              disabled={busy === "drafting"}
            />
            <div className="mt-3 flex items-center justify-end gap-3">
              {busy === "drafting" && (
                <span className="flex items-center gap-2 text-sm text-dim">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-neon-cyan border-t-transparent" />
                  Drafting ticket…
                </span>
              )}
              <button
                onClick={submit}
                disabled={!reportText.trim() || busy !== null}
                className={`${btn} border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10`}
              >
                Submit
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-dim">
              AI draft
              <span
                className={`rounded border border-line px-2 py-0.5 ${
                  draft.confidence >= 0.8 ? "text-neon-green" : draft.confidence >= 0.5 ? "text-neon-amber" : "text-sev-high"
                }`}
              >
                confidence {Math.round(draft.confidence * 100)}%
              </span>
            </div>
            <div>
              <label className={label} htmlFor="d-title">Title</label>
              <input id="d-title" className={field} value={draft.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="d-desc">Description</label>
              <textarea id="d-desc" className={`${field} h-24`} value={draft.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="d-sev">Severity</label>
                <select id="d-sev" className={`${field} ${SEV_TEXT[draft.severity]}`} value={draft.severity} onChange={(e) => set("severity", e.target.value as Severity)}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="d-cat">Category</label>
                <select id="d-cat" className={field} value={draft.category} onChange={(e) => set("category", e.target.value as TicketDraft["category"])}>
                  {ISSUE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={label} htmlFor="d-rack">Rack</label>
                {floor ? (
                  <select
                    id="d-rack"
                    className={field}
                    value={draft.rackId}
                    onChange={(e) => setDraft({ ...draft, rackId: e.target.value, deviceId: null, positionId: null })}
                  >
                    {!visibleRacks.some((r) => r.id === draft.rackId) && <option value={draft.rackId}>{draft.rackId}</option>}
                    {visibleRacks.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                ) : (
                  <input id="d-rack" className={field} value={draft.rackId} onChange={(e) => set("rackId", e.target.value)} />
                )}
              </div>
              <div>
                <label className={label} htmlFor="d-dev">Device</label>
                {floor ? (
                  <select id="d-dev" className={field} value={draft.deviceId ?? ""} onChange={(e) => onDevice(e.target.value)}>
                    <option value="">— none —</option>
                    {rackDevices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
                  </select>
                ) : (
                  <input id="d-dev" className={field} value={draft.deviceId ?? ""} onChange={(e) => onDevice(e.target.value)} />
                )}
              </div>
              <div>
                <label className={label} htmlFor="d-pos">Position</label>
                <input
                  id="d-pos"
                  className={field}
                  placeholder="port-13"
                  value={localId}
                  disabled={!draft.deviceId}
                  onChange={(e) => onLocal(e.target.value)}
                />
              </div>
            </div>
            {draft.positionId && <p className="text-xs text-dim">Path: {draft.rackId} / {draft.deviceId} / {draft.positionId}</p>}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-sev-critical">{error}</p>}

        {draft && (
          <div className="mt-4 flex justify-between">
            <button onClick={() => setDraft(null)} disabled={busy !== null} className={`${btn} border-line text-dim hover:text-ink`}>
              Back
            </button>
            <button
              onClick={approve}
              disabled={!draft.title.trim() || busy !== null}
              className={`${btn} border-neon-green text-neon-green hover:bg-neon-green/10`}
            >
              {busy === "saving" ? "Creating…" : "Approve"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ReportModal;
