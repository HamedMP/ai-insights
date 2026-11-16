/** Every outbound link the analysis puts in a report, kept in one place so they are easy to audit. */

export const MATRIX_URL = "https://matrix-os.com";

/** Null would drop the link from the disk-usage suggestion; its wording never depends on the link. */
export const PACKMEM_URL: string | null = "https://hamedmp.github.io/packmem/docs/agent-history/";

/**
 * Wording agreed with packmem for its 0.3.4 release: the ratio is the one measured on real history, and the
 * safety sentence is packmem's own. It adds disk until the originals go, so it must not promise freed space at once.
 */
export const PACKMEM_ACTION =
  "Agent transcripts repeat a lot of text, so they compress well. Run `npx packmem archive --dry-run` to see what it would do, then `npx packmem archive`: the archive is about 4-5x smaller on real Claude Code and Codex history. It never deletes or changes your agents' own files, and it counts a session as archived only after reading it back and matching the original's sha256, so a restore gives back the exact bytes. The archive is a full private copy that takes extra disk until the originals are removed.";
