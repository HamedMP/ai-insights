import type { Finding, Session } from "../../schema/types.js";
import { clean } from "../../sources/shared.js";
import { evidence, harnessesOf, label, MAX_EVIDENCE, MAX_FINDINGS_PER_KIND, type Detector } from "./context.js";

/** Typed in this many separate sessions, it is a standing rule rather than a task. */
const MIN_SESSIONS = 4;
/** Spread over several days, so one afternoon of retries does not count. */
const MIN_DAYS = 3;
/** Fewer meaningful words than this ("yes", "continue", "run it") carry no rule worth writing down. */
const MIN_WORDS = 3;
/** Longer prompts are task descriptions or pasted logs, not standing instructions. */
const MAX_WORDS = 40;
/** Two prompts sharing this share of their words say the same thing. */
const MIN_SIMILARITY = 0.7;
/** Bounds the clustering work on very long histories. */
const MAX_PROMPTS = 5000;
/** Typed in eight or more sessions, it costs real time every week. */
const MEDIUM_SESSIONS = 8;

const STOPWORDS = new Set(
  "a an and are as at be but by can could do does for from have i if in into is it its just me my of on or our please so that the then this to us we will with would you your".split(" "),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/`[^`]*`/g, (match) => match.replace(/\s+/g, "_"))
    .split(/[^a-z0-9_./-]+/)
    .map((word) => word.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

interface Cluster {
  tokens: Set<string>;
  members: Array<{ session: Session; text: string; timestamp: string }>;
}

export const repeatedInstruction: Detector = ({ sessions, clock }) => {
  const clusters: Cluster[] = [];
  const index = new Map<string, number[]>();
  let considered = 0;
  outer: for (const session of sessions) {
    for (const prompt of session.prompts) {
      if (considered >= MAX_PROMPTS) break outer;
      const text = prompt.text.trim();
      if (!text || text.startsWith("/") || text.startsWith("!")) continue;
      const tokens = new Set(words(text));
      if (tokens.size < MIN_WORDS || tokens.size > MAX_WORDS) continue;
      considered += 1;
      const overlap = new Map<number, number>();
      for (const token of tokens) for (const id of index.get(token) ?? []) overlap.set(id, (overlap.get(id) ?? 0) + 1);
      let best = -1;
      let bestScore = 0;
      for (const [id, shared] of overlap) {
        const cluster = clusters[id]!;
        const score = shared / (tokens.size + cluster.tokens.size - shared);
        if (score > bestScore || (score === bestScore && id < best)) {
          best = id;
          bestScore = score;
        }
      }
      const member = { session, text, timestamp: prompt.timestamp };
      if (best >= 0 && bestScore >= MIN_SIMILARITY) {
        clusters[best]!.members.push(member);
        continue;
      }
      const id = clusters.length;
      clusters.push({ tokens, members: [member] });
      for (const token of tokens) {
        const list = index.get(token);
        if (list) list.push(id);
        else index.set(token, [id]);
      }
    }
  }

  const findings: Finding[] = [];
  for (const cluster of clusters) {
    const bySession = new Map<Session, { text: string; timestamp: string }>();
    for (const member of cluster.members) if (!bySession.has(member.session)) bySession.set(member.session, member);
    if (bySession.size < MIN_SESSIONS) continue;
    const days = new Set([...bySession.values()].map((member) => clock.day(member.timestamp)).filter(Boolean));
    if (days.size < MIN_DAYS) continue;
    // The wording typed most often reads most naturally as a rule.
    const wording = new Map<string, number>();
    for (const member of cluster.members) wording.set(member.text, (wording.get(member.text) ?? 0) + 1);
    const [representative] = [...wording].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]!;
    const quoted = label(representative);
    const projects = new Set([...bySession.keys()].map((session) => session.projectPath ?? ""));
    const where =
      projects.size > 1
        ? "It spans several projects, so it belongs in your global instructions file (for example `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`)."
        : "It all happened in one project, so it belongs in that project's CLAUDE.md or AGENTS.md.";
    const items = [...bySession]
      .slice(0, MAX_EVIDENCE)
      .map(([session, member]) => evidence(session, `Typed: "${label(member.text)}"`, member.timestamp));
    findings.push({
      // Keyed by the cluster's seed words, which do not change as more sessions join it.
      id: `repeated_instruction:${[...cluster.tokens].sort().join(" ").slice(0, 100)}`,
      kind: "repeated_instruction",
      severity: bySession.size >= MEDIUM_SESSIONS ? "medium" : "low",
      title: `You keep telling the agent: "${label(representative).slice(0, 70)}"`,
      detail: `You typed this, or something nearly identical, in ${bySession.size} sessions over ${days.size} days. ${where}`,
      harnesses: harnessesOf(bySession.keys()),
      metric: { value: bySession.size, unit: "sessions", label: "sessions with this instruction" },
      evidence: items,
      suggestion: {
        type: "instructions",
        title: "Write it down once",
        action: "Add this to your instructions file so every session starts with it, instead of typing it again.",
        instructionText: clean(quoted, 300),
      },
    });
  }
  return findings
    .sort((a, b) => (b.metric?.value ?? 0) - (a.metric?.value ?? 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_FINDINGS_PER_KIND);
};
