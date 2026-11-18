import { DocShell } from "@/components/docs/doc-shell"
import { Callout, DocLink, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("privacy")

/** One row per published card: its title and how its two lines are built (src/render/client/sharelink.js). */
const CARD_ROWS: Array<[string, string]> = [
  ["Persona", "Your persona title from the fixed set, and your sessions and days."],
  ["Most agents at once", "The most sessions at once, and the number of subagents."],
  ["Tokens processed", "Total tokens, and the estimated cost or the number of model requests."],
  ["Longest streak", "Days in a row, with the start and end dates."],
  ["Longest session", "Active hours of your longest session, and its agent's name."],
  ["When they prompt", "Night owl, early bird or a daytime label, and your busiest hour."],
  ["Manners check", "Counts of please, thank-you and sorry, and your prompt count."],
  ["Danger zone", "Counts of rm -rf, force pushes and sleep commands."],
  ["Time with agents", "Clock hours and agent-hours."],
  ["Top model", "Your top model's public family name and its share of requests. Left out unless the name matches a known public family."],
  ["Favourite day", "A weekday name and its prompt count."],
  ["Test runs", "Test runs and the share that passed."],
  ["Bash hall of fame", "A count of shell commands. Program names are not published."],
  ["Where things broke", "Failed tool calls and the failure rate."],
  ["Words typed", "Words typed and the share of prompts that were questions. Your words themselves are not published."],
  ["Slash commands", "A count of slash commands. Their names are not published."],
  ["Deep thoughts", "Thinking blocks and the longest one."],
  ["Rubber stamp", "Actions approved automatically and by hand."],
  ["History kept", "Days of history kept, and sessions saved from deletion."],
]

export default function Privacy() {
  return (
    <DocShell slug="privacy">
      <H2 id="local-only">Local only</H2>
      <ul>
        <li>
          <strong>No network calls.</strong> The package reads files and writes files. It has no telemetry, no account and no model API client.
        </li>
        <li>
          <strong>Files only you can read.</strong> Everything it writes goes to <code>~/.ai-insights/</code>, with folders and files readable by you
          only.
        </li>
        <li>
          <strong>A report that cannot phone home.</strong> The report is one HTML file whose Content-Security-Policy, <code>default-src
          &apos;none&apos;</code>, stops it loading or sending anything.
        </li>
        <li>
          <strong>Links you click.</strong> The report links to Matrix OS, to the docs for tools it suggests, and to X and LinkedIn when you press a
          share button. Nothing else in it points off your machine.
        </li>
        <li>
          <strong>Your agent does the judging.</strong> The optional agent review runs in the agent you already use, under your existing account
          and settings. See <DocLink href="/docs/agent-review#what-the-model-sees">What your agent sees</DocLink>.
        </li>
      </ul>
      <p>
        Nothing leaves your machine unless you create a share link and open or send it, or publish from the website. Both are described below.
      </p>

      <H2 id="installing">Installing into your agents</H2>
      <p>
        <code>ai-insights install</code>, and the offer at the end of a run, set up the plugin by running Claude Code&apos;s and Codex&apos;s own
        plugin commands. Those commands download the plugin from GitHub, the same as if you typed them. AI Insights itself still sends
        nothing: it starts the agent&apos;s command, and only after showing it to you and getting a yes (or <code>--yes</code>). It never edits an
        agent&apos;s config file itself. Once installed, your agent starts the MCP server with <code>npx</code>, which asks the npm registry for the
        current version.
      </p>
      <p>
        The monthly reminder runs offline inside the plugin and reads only the date of your last report and its own <code>nudge.json</code>. See{" "}
        <DocLink href="/docs/getting-started#monthly-reminder">The monthly reminder</DocLink>.
      </p>

      <H2 id="redaction">Redaction</H2>
      <p>Before a prompt, a command or an excerpt is stored or shown, AI Insights replaces:</p>
      <ul>
        <li>API keys and tokens in common formats (for example OpenAI and Anthropic style keys, GitHub and Slack tokens, AWS access key ids, JWTs);</li>
        <li>private key blocks;</li>
        <li>
          <code>Bearer</code> and <code>Basic</code> credentials;
        </li>
        <li>
          assignments to names containing TOKEN, SECRET, PASSWORD, API_KEY, PRIVATE_KEY or ACCESS_KEY, such as <code>PASSWORD=…</code>;
        </li>
        <li>email addresses.</li>
      </ul>
      <p>
        It also shortens home-folder paths to <code>~</code> where it shows them to your agent, so your username does not travel into its context.
      </p>
      <Callout title="Redaction is pattern-based" tone="warn">
        <p>
          It can miss an unusual secret. The skills tell your agent never to copy a secret into its labels or narrative even when redaction missed
          it, and the cards never contain prompt text.
        </p>
      </Callout>

      <H2 id="share-link-contents">What a share link contains</H2>
      <p>
        A share link exists only when you make one in the report, and the report shows every line it carries before you copy it. It travels in the
        URL fragment (after <code>#</code>), which browsers do not send to the website. It holds no project names, paths, prompts or commands.
      </p>
      <Table
        caption="Share link contents"
        head={["Field", "What it is"]}
        rows={[
          ["Name", "An optional display name you type, up to 40 characters. Without one the card says “Someone”."],
          ["Period", "The first and last day of your history."],
          ["Totals", "Sessions, tokens, estimated spend, active days and longest streak. Imported chats count as sessions but add no tokens or spend: from chats alone, the site shows tokens and spend as not measured and the entry does not rank in the token, spend or agent arenas."],
          ["Agents", "Each coding agent's share of your sessions, as a percentage. Imported chats are left out, because the site estimates each agent's tokens from this share."],
          ["Fun fact", "One line built from counts, such as how many agents you ran at once."],
          ["Titles", "Up to three earned title keys, each with the number of the ratio that earned it. The site rebuilds the wording from a fixed table."],
          ["Ratios", "The five work ratios as numbers, each with the count it is out of (sessions, tool calls or clock hours), so computers can be combined."],
          ["Device", "This installation's random device id and an optional name you type for the computer. See The device id below."],
          ["Active days", "Unless you untick it: which dates had activity, as a compact bitmap. Dates only, no counts or times. It lets the site combine active days and streaks across computers."],
          ["Cards", "Up to 16 recap cards, each as a fixed card key, a short headline and a caption. See below."],
        ]}
      />
      <p>
        Each card&apos;s two lines are built from counts, dates, agent names, checked public model-family names and fixed wording. Cards whose
        report version shows your words, slash command names, program names or tips publish a count instead, or are left out. If the link would be
        too long, cards are dropped from the end of this list.
      </p>
      <Table caption="Card lines in a share link" head={["Card", "What its lines hold"]} rows={CARD_ROWS.map(([card, what]) => [card, what])} />

      <H2 id="published-contents">What publishing makes public</H2>
      <p>
        Publishing stores the same validated payload as the share link, nothing more, under a public handle you choose. The publish panel shows
        every line before you press Publish. Your profile at <code>ai-insights.app/u/&lt;handle&gt;</code> and the leaderboard then show:
      </p>
      <ul>
        <li>your display name and handle, and the date you first published;</li>
        <li>
          your combined numbers, and each computer&apos;s own numbers and cards, labelled &ldquo;Device 1&rdquo;, &ldquo;Device 2&rdquo; unless you
          chose to show a computer&apos;s name. Device ids and the active-days bitmap are stored but never shown or sent to visitors;
        </li>
        <li>everything in the table above: period, totals, agents, fun fact, titles, ratios and cards;</li>
        <li>your ranks and badges, computed from those numbers;</li>
        <li>how many people you referred (the list of who is shown only to you);</li>
        <li>
          your Matrix account photo, only if you ticked that box when you published or turned on <strong>Show my photo</strong> later. It is off by
          default. The site reads it from your Matrix account on its server, never from your browser, and accepts only photos you uploaded,
          hosted by the sign-in provider.
        </li>
      </ul>
      <p>
        Leaderboard numbers are self-reported and not verified. More about the flow is in{" "}
        <DocLink href="/docs/sharing#publish">Publish to the leaderboard</DocLink>.
      </p>

      <H2 id="device-id">The device id</H2>
      <p>
        From 0.5, AI Insights makes a random id the first time it runs (16 random bytes) and keeps it in <code>~/.ai-insights/device.json</code>.
        It is not made from your computer&apos;s name, your username, a network address or any hardware detail. It sits in the report&apos;s share
        link so that publishing again from the same computer replaces that computer&apos;s numbers instead of adding a new one.
      </p>
      <ul>
        <li>It is not a secret and grants nothing: every change happens only in the signed-in account, and an id from another account is ignored.</li>
        <li>It does link the share links one installation makes to each other. Delete <code>device.json</code> to get a new one.</li>
        <li>Visitors never see it; your profile shows &ldquo;Device 1&rdquo; or the name you chose to show.</li>
      </ul>

      <H2 id="chat-exports">Imported chat exports</H2>
      <p>
        A chat export you import with <code>ai-insights import claude</code> or <code>ai-insights import openai</code> is read on your machine, and what is kept from it goes to{" "}
        <code>~/.ai-insights/imports/</code> like the rest of the cache. AI Insights keeps the same things it keeps from a coding agent: counts,
        times, the product&apos;s own tool names and your own prompts, redacted (plus, for ChatGPT, the model family). It never reads the assistant&apos;s
        answers, its thinking text, tool inputs or results, attachments, file names, chat titles or summaries, custom instructions or memories, and
        it never opens the export&apos;s account, settings, project, memory or uploaded files. The zip
        is read in memory and nothing in it is unpacked to disk. <code>ai-insights import --remove claude</code> (or <code>openai</code>) deletes all of it. Details are in{" "}
        <DocLink href="/docs/import#what-is-read">What is read and kept</DocLink>.
      </p>

      <H2 id="website-analytics">The website&apos;s analytics</H2>
      <p>
        ai-insights.app, and only the website (not the package and not the report), uses first-party PostHog analytics. Events go through
        ai-insights.app itself to PostHog&apos;s EU hosts.
      </p>
      <ul>
        <li>It records page views, page leaves and a few named clicks: viewing a share card, copying the install command, pressing Publish, completing a publish, and which leaderboard arena was viewed.</li>
        <li>
          It never sends a share link&apos;s <code>#fragment</code>, and reduces <code>?ref=&lt;handle&gt;</code> to a bare <code>ref</code>, so
          analytics learn that a link had a referrer, never whose.
        </li>
        <li>It records no sessions, captures no typed text, has autocapture off, and honours Do Not Track.</li>
      </ul>
      <p>
        The sign-in scripts always load on the sign-in page. On every other page they load only in a browser that has signed in here
        before, to show your account menu, your standing and the Publish form; anyone else loads nothing from the sign-in provider.
      </p>
      <p>
        To recognise someone already signed in to Matrix OS, the share, leaderboard and profile pages check with the Matrix OS sign-in on a
        browser&apos;s first visit. After that check a signed-out browser keeps a first-party, HttpOnly cookie, <code>aii_auth_checked</code>,
        for one day, so the next visits skip it. It holds only the value <code>1</code>: no identifier. The sign-in provider sets its own cookies
        on ai-insights.app, and the referral cookie is described under <DocLink href="/docs/sharing#referrals">Referrals</DocLink>.
      </p>

      <H2 id="removing">Removing what you published</H2>
      <ul>
        <li>
          <strong>Remove my entry</strong> in the publish panel on any share page, while signed in, deletes your leaderboard entry and with it your
          profile, including every computer&apos;s numbers. <strong>Remove everything</strong> in Your devices on your profile does the same.
        </li>
        <li>
          <strong>Remove device</strong> in Your devices on your profile removes one computer&apos;s numbers and cards; your totals are recomputed
          without it.
        </li>
        <li>Turning off <strong>Show my photo</strong> (on the leaderboard or your profile) removes your photo at once; so does publishing again with the photo box unticked.</li>
        <li>
          A share link is not stored anywhere by the site. To stop it working as a profile you published, remove your entry; the link itself
          keeps the numbers it was made with.
        </li>
        <li>
          On your machine, delete <code>~/.ai-insights/</code> to remove everything AI Insights wrote.
        </li>
      </ul>
    </DocShell>
  )
}
