/** Failure modes that make sense for a position (SIM-SPEC §6, §12). Client-safe, no imports from the engine runtime. */
import type { PositionKind } from "@/shared/types";
import type { FailureMode } from "./engine/types";

export const MODE_LABELS: Record<FailureMode, string> = {
  loose: "Loose cable",
  kinked: "Kinked cable",
  dirty_optics: "Dirty optics",
  failing_laser: "Failing laser",
  bad_port: "Bad port",
  failing_rows: "Failing memory rows",
  media_wear: "Drive media wear",
  bearing_wear: "Fan bearing wear",
  input_fault: "PSU input fault",
};

export function modesForPosition(kind: PositionKind, localId: string): FailureMode[] {
  switch (kind) {
    case "port":
      return localId.startsWith("uplink") ? ["dirty_optics", "failing_laser", "bad_port"] : ["loose", "kinked", "bad_port"];
    case "dimm_slot":
      return ["failing_rows"];
    case "drive_bay":
      return ["media_wear"];
    case "fan_bay":
      return ["bearing_wear"];
    case "psu_bay":
      return ["input_fault"];
  }
}
