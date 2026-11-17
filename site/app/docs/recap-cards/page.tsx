import { DocShell } from "@/components/docs/doc-shell"
import { Callout, Code, DocLink, H2, Shot, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"
import { HASHTAG } from "@/lib/site"

export const metadata = docMetadata("recap-cards")

/** Card ids from src/render/client/engine.js, with what each shows. */
const CARDS: Array<[string, string]> = [
  ["intro", "Opens the recap: your last N days with AI, your agents and your busy days, one square per day."],
  ["hours", "Time with agents: clock hours and agent-hours."],
  ["clock", "When you prompt, and whether you are a night owl, an early bird or a daytime builder."],
  ["weekday", "Your busiest day of the week."],
  ["streak", "Your longest run of days in a row."],
  ["words", "Words you typed, your favourite word and how many prompts were questions."],
  ["manners", "Your pleases, thank-yous and sorries."],
  ["slash", "The slash commands you use most."],
  ["shell", "Bash hall of fame: the programs your agents ran most."],
  ["tests", "Test runs and how many passed."],
  ["danger", "Living dangerously: rm -rf, force pushes and naps."],
  ["parallel", "The most agents you ran at once."],
  ["marathon", "Your longest session."],
  ["failures", "Where things broke: failed tool calls by kind."],
  ["nemesis", "The programs that failed most often."],
  ["model", "Your top model."],
  ["tokens", "Tokens processed and the estimated cost."],
  ["persona", "Your persona, from fixed rules over your numbers."],
  ["tips", "Three things to try next, from your findings."],
  ["summary", "Everything on one card."],
  ["outro", "How to make your own."],
  ["thinking", "Deep thoughts: thinking blocks. Offered with 10 or more."],
  ["approvals", "Rubber stamp: actions approved automatically and by hand. Offered when both are recorded."],
  ["history", "History kept: how many days of history AI Insights holds. Offered when retention data exists."],
  ["titles", "Titles earned. Offered when you earned at least one."],
]

export default function RecapCards() {
  return (
    <DocShell slug="recap-cards">
      <p>
        The report opens on your recap: animated cards you can post, built only from counts, dates, allowlisted words and public program, model
        and agent names. Your prompts, file and project names, paths and session ids never appear on a card, and the private analysis never reaches
        one.
      </p>

      <H2 id="cards">The cards</H2>
      <p>
        There are 21 standard cards and 4 more that are offered when your history has the data. A card only appears when there is something true
        to show. The id is what you use in the <a href="#url-options"><code>cards</code> URL option</a>.
      </p>
      <Table caption="Recap cards" head={["Card id", "What it shows"]} rows={CARDS.map(([id, what]) => [<code key={id}>{id}</code>, what])} />
      <p>
        A new recap starts with persona, parallel, danger, manners, words and clock, then summary and outro: about 54 seconds, which fits Stories,
        Reels and X without a warning. Cost stays off by default; add the tokens card if you want it.
      </p>

      <H2 id="styles-and-shapes">Styles and shapes</H2>
      <ul>
        <li>
          <strong>Three styles:</strong> Pop (the default), Instrument panel and Sticker sheet. Switch them at the top of the report.
        </li>
        <li>
          <strong>Four shapes:</strong> 1:1, 9:16, 4:5 and 16:9. Each card is laid out again for the shape rather than cropped.
        </li>
        <li>
          <strong>The mark:</strong> every card carries &ldquo;AI Insights by Matrix OS&rdquo; by default. The &ldquo;AI Insights mark&rdquo; switch
          in the studio turns it off.
        </li>
      </ul>
      <div className="not-prose grid grid-cols-3 gap-2 sm:gap-3">
        {[
          ["card-pop-persona", "The persona card in the Pop style"],
          ["card-panel-hours", "The time card in the Instrument panel style"],
          ["card-sticker-parallel", "The parallel card in the Sticker sheet style"],
        ].map(([name, alt]) => (
          // eslint-disable-next-line @next/next/no-img-element -- static files from public/
          <img key={name} src={`/media/${name}.webp`} alt={alt} width={560} height={560} loading="lazy" decoding="async" className="w-full rounded-lg border" />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Pop, Instrument panel and Sticker sheet, from the sample report (invented sessions).</p>

      <H2 id="deck">Reading your cards</H2>
      <p>
        The top of the report shows every card you earned, persona first, then the ones people talk about most, with the summary and the closing
        card last. One card is shown large and plays its animation; a grid of all of them sits beside it (a strip under it on a phone).
      </p>
      <ul>
        <li>
          <strong>Move between cards</strong> with the arrow buttons, the left and right arrow keys, a swipe, or by picking one in the grid. The
          cards play on their own until you move; then the card you picked stays.
        </li>
        <li>
          <strong>Full screen</strong> plays the whole set. With reduced motion turned on in your system, cards are shown at rest and do not play
          on their own.
        </li>
        <li>
          <strong>Browsing does not change your video.</strong> The studio decides which cards go into the video, and your share link is the same
          whichever card you look at.
        </li>
      </ul>

      <H2 id="studio">The card studio</H2>
      <p>Further down the report, after the Publish section, the studio has everything for making a post:</p>
      <ul>
        <li>
          <strong>Pick and order cards.</strong> Click a card to include or leave it out. Drag it, use its arrow buttons, or press Alt with the left
          or right arrow key to move it. Select all and Reset are next to the export buttons.
        </li>
        <li>
          <strong>Where you will post.</strong> Choose X, Instagram feed, Instagram Reels, Instagram Stories, TikTok, LinkedIn,
          LinkedIn carousel (PDF) or YouTube Shorts. The studio checks the total length against that platform&apos;s limit and recommends a shape;
          for the carousel it counts pages instead (see <a href="#linkedin">Post to LinkedIn</a>).
        </li>
        <li>
          <strong>Pace.</strong> Full plays each card at its own length; Quick caps every card at 4 seconds.
        </li>
        <li>
          <strong>Preview</strong> plays the selection.
        </li>
      </ul>
      <p>The studio remembers your choices in the browser for the next time you open a report.</p>
      <Shot
        src="/media/report-studio.webp"
        width={1400}
        height={1094}
        alt="The card studio: a grid of card thumbnails with shape, platform, pace and export controls."
        caption="The card studio, from the sample report (invented sessions)."
      />

      <H2 id="export">Export video, images and PDF</H2>
      <ul>
        <li>
          <strong>Download video</strong> renders an MP4 of the selected cards in the page. It needs a browser with the WebCodecs video encoder,
          which today means Chromium-based browsers such as Chrome, Edge, Brave and Arc. Other browsers get the{" "}
          <a href="#terminal-recipe">terminal recipe</a> instead.
        </li>
        <li>
          <strong>Download images</strong> saves a PNG of each selected card; several come as one zip.
        </li>
        <li>
          <strong>Download PDF</strong> saves the selected cards as one square PDF, one card per page, for a{" "}
          <a href="#linkedin">LinkedIn carousel</a>.
        </li>
        <li>
          <strong>Copy caption</strong> copies the post text described under <a href="#share-buttons">Share buttons</a>.
        </li>
      </ul>
      <p>Nothing is uploaded: the files are made in the page and saved by your browser.</p>

      <H2 id="linkedin">Post to LinkedIn</H2>
      <p>
        LinkedIn shows a PDF in a post as slides people swipe through. In the studio, set <strong>Posting to</strong> to{" "}
        <strong>LinkedIn carousel (PDF)</strong>: the shape switches to square, the length bar counts pages, and <strong>Download PDF</strong>{" "}
        becomes the main button. It saves <code>ai-insights-linkedin.pdf</code> with your selected cards in the studio&apos;s order, each at
        rest (the last frame of its animation), in the style you picked and with the AI Insights mark if it is on. The file&apos;s only metadata
        is the title &ldquo;AI Insights recap&rdquo;.
      </p>
      <ol>
        <li>In LinkedIn, press <strong>Start a post</strong>, then <strong>More</strong> and <strong>Add a document</strong>.</li>
        <li>Choose the PDF, give the document a title and press <strong>Done</strong>.</li>
        <li>Paste the caption (<strong>Copy caption</strong> in the studio gives a LinkedIn version) and press <strong>Post</strong>.</li>
      </ol>
      <p>
        LinkedIn takes documents of up to 300 pages and 100 MB (<a href="https://www.linkedin.com/help/linkedin/answer/a518909">Upload and share
        documents on LinkedIn</a>). A full deck of 23 cards is about 6 MB. The plain <strong>LinkedIn</strong> target is still there for posting the video.
      </p>

      <H2 id="terminal-recipe">Render in a terminal</H2>
      <p>
        When the browser cannot encode video, the studio shows a shell script that takes headless screenshots of each card frame by frame and
        stitches them with ffmpeg. It needs Chrome or Chromium and ffmpeg, runs in the folder that holds <code>report.html</code>, and takes a few
        minutes. The script is generated for your current selection, shape and style, so copy it from the report rather than from here.
      </p>
      <p>
        Each frame is the report opened in capture mode, <code>report.html?capture=&lt;card&gt;&amp;t=&lt;ms&gt;</code>, which draws one card at
        one moment, so the video matches what you see in the page.
      </p>

      <H2 id="share-buttons">Share buttons</H2>
      <p>After an export, a &ldquo;Share it&rdquo; row appears under it. Each button is a link you click; the page itself sends nothing.</p>
      <ul>
        <li>
          <strong>Share…</strong> opens your system share sheet with the files and the caption, where the browser can share files (mostly phones).
        </li>
        <li>
          <strong>X</strong> opens a new post with the caption. A single image is copied to your clipboard to paste in; otherwise the file is saved
          for you to attach.
        </li>
        <li>
          <strong>LinkedIn</strong> saves the file and opens a new post with the caption.
        </li>
        <li>
          <strong>Instagram</strong> and <strong>TikTok / Shorts</strong> save the file and copy the caption, since those apps take uploads only.
        </li>
        <li>
          <strong>Download</strong> and <strong>Copy caption</strong> do just that.
        </li>
      </ul>
      <p>
        The caption is built from the recap only: your persona, two or three of your biggest numbers, how to make your own, and{" "}
        <code>{HASHTAG}</code>, kept under X&apos;s 280 characters.
      </p>
      <p>
        The &ldquo;Share your stats and cards&rdquo; box in the Publish section, just above the studio, makes a link to your card on the website
        instead. That is covered in{" "}
        <DocLink href="/docs/sharing#share-links">Share links</DocLink>.
      </p>

      <H2 id="url-options">Report URL options</H2>
      <p>
        You can set the studio from the report&apos;s address, after <code>?</code> or <code>#</code>. Options in the URL win over what the browser
        remembered.
      </p>
      <Table
        caption="Report URL options"
        head={["Option", "Values", "Effect"]}
        rows={[
          [<code key="s">style</code>, <><code>pop</code>, <code>panel</code>, <code>sticker</code></>, "The card style."],
          [<code key="r">ratio</code>, <><code>1:1</code>, <code>9:16</code>, <code>4:5</code>, <code>16:9</code></>, "The card shape."],
          [<code key="c">cards</code>, "Card ids, comma-separated", "Selects those cards, in that order."],
          [<code key="m">mark</code>, <code key="0">0</code>, "Hides the AI Insights mark."],
        ]}
      />
      <Code label="Example" copy={false}>{`report.html?style=sticker&ratio=9:16&cards=persona,parallel,streak,summary,outro`}</Code>
      <Callout title="Use a browser for the report">
        <p>
          The report runs its own script to draw the cards. It loads nothing from the network: its Content-Security-Policy is{" "}
          <code>default-src &apos;none&apos;</code>.
        </p>
      </Callout>
    </DocShell>
  )
}
