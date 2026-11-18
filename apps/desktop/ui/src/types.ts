// The state the Rust side sends (src-tauri/src/lib.rs `ViewState`). The CLI's own JSON never reaches the
// page: src-tauri/src/summary.rs turns it into this normalised shape first, so only that adapter changes
// when the CLI's contract does.

export type PeriodKey = "today" | "week" | "month";

export interface Tip {
  id: string;
  text: string;
}

export interface AgentRow {
  agent: string;
  label: string;
  sessions: number | null;
  costUsd: number | null;
  /** False for chat exports, which record no usage: shown as "not measured", never 0. */
  measured: boolean;
}

export interface Period {
  key: PeriodKey;
  from: string | null;
  to: string | null;
  sessions: number | null;
  activeMinutes: number | null;
  prompts: number | null;
  tokensTotal: number | null;
  costUsd: number | null;
  unpricedShare: number | null;
  byAgent: AgentRow[];
  tip: Tip | null;
}

export interface Summary {
  schemaVersion: number;
  newerSchema: boolean;
  generatedAt: string | null;
  timezone: string | null;
  /** Always [today, week, month]; null where the CLI left a period out. */
  periods: Array<Period | null>;
  reportPath: string | null;
}

export type Problem = "cliMissing" | "cliTooOld" | "timeout" | "failed" | "badOutput" | "reportFailed";

export interface Snapshot {
  summary: Summary | null;
  problem: Problem | null;
  fetchedAt: number | null;
  refreshing: boolean;
  cliLocation: string | null;
}

export interface Settings {
  hideCost: boolean;
  refreshMinutes: number;
  cliPath: string | null;
}

export interface ViewState {
  snapshot: Snapshot;
  settings: Settings;
  platform: "macos" | "windows" | "linux";
}
