/**
 * The fixed lists every recap name comes from. Cards built from the recap are posted publicly, so a word,
 * program, command, connector, skill or model reaches it only when it is on one of these lists; anything else
 * folds into a neutral label. Raw top words on real histories are product names, tool names and the owner's
 * own name, so no list here may be built from the history itself.
 */

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Common development words. A word counts at most once per prompt. */
export const VOCABULARY: ReadonlySet<string> = new Set(
  words(`
run fix merge test tests check review read write add remove delete update change rename move refactor clean build deploy ship release push pull commit rebase branch
start stop restart open close create make install upgrade migrate debug trace log logs error errors bug bugs issue issues fail failing failed pass passing broken
plan spec design draft idea ideas explain summarize summary compare verify validate confirm continue finish done next proceed retry again wait keep try look
find search list show print copy paste save load sync import export parse format lint type types typecheck coverage ci pipeline job jobs workflow
code file files folder repo project app apps page pages screen screens view button form modal menu layout style styles theme color colors font icon icons image images
api endpoint route routes server client request response auth login token key keys user users account data database table query schema model models config settings
feature features task tasks ticket tickets comment comments doc docs readme note notes report reports message messages chat prompt prompts agent agents tool tools
terminal shell command commands script scripts function functions component components hook hooks test-suite package packages dependency dependencies version
mobile desktop web browser window windows tab tabs preview screenshot screenshots video demo stack stacks worktree worktrees reviews diff diffs patch
fast slow faster better simple small big quick safe secure private public local remote live staging production prod dev
memory context session sessions history cache performance speed size limit limits timeout
ui ux css html json markdown yaml sql
`),
);

/** How a prompt may start: two-word openers are tried before one-word ones. */
export const OPENERS: ReadonlySet<string> = new Set([
  "can you", "could you", "let's", "lets", "please", "ok", "okay", "now", "continue", "great", "nice", "yes", "no", "go", "do", "fix", "check",
  "run", "read", "review", "merge", "what's next", "what is", "how do", "why is", "is it", "make sure", "i want", "i need", "we need", "go ahead", "keep going",
]);

/** Built-in slash commands of Claude Code and Codex. Custom commands and plugin commands are "a custom one". */
export const BUILTIN_SLASH: ReadonlySet<string> = new Set(
  words(`
add-dir agents approvals bashes bug clear compact config context copy cost diff doctor effort exit export fast feedback fork help hooks ide init insights
install-github-app login logout mcp memory mention model new output-style permissions plan plugin plugins pr-comments privacy-settings prompts quit
release-notes reload-plugins restart resume review rewind security-review skills status statusline terminal-setup theme todos undo upgrade usage vim
`),
);

/** Programs anyone would recognise. A program not on the list is "your own CLI". */
export const PUBLIC_PROGRAMS: ReadonlySet<string> = new Set(
  words(`
python3 python node sed grep rg cat ls tail head find awk jq curl wget git gh pnpm npm npx bun yarn deno docker make tsc vitest jest pytest bash sh zsh echo printf
mkdir cp mv rm sort uniq wc xargs diff ps kill pkill ssh scp rsync tar unzip uv pip cargo go java ruby chmod touch date which test tee stat du df file readlink
realpath basename dirname nl cut tr column less more watch lsof sqlite3 psql redis-cli kubectl systemctl journalctl brew apt tmux zellij ffmpeg convert open
xdg-open playwright eslint prettier biome turbo next vite expo sleep
`),
);

/** Words before the program that say how to run it, not what runs. */
export const COMMAND_PREFIXES: ReadonlySet<string> = new Set(["env", "for", "while", "if", "then", "do", "done", "time", "nohup", "sudo", "source", ".", "(", "{", "true", "false", "local", "unset", "trap", "exec"]);
/** Shell builtins that set things up rather than run a program; the next segment names the program. */
export const SETUP_BUILTINS: ReadonlySet<string> = new Set(["cd", "set", "export", "source", "unset", "trap", "local", "pushd", "popd", "shopt", "ulimit", "umask", "alias"]);

/** Widely used public MCP servers, matched on the server name the harness reports. Anything else is "a custom one". */
export const PUBLIC_MCP_SERVERS: ReadonlySet<string> = new Set(
  words(`
github gitlab linear slack notion figma playwright puppeteer context7 sentry stripe supabase vercel cloudflare filesystem fetch memory sequential-thinking
atlassian jira confluence asana airtable hubspot posthog datadog grafana firebase neon postgres sqlite redis docker kubernetes aws gcp azure
chrome-devtools browserbase brave-search exa tavily perplexity google-drive gmail google-calendar todoist zapier greptile codex-apps
`),
);

/** Public skills (Anthropic's published skills and common harness built-ins). Anything else is "a custom one". */
export const PUBLIC_SKILLS: ReadonlySet<string> = new Set(
  words(`
pdf docx xlsx pptx skill-creator frontend-design canvas-design algorithmic-art brand-guidelines internal-comms mcp-builder webapp-testing
web-artifacts-builder theme-factory slack-gif-creator doc-coauthoring claude-api code-review simplify security-review init review
`),
);

/** Model families with public names. The version and variant after the family name are kept. */
export const PUBLIC_MODEL =
  /^(claude-(opus|sonnet|haiku|fable|mythos|instant)-[0-9][a-z0-9.-]*|claude-[0-9][a-z0-9.-]*|gpt-[0-9][a-z0-9.-]*|o[1-9](-[a-z]+)?|codex-[a-z0-9.-]+|gemini-[0-9][a-z0-9.-]*|grok-[0-9][a-z0-9.-]*|deepseek-[a-z0-9.-]+|qwen[0-9][a-z0-9.-]*|kimi-[a-z0-9.-]+|glm-[0-9][a-z0-9.-]*|mistral-[a-z0-9.-]+|llama-?[0-9][a-z0-9.-]*)$/i;

/** Codex's automatic reviewer: not a model the person chose. */
export const AUTO_REVIEW_MODEL = "codex-auto-review";

export const NEUTRAL = {
  program: "your own CLI",
  custom: "a custom one",
  model: "Another model",
} as const;

/** Card labels for tool error categories. */
export const ERROR_LABELS: Record<string, string> = {
  command_failed: "Commands exited non-zero",
  file_not_found: "Files that weren't there",
  file_changed: "Files changed underneath",
  edit_mismatch: "Edits that didn't match",
  permission_denied: "Permission denied",
  user_rejected: "You said no",
  timeout: "Timed out",
  too_large: "Too big to read",
  other: "Everything else",
};

/**
 * The fixed suggestion titles the detectors write. A tip reaches the recap only with one of these, so a
 * title that ever interpolates history (a command, a quoted prompt) can never be shared by mistake.
 */
export const TIP_TITLES: ReadonlySet<string> = new Set([
  "Hand off instead of compacting",
  "Front-load the request",
  "Store your conversations long term",
  "Compress and save disk space",
  "Delegate exploration to a subagent",
  "Start big changes in plan mode",
  "Connect the services you use",
  "Turn your long prompts into skills",
  "Keep the cache warm",
  "Split at natural checkpoints",
  "Compare with a second agent",
  "Agree on the plan before long runs",
  "Tell the agent how this command should be run",
  "Allow the commands you keep approving",
  "Tune permissions once",
  "Match the model to the task",
  "Write it down once",
  "Re-read before editing",
  "Describe the project layout",
  "Stop files changing under the agent",
  "Run long commands differently",
  "Read big files in pieces",
  "Look at why this tool fails",
  "Make checks part of done",
]);
