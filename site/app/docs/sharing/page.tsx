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
        ai-insights.app. You can type a display name (optional, up to 40 characters). The box lists every line the link contains before you copy
        it.
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
        Anyone you send the link to sees your card page. Links made by earlier versions, without cards, still open.
      </p>

      <H2 id="publish">Publish to the leaderboard</H2>
      <ol>
        <li>Open your share link and press <strong>Sign in to publish</strong>. Sign-in uses a Matrix OS account (see <a href="#account">Your account</a>).</li>
        <li>
          Pick a public handle: 3 to 30 characters, lowercase letters, digits and single hyphens, starting and ending with a letter or digit. Some
          handles are reserved, such as <code>admin</code>, <code>docs</code> or <code>leaderboard</code>.
        </li>
        <li>
          Choose whether to show your Matrix account photo. It is off by default; without it your profile shows your initials.
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
        Publishing again replaces your entry and its cards. To publish newer numbers, run <code>npx ai-insights@latest</code>, make a new share
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
        The leaderboard at <a href="/leaderboard">ai-insights.app/leaderboard</a> has five arenas. You rank in an arena only with a score above zero
        there.
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
        The per-agent arenas are estimates: the payload has no per-agent token split, so each agent&apos;s tokens are approximated from its share
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
        Open any share link while signed in and press <strong>Remove my entry</strong> in the publish panel. It deletes your leaderboard entry, which
        holds your published numbers and cards, so your profile and ranks go with it. Publishing without the photo box ticked removes a photo you showed before.
      </p>
    </DocShell>
  )
}
