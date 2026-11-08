/** Turns position metrics into labelled readings, flagging out-of-range values (SIM-SPEC §6 thresholds, §13). Client-safe. */
import type { PositionMetrics } from "./engine/types";

export interface MetricReading {
  label: string;
  value: string;
  /** Crossed a detection threshold. */
  bad: boolean;
  /** Worth a look but below the threshold. */
  warn?: boolean;
}

export function readMetrics(m: PositionMetrics): MetricReading[] {
  if ("link" in m) {
    const out: MetricReading[] = [
      { label: "Link", value: m.link, bad: m.link === "down" },
      { label: "Flaps (5 min)", value: String(m.flaps5m), bad: m.flaps5m >= 3, warn: m.flaps5m > 0 },
      { label: "CRC / min", value: String(m.crcPerMin), bad: m.crcPerMin > 20 },
    ];
    if (m.rxDbm !== undefined) {
      out.push({ label: "Rx power", value: `${m.rxDbm} dBm`, bad: m.rxDbm < -12, warn: m.rxDbm < -8 });
    }
    return out;
  }
  if ("eccCorrectable" in m) {
    return [
      { label: "ECC correctable", value: String(m.eccCorrectable), bad: false, warn: m.eccCorrectable > 0 },
      { label: "ECC uncorrectable", value: String(m.eccUncorrectable), bad: m.eccUncorrectable > 0 },
    ];
  }
  if ("reallocated" in m) {
    return [
      { label: "Reallocated sectors", value: String(m.reallocated), bad: m.reallocated > 50, warn: m.reallocated > 20 },
      { label: "Drive state", value: m.driveState, bad: m.driveState === "failed", warn: m.driveState === "degraded" },
    ];
  }
  if ("rpm" in m) {
    const out: MetricReading[] = [
      { label: "Fan speed", value: `${m.rpm} rpm`, bad: m.rpm < 0.4 * m.nominalRpm, warn: m.rpm < 0.8 * m.nominalRpm },
    ];
    if (m.tempC !== undefined) out.push({ label: "Device temp", value: `${m.tempC} °C`, bad: m.tempC > 75, warn: m.tempC > 55 });
    return out;
  }
  return [
    { label: "Input power", value: m.psuInput, bad: m.psuInput === "lost" },
    { label: "Draw", value: `${m.watts} W`, bad: false },
  ];
}
