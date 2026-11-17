import { chunk, painter, visibleWidth, type Paint, type Style } from "./terminal.js";

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_LINE = "\r\u001b[2K";

/** About ten redraws a second at most: enough to look alive, too few to cost anything. */
export const MIN_INTERVAL_MS = 100;

const FRAMES_UNICODE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAMES_ASCII = ["|", "/", "-", "\\"];

export interface ProgressLineOptions {
  /** Where the line goes: stderr, so piped stdout never carries it. */
  write: (text: string) => void;
  /** Milliseconds from any fixed point. */
  clock: () => number;
  style: Style;
  /** Animate the spinner between updates. Off in tests, which drive the clock themselves. */
  timers?: boolean;
}

/**
 * One status line redrawn in place, like an installer's: a spinner and what is happening now, then a check
 * mark when it is done. Same-stage updates are throttled; a new stage is drawn at once. The cursor is hidden
 * while it runs and always shown again by `done` or `stop`.
 */
export class ProgressLine {
  private readonly paint: Paint;
  private readonly frames: string[];
  private text = "";
  private stage: string | undefined;
  private lastDraw = Number.NEGATIVE_INFINITY;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private startedAt = 0;

  constructor(private readonly options: ProgressLineOptions) {
    this.paint = painter(options.style);
    this.frames = options.style.unicode ? FRAMES_UNICODE : FRAMES_ASCII;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.startedAt = this.options.clock();
    this.options.write(HIDE_CURSOR);
    if (this.options.timers !== false) {
      this.timer = setInterval(() => {
        // Skip a tick right after an update drew, so the two together stay near ten redraws a second.
        if (this.options.clock() - this.lastDraw < MIN_INTERVAL_MS * 0.9) return;
        this.frame += 1;
        this.draw();
      }, MIN_INTERVAL_MS);
      // Never keep the process alive for a spinner.
      this.timer.unref?.();
    }
  }

  /** Shows `text`. `stage` names the step it belongs to: a new stage is drawn at once, the same one at most every MIN_INTERVAL_MS. */
  update(text: string, stage?: string): void {
    if (!this.active) return;
    this.text = text;
    const changed = stage !== undefined && stage !== this.stage;
    if (stage !== undefined) this.stage = stage;
    if (changed) this.frame += 1;
    if (changed || this.options.clock() - this.lastDraw >= MIN_INTERVAL_MS) this.draw();
  }

  elapsedMs(): number {
    return this.options.clock() - this.startedAt;
  }

  /** Replaces the line with a check mark and `text`, leaves a blank line under it, and shows the cursor again. */
  done(text: string): void {
    if (!this.active) return;
    this.finish();
    const mark = this.options.style.unicode ? "✓" : "OK";
    this.options.write(`${CLEAR_LINE}  ${this.paint("accent", mark, true)} ${this.fit(text, 4 + mark.length)}\n\n${SHOW_CURSOR}`);
  }

  /** Clears the line and shows the cursor: for errors, empty results and Ctrl-C. Safe to call more than once. */
  stop(): void {
    if (!this.active) return;
    this.finish();
    this.options.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
  }

  private finish(): void {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private draw(): void {
    if (!this.active || !this.text) return;
    this.lastDraw = this.options.clock();
    const spinner = this.frames[this.frame % this.frames.length]!;
    this.options.write(`${CLEAR_LINE}  ${this.paint("brand", spinner)} ${this.fit(this.text, 3 + visibleWidth(spinner))}`);
  }

  /** One line, never wrapping: a wrapped line cannot be cleared with a carriage return. */
  private fit(text: string, used: number): string {
    const room = Math.max(1, this.options.style.width - used - 1);
    return visibleWidth(text) <= room ? text : `${chunk(text, Math.max(1, room - 1))[0]}${this.options.style.unicode ? "…" : "."}`;
  }
}
