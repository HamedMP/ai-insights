import { DocShell } from "@/components/docs/doc-shell"
import { Callout, Code, DocLink, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"
import { REPO } from "@/lib/site"

export const metadata = docMetadata("desktop")

const FILES: Array<[string, string, string]> = [
  ["Settings and nudge state", "~/Library/Application Support/app.ai-insights.desktop/", "~/.config/app.ai-insights.desktop/ (Windows: %APPDATA%\\app.ai-insights.desktop\\)"],
  ["Window cache", "~/Library/Caches/app.ai-insights.desktop/ and ~/Library/WebKit/app.ai-insights.desktop/", "~/.local/share/app.ai-insights.desktop/ (Windows: %LOCALAPPDATA%\\app.ai-insights.desktop\\)"],
  ["Open at login, only if you turned it on", "~/Library/LaunchAgents/AI Insights.plist", "~/.config/autostart/AI Insights.desktop (Windows: a value named AI Insights under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run)"],
]

export default function Desktop() {
  return (
    <DocShell slug="desktop">
      <Callout title="Preview">
        <p>
          The app is new and its builds are not signed yet, so your system will warn you the first time you open it (see{" "}
          <DocLink href="/docs/desktop#install">Install</DocLink>). Until signed releases exist, the{" "}
          <DocLink href="/docs/desktop#menu-bar-scripts">SwiftBar or xbar script</DocLink> is the zero-install way to get the same numbers in the
          macOS menu bar.
        </p>
      </Callout>

      <H2 id="what-it-shows">What it shows</H2>
      <p>
        An icon in the macOS menu bar, or in the system tray on Windows and Linux. Click it for a small window with one tip from your history, then
        today, this week and this month: sessions, active time and estimated cost. Below that, this week by agent. Chat exports you imported show
        &ldquo;not measured&rdquo;, because a chat export records no usage. <strong>Open full report</strong> opens the same local HTML report the
        CLI writes, and writes it first if there is none yet.
      </p>
      <ul>
        <li>
          <strong>Hide cost</strong> in Settings leaves every cost figure out, for screens other people can see.
        </li>
        <li>
          The numbers refresh every 30 minutes (15 or 60 if you prefer) and when you open the window. A refresh that fails keeps the last numbers
          on screen and says what went wrong.
        </li>
      </ul>

      <H2 id="install">Install</H2>
      <p>
        The app reads your history through the AI Insights command-line tool, version 0.10.0 or newer, so install or update that first. The app
        uses this copy and never downloads one, and never runs <code>npx</code>. With an older version installed, the app asks you to update it.
      </p>
      <Code label="Terminal">npm i -g ai-insights</Code>
      <p>
        If you installed it somewhere unusual, set its full path in the app&apos;s Settings. Builds of the app itself come from the{" "}
        <a href={`${REPO}/actions/workflows/desktop.yml`}>Desktop app workflow</a> for now. They are not signed, so the first open needs one extra
        step:
      </p>
      <Table
        caption="Opening an unsigned build"
        head={["System", "What you see", "What to do"]}
        rows={[
          [
            "macOS",
            "“Apple could not verify ‘AI Insights’ is free of malware”",
            "Close the dialog, open System Settings, Privacy & Security, and press Open Anyway next to AI Insights. Once is enough.",
          ],
          ["Windows", "“Windows protected your PC” (SmartScreen)", "Press More info, then Run anyway. The installer installs for your user only."],
          ["Linux", "Nothing", "Install the .deb with your package manager, or make the AppImage executable and run it."],
        ]}
      />

      <H2 id="nudges">Nudges</H2>
      <p>
        The app can send a notification on a schedule: every day, every week on a day you pick, or on the last day of each month, at a time you
        pick. Nudges are off until you choose one. The first time you open the app it asks once; <strong>Not now</strong> is a full answer, and
        Settings changes it later.
      </p>
      <Code label="Example" copy={false}>
        Your weekly AI Insights are ready: 41 sessions, 6.1 h. Open AI Insights in the menu bar for a tip.
      </Code>
      <ul>
        <li>
          <strong>Counts only.</strong> A notification can show on a lock screen, so it holds sessions and active hours. Never project names,
          prompts, tips or cost.
        </li>
        <li>
          <strong>Nothing to say, no nudge.</strong> A day, week or month with no sessions sends nothing.
        </li>
        <li>
          <strong>Asleep at the time?</strong> A nudge missed while your computer slept arrives when it wakes, within 12 hours. Later than that, it
          is skipped.
        </li>
        <li>
          Nudges need the app to be running. Turn on <strong>Open at login</strong> if you want them without opening the app yourself.
        </li>
      </ul>

      <H2 id="background">What runs in the background</H2>
      <p>While the app is running, and only then:</p>
      <ul>
        <li>
          Once a minute it checks whether a refresh or a nudge is due. That check reads a clock and does nothing else.
        </li>
        <li>
          On a refresh it starts <code>ai-insights summary --json</code> with a two-minute limit, reads its answer and stops. It runs one at a time,
          never in a loop.
        </li>
        <li>
          When you press Open full report and no report exists yet, it runs <code>ai-insights report --no-open</code> once, with a five-minute
          limit.
        </li>
      </ul>
      <p>
        Quit stops all of it. With <strong>Open at login</strong> off, which is the default, nothing starts again until you open the app.
      </p>

      <H2 id="privacy">Nothing leaves your computer</H2>
      <ul>
        <li>
          <strong>No network requests.</strong> No update checks, no analytics, no crash reports, no fonts or images from the web. The window&apos;s
          Content-Security-Policy, <code>default-src &apos;none&apos;</code>, blocks loading anything that is not part of the app.
        </li>
        <li>
          <strong>The CLI&apos;s own promise.</strong> The numbers come from the same CLI, which makes no network calls either. See{" "}
          <DocLink href="/docs/privacy">Privacy</DocLink>.
        </li>
        <li>
          <strong>Little to reach.</strong> The window can ask the app for eight things: read its state, refresh, open the report, save settings,
          switch Open at login, send a test notification, hide, and quit.
        </li>
      </ul>

      <H2 id="turn-off">Turn it all off</H2>
      <ul>
        <li>
          <strong>Nudges:</strong> Settings, Nudges, Off.
        </li>
        <li>
          <strong>Open at login:</strong> switch it off in Settings. That removes the login entry the app made.
        </li>
        <li>
          <strong>The app:</strong> Quit AI Insights from its menu (right-click the icon) or from Settings.
        </li>
      </ul>

      <H2 id="uninstall">Uninstall</H2>
      <p>
        Switch off <strong>Open at login</strong> first if you turned it on, then quit the app. Remove the app the usual way: drag it from
        Applications to the Bin on macOS, use Installed apps on Windows, or your package manager on Linux. These are the only files it keeps:
      </p>
      <Table caption="Files the app keeps" head={["What", "macOS", "Linux and Windows"]} rows={FILES.map(([what, mac, other]) => [what, <code key="m">{mac}</code>, <code key="o">{other}</code>])} />
      <p>
        Deleting them is safe. Your history and reports stay where the CLI keeps them, in <code>~/.ai-insights/</code>; see{" "}
        <DocLink href="/docs/getting-started#where-files-go">Where files go</DocLink>.
      </p>

      <H2 id="menu-bar-scripts">Without the app: SwiftBar and xbar</H2>
      <p>
        On macOS, <a href="https://swiftbar.app">SwiftBar</a> and <a href="https://xbarapp.com">xbar</a> show any script&apos;s output in the menu
        bar. AI Insights ships one such script that reads the same numbers. AI Insights never installs it: you copy it yourself.
      </p>
      <Code label="Terminal">{`curl -fsSL ${REPO.replace("github.com", "raw.githubusercontent.com")}/main/apps/menubar-scripts/ai-insights.30m.sh -o ai-insights.30m.sh
less ai-insights.30m.sh   # read it first
chmod +x ai-insights.30m.sh
mv ai-insights.30m.sh "<your SwiftBar or xbar plugin folder>/"`}</Code>
      <p>
        The <code>30m</code> in the name makes it refresh every 30 minutes. The menu bar shows this week&apos;s sessions; the menu adds today and
        this month, the tip, and Open full report. Set <code>AI_INSIGHTS_HIDE_COST=1</code> (xbar: the plugin&apos;s variables) to leave cost out.
        To remove it, delete the file.
      </p>
    </DocShell>
  )
}
