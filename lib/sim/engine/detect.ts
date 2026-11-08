/**
 * Detection rules (SIM-SPEC §6): metrics + short history → alerts.
 * A rule alerts when it starts firing, then at most every `alertCooldownSimMin` while it
 * keeps firing; once it stops, it re-arms. Alert text is machine-readable:
 *   "Monitoring: <deviceId> <localId> <detail>. Possible <category>. Severity hint: <severity>."
 * The severity is only a hint — the AI draft decides the final severity.
 */
import type { IssueCategory, Severity } from "@/shared/types";
import type { SimConfig } from "../config";
import type { PositionMetrics, PositionSignals, SimAlert, SimInventory } from "./types";

interface Hit {
  rule: string;
  category: IssueCategory;
  severity: Severity;
  detail: string;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const FLAP_RULE_WINDOW_S = 120;
const LINK_DOWN_S = 30;
const ECC_RULE_WINDOW_S = 3600;
const PSU_RULE_WINDOW_S = 600;

const within = (times: number[], nowS: number, windowS: number) => times.filter((t) => t > nowS - windowS).length;

function evaluate(localId: string, m: PositionMetrics, sig: PositionSignals, nowS: number): Hit[] {
  const hits: Hit[] = [];

  if ("link" in m) {
    const flaps = within(sig.flapTimes, nowS, FLAP_RULE_WINDOW_S);
    const downFor = sig.downSince === null ? 0 : nowS - sig.downSince;

    // High CRC on a port that is flapping is the same fault (kinked cable): one link_flap alert, not two.
    if (flaps >= 3 || (m.crcPerMin > 20 && sig.flapTimes.length > 0)) {
      hits.push({
        rule: "flaps",
        category: "link_flap",
        severity: flaps >= 6 || m.crcPerMin > 20 ? "high" : "medium",
        detail: `link flapped ${flaps} times in 2 min; CRC ${m.crcPerMin}/min`,
      });
    } else if (m.crcPerMin > 20 || (m.rxDbm !== undefined && m.rxDbm < -12)) {
      const parts = [`CRC ${m.crcPerMin}/min`];
      if (m.rxDbm !== undefined) parts.push(`rx ${m.rxDbm} dBm`);
      hits.push({ rule: "crc", category: "crc_errors", severity: "medium", detail: parts.join("; ") });
    }

    if ((m.rxDbm !== undefined && m.rxDbm < -14) || downFor > LINK_DOWN_S) {
      const parts: string[] = [];
      if (m.rxDbm !== undefined && m.rxDbm < -14) parts.push(`rx ${m.rxDbm} dBm`);
      if (downFor > LINK_DOWN_S) parts.push(`link down ${Math.round(downFor)} s`);
      hits.push({ rule: "optics", category: "link_flap", severity: "high", detail: parts.join("; ") });
    }
  } else if ("eccCorrectable" in m) {
    const corr = sig.eccEvents.filter((e) => e.t > nowS - ECC_RULE_WINDOW_S).reduce((sum, e) => sum + e.n, 0);
    if (m.eccUncorrectable > 0) {
      hits.push({
        rule: "ecc-uncorrectable",
        category: "ecc_memory",
        severity: "high",
        detail: `${m.eccUncorrectable} uncorrectable ECC error(s); ${m.eccCorrectable} correctable total`,
      });
    } else if (corr > 50) {
      hits.push({
        rule: "ecc-correctable",
        category: "ecc_memory",
        severity: "medium",
        detail: `${corr} correctable ECC errors in 1 h`,
      });
    }
  } else if ("reallocated" in m) {
    if (m.driveState === "failed") {
      hits.push({
        rule: "drive-failed",
        category: "disk_failure",
        severity: "high",
        detail: `drive failed; ${m.reallocated} reallocated sectors`,
      });
    } else if (m.reallocated > 50) {
      hits.push({
        rule: "drive-realloc",
        category: "disk_failure",
        severity: "medium",
        detail: `${m.reallocated} reallocated sectors; state ${m.driveState}`,
      });
    }
  } else if ("rpm" in m) {
    if (m.rpm < 0.4 * m.nominalRpm) {
      hits.push({
        rule: "fan-rpm",
        category: "overheat",
        severity: "high",
        detail: `fan at ${m.rpm} rpm (${Math.round((100 * m.rpm) / m.nominalRpm)}% of nominal)`,
      });
    }
    if (m.tempC !== undefined && m.tempC > 75) {
      hits.push({
        rule: "device-temp",
        category: "overheat",
        severity: m.tempC > 85 ? "critical" : "high",
        detail: `device temp ${m.tempC} °C`,
      });
    }
  } else if ("psuInput" in m) {
    const losses = within(sig.lossTimes, nowS, PSU_RULE_WINDOW_S);
    if (losses >= 2) {
      hits.push({
        rule: "psu-loss",
        category: "psu_fault",
        severity: losses >= 4 ? "high" : "medium",
        detail: `input power lost ${losses} times in 10 min`,
      });
    }
  }

  return hits.map((h) => ({ ...h, detail: `${localId} ${h.detail}` }));
}

export interface DetectInput {
  inventory: SimInventory;
  metrics: Record<string, PositionMetrics>;
  signals: Record<string, PositionSignals>;
  nowS: number;
  config: SimConfig;
}

export function detect(input: DetectInput): { alerts: SimAlert[]; signals: Record<string, PositionSignals> } {
  const { inventory, metrics, nowS, config } = input;
  const cooldownS = config.alertCooldownSimMin * 60;
  const repeatS = config.alertRepeatSimMin * 60;
  const signals = { ...input.signals };
  const alerts: SimAlert[] = [];

  for (const [positionId, m] of Object.entries(metrics)) {
    const pos = inventory.positions[positionId];
    if (!pos) continue;
    const sig = signals[positionId];
    const firing = sig ? evaluate(pos.localId, m, sig, nowS) : [];
    if (!sig) continue;

    // A rule re-arms only after it has been quiet for a full cooldown, so intermittent
    // rules (flaps hovering around the threshold) don't alert on every dip and spike.
    const lastAlert: PositionSignals["lastAlert"] = {};
    for (const [rule, prev] of Object.entries(sig.lastAlert)) {
      if (nowS - prev.seenAt < cooldownS) lastAlert[rule] = prev;
    }
    let changed = Object.keys(lastAlert).length !== Object.keys(sig.lastAlert).length || firing.length > 0;
    for (const hit of firing) {
      const prev = sig.lastAlert[hit.rule];
      const escalated = prev !== undefined && SEVERITY_RANK[hit.severity] > SEVERITY_RANK[prev.severity];
      if (prev === undefined || escalated || nowS - prev.t >= repeatS) {
        const worst = prev && SEVERITY_RANK[prev.severity] > SEVERITY_RANK[hit.severity] ? prev.severity : hit.severity;
        lastAlert[hit.rule] = { t: nowS, seenAt: nowS, severity: worst };
        changed = true;
        alerts.push({
          positionId,
          deviceId: pos.deviceId,
          tenantId: pos.tenantId,
          category: hit.category,
          severity: hit.severity,
          message: `Monitoring: ${pos.deviceId} ${hit.detail}. Possible ${hit.category}. Severity hint: ${hit.severity}.`,
          simTimeS: nowS,
        });
      } else {
        // Still firing: keep the alert time (so the reminder clock runs) and refresh the quiet timer.
        lastAlert[hit.rule] = { ...prev, seenAt: nowS };
      }
    }
    if (changed) signals[positionId] = { ...sig, lastAlert };
  }

  return { alerts, signals };
}
