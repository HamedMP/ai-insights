import { remoteWithoutDisplay } from "./open.js";

/**
 * The end of a run on a machine with no browser to open: a server over SSH, a Linux box without a display, or an
 * opener that failed. The run says so instead of claiming the report opened, and offers the three ways to see it
 * from another device. Kept apart from the result screen so the screen can change without touching this.
 */

/**
 * No browser would appear in front of the person: SSH without a forwarded display, or Linux with no X11 or
 * Wayland display at all (a console, a container). WSL is left alone: its opener reaches the Windows browser.
 */
export function noBrowserHere(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (remoteWithoutDisplay(env, platform)) return true;
  if (platform !== "linux" || env.WSL_DISTRO_NAME || env.WSL_INTEROP) return false;
  return !(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/** One shell word: bare when it is safe as is, else single-quoted. */
function shellWord(text: string): string {
  return /^[\w@%+=:,./~-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The lines to print, without trailing newlines. `indent` matches the screen above (two spaces on a rich terminal).
 * The commands are never wrapped, even on a narrow terminal, so each one copies whole.
 */
export function headlessLines(htmlPath: string, indent = ""): string[] {
  return [
    `${indent}No browser here to open the report. To see it from your own computer:`,
    `${indent}  npx ai-insights@latest serve    through an SSH tunnel`,
    `${indent}  scp ${shellWord(`user@host:${htmlPath}`)} .`,
    `${indent}  npx ai-insights@latest share    a link to publish from any device`,
  ];
}
