import { DocShell } from "@/components/docs/doc-shell"
import { Callout, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("sharing")

export default function Sharing() {
  return (
    <DocShell slug="sharing">
      <p>
        Everything on this page is optional and starts with something you do. The package never publishes anything: sharing happens on the
        website, and only after you open a link you made and press a button.
      </p>

      <H2 id="share-links">Share links</H2>
      <p>
        Below the card studio in your report, the &ldquo;Share your stats and cards, join the leaderboard&rdquo; box builds a link to a card page on
        ai-insights.app. You can type a display name (optional, up to 40 characters) and a name for this computer, such as &ldquo;Work
        laptop&rdquo; (optional, up to 32 characters). The box lists every line the link contains before you copy it.
      </p>
      <ul>
        <li>
          <strong>The data lives in the link.</strong> It travels in the URL fragment, the part after <code>#</code> in{" "}
          <code>https://ai-insights.app/share/#…</code>. Browsers do not send the fragment to the site, so opening the link uploads nothing.
        </li>
        <li>
          <strong>It holds only aggregate numbers and fixed wording:</strong> your totals, earned titles and ratios as numbers, and your recap cards
          as short lines. The exact list is in <a href="/docs/privacy#share-link-contents">What a share link contains</a>.
        </li>
        <li>
          <strong>Buttons:</strong> Publish to the leaderboard (opens the link), Copy link, and X or LinkedIn posts with the link.
        </li>
      </ul>
      <p>
        Anyone you send the link to sees your card page. Links made by earlier versions, without cards or without a device, still open and
        still publish.
      </p>

      <H2 id="publish">Publish to the leaderboard</H2>
      <ol>
        <li>Open your share link and press <strong>Sign in to publish</strong>. Sign-in uses a Matrix OS account (see <a href="#account">Your account</a>).</li>
        <li>
          Pick a public handle: 3 to 30 characters, lowercase letters, digits and single hyphens, starting and ending with a letter or digit. Some
          handles are reserved, such as <code>admin</code>, <code>docs</code> or <code>leaderboard</code>.
        </li>
        <li>
          Choose whether to show your Matrix account photo. It is off by default; without it your profile shows your initials. You can turn it on
          or off later without publishing again: use <strong>Show my photo</strong> on the leaderboard or in Your devices on your profile.
        </li>
        <li>
          Check the preview. It lists exactly what becomes public: name, photo choice, profile address, period, sessions, tokens, estimated spend,
          active days, longest streak, agents, fun fact, each title with its rule, your ratios and each card.
        </li>
        <li>
          Press <strong>Publish</strong>.
        </li>
      </ol>
      <p>
        Publishing again from the same computer replaces that computer&apos;s numbers and cards; publishing from another computer adds it (see{" "}
        <a href="#devices">Several computers</a>). To publish newer numbers, run <code>npx ai-insights@latest</code>, make a new share
        link from the new report, open it and publish.
      </p>
      <Callout title="Self-reported, not verified">
        <p>
          The site checks that a payload has the right shape and limits. It cannot check that the numbers came from a real history, and the
          leaderboard says so.
        </p>
      </Callout>

      <H2 id="arenas">Arenas and ranks</H2>
      <p>
        The leaderboard at <a href="/leaderboard">ai-insights.app/leaderboard</a> is one table: rank, person, tokens, estimated spend, Claude Code
        and Codex tokens, longest streak, active days, sessions, devices and period. Click a column header to sort by it; the sort is part of the
        address (for example <code>/leaderboard?sort=codex</code>), so a sorted view can be shared. The five arenas below are quick presets above
        the table. Rank is computed for the column you sort by, and you rank there only with a value above zero; people without one are listed
        after everyone ranked, with no rank. On a phone each row shows the sorted number with its bar, and the other numbers on a second line.
      </p>
      <Table
        caption="Arenas"
        head={["Arena", "Ranked by"]}
        rows={[
          ["Most tokens", "Total tokens."],
          ["Most spent", "Estimated spend at API list prices."],
          ["Top Claude Code user", "Your tokens times Claude Code's share of your sessions."],
          ["Top Codex user", "Your tokens times Codex's share of your sessions."],
          ["Longest streak", "Longest run of active days in a row."],
        ]}
      />
      <p>
        Older links that use <code>?arena=</code> still open the same arena. The per-agent arenas are estimates: the payload has no per-agent token split, so each agent&apos;s tokens are approximated from its share
        of sessions. Ties share a rank. On boards with fewer than 20 entries a rank reads &ldquo;#3 of 12&rdquo;; on larger boards it reads as a
        top percentage, such as &ldquo;Top 4%&rdquo;.
      </p>

      <H2 id="profiles">Profiles</H2>
      <p>
        Publishing gives you a profile at <code>ai-insights.app/u/&lt;handle&gt;</code> with your numbers, your recap cards, your earned titles and
        ratios, and a badge for each arena you rank in: &ldquo;#3 Most tokens&rdquo; inside the top ten, &ldquo;Top 4% in Codex&rdquo; below it.
        Profiles have their own link preview image.
      </p>
      <p>
        Your profile shows visitors how many people you brought to AI Insights. Only you, signed in, see the list of who they are.
      </p>

      <H2 id="devices">Several computers</H2>
      <p>
        If you use coding agents on more than one machine, run AI Insights on each and publish from each report while signed in to the same
        account. Your handle, display name, photo choice and referral credit belong to the account; the numbers belong to each computer.
      </p>
      <ul>
        <li>
          <strong>How computers are told apart.</strong> Each installation makes a random id once and keeps it in{" "}
          <code>~/.ai-insights/device.json</code>. The share link carries it. It is never made from the computer&apos;s name, your username or any
          hardware detail, and it grants nothing by itself (see <a href="/docs/privacy#device-id">The device id</a>).
        </li>
        <li>
          <strong>Republishing</strong> from a computer replaces only that computer&apos;s numbers. A new computer is added. An account holds at most
          10 computers.
        </li>
        <li>
          <strong>Names.</strong> A computer&apos;s name is public only if you tick &ldquo;Show this computer&apos;s name&rdquo; when you publish, or
          later on your profile. Otherwise visitors see &ldquo;Device 1&rdquo;, &ldquo;Device 2&rdquo; in the order you first published.
        </li>
        <li>
          <strong>Your first publish from 0.5.</strong> An entry published by an older report has no device. When you publish from 0.5 on a computer
          you used before, the panel asks whether this is the same computer, so the earlier entry is replaced instead of counted twice.
        </li>
      </ul>
      <p>Your profile leads with the combined numbers, and the leaderboard ranks them, with a small &ldquo;n devices&rdquo; marker:</p>
      <Table
        caption="How computers are combined"
        head={["Number", "Combined as"]}
        rows={[
          ["Sessions, tokens, estimated spend", "Added up. Spend adds the computers that had a price."],
          ["Period", "Earliest first day to latest last day."],
          ["Active days, longest streak", "Recomputed from the days each computer was active, so a day used on two computers counts once. If a computer did not send its active days, these are lower bounds and the profile says “at least”."],
          ["Agents", "Each agent's share, weighted by each computer's sessions. Agent arenas add each computer's own estimate."],
          ["Ratios and earned titles", "Recombined from the counts behind each ratio, then titles are earned again with the same rules. A ratio from an older report without its count is shown only on that computer. Sessions at once is a lower bound, since two computers can run at the same time."],
          ["Recap cards", "“All devices” shows each card once, from the busiest computer that has it, labelled with that computer; tokens and the streak are rebuilt from the totals. Pick a computer to see its own cards and ratios."],
        ]}
      />
      <Callout title="Same history on two computers">
        <p>
          If two computers publish exactly the same period, sessions and tokens, usually because they read one synced home folder, the history is
          counted once and you are told. Remove one of them. Partly overlapping histories cannot be detected.
        </p>
      </Callout>
      <p>
        On your profile, signed in, <strong>Your devices</strong> lists each computer with its last publish and its own numbers. You can rename a
        computer, choose whether its name is public, remove it (its numbers leave the total), or remove everything.
      </p>

      <H2 id="referrals">Referrals</H2>
      <ul>
        <li>
          Links the site makes to a published person&apos;s profile carry <code>?ref=&lt;handle&gt;</code>. Arriving at a profile from outside the
          site counts too; a click inside the site, such as down the leaderboard, does not.
        </li>
        <li>
          The site remembers that handle in a first-party, HttpOnly cookie on ai-insights.app for 30 days. The first referrer wins; a later link
          does not replace it.
        </li>
        <li>
          If you later publish for the first time, that person is credited once. Never yourself, and never a handle that has not published. The
          handle is also recorded in your Matrix account&apos;s metadata.
        </li>
        <li>The site&apos;s analytics only ever learn that a link had a referrer, never whose.</li>
      </ul>

      <H2 id="account">Your account</H2>
      <p>
        Sign-in on ai-insights.app uses your Matrix OS account: the site runs as a satellite of the Matrix OS sign-in, so you sign in on the
        Matrix OS sign-in page and are sent back. If you are already signed in to Matrix OS in the same browser, the site recognises you. Sign-in loads
        only on the share, leaderboard and profile pages; the landing page and these docs never load it.
      </p>
      <p>Once you are signed in, the account menu in the header has:</p>
      <ul>
        <li>
          <strong>My profile</strong>, or how to publish if you have not yet;
        </li>
        <li>
          <strong>Leaderboard</strong>;
        </li>
        <li>
          <strong>People I referred</strong>;
        </li>
        <li>
          <strong>Open Matrix OS</strong>;
        </li>
        <li>managing your account, and signing out.</li>
      </ul>
      <p>
        When you are signed in on a share page, the site notes once in your Matrix account&apos;s metadata when you first used AI Insights.
      </p>

      <H2 id="remove">Remove your entry</H2>
      <p>
        Press <strong>Remove everything</strong> in Your devices on your profile (visible only to you, signed in). It deletes your leaderboard entry
        and every computer&apos;s numbers and cards, so your profile and ranks go with it. <strong>Remove my entry</strong> in the publish panel on
        any share link does the same. To remove one computer only, press <strong>Remove device</strong> next to it there; the last one cannot be
        removed that way. To hide your photo, turn off <strong>Show my photo</strong>; publishing with the photo box unticked also removes it.
      </p>
    </DocShell>
  )
}
