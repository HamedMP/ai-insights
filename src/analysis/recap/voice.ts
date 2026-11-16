import type { RecapCount, RecapVoice, Session } from "../../schema/types.js";
import { bump, toCounts } from "../activity.js";
import { isAgentDriven } from "../sessions.js";
import { isQuestion, isVoice, isWrapped, POLITE, tokens, wordCount } from "./text.js";
import { OPENERS, VOCABULARY } from "./vocabulary.js";

/** A short prompt this many words or fewer can be the "small ask, big job" one. */
const LEVERAGE_WORDS = 5;

function opener(words: string[]): string | null {
  const two = words.slice(0, 2).join(" ");
  if (OPENERS.has(two)) return two;
  return words[0] && OPENERS.has(words[0]) ? words[0] : null;
}

/** Tool calls between each prompt and the next, with one pass over calls sorted by time. */
function callsPerPrompt(session: Session, prompts: Array<{ ms: number }>): number[] {
  const times: number[] = [];
  for (const call of session.toolCalls) {
    const ms = Date.parse(call.timestamp);
    if (Number.isFinite(ms)) times.push(ms);
  }
  times.sort((a, b) => a - b);
  const counts: number[] = [];
  let index = 0;
  for (let n = 0; n < prompts.length; n += 1) {
    const from = prompts[n]!.ms;
    const to = n + 1 < prompts.length ? prompts[n + 1]!.ms : Number.POSITIVE_INFINITY;
    while (index < times.length && times[index]! < from) index += 1;
    let end = index;
    while (end < times.length && times[end]! < to) end += 1;
    counts.push(end - index);
    index = end;
  }
  return counts;
}

/**
 * How the person talks to agents, from the prompts they typed themselves: sessions another agent drove,
 * slash commands and script-filled templates are left out. Only counts and allowlisted words come out.
 */
export function buildVoice(sessions: Session[]): RecapVoice {
  const vocabulary = new Map<string, number>();
  const openers = new Map<string, number>();
  const polite = { please: 0, thanks: 0, sorry: 0 };
  let prompts = 0;
  let excludedAgentSessions = 0;
  let excludedWrapped = 0;
  let questions = 0;
  let wordsTyped = 0;
  let oneWord = 0;
  let leverage: RecapVoice["leverage"];
  for (const session of sessions) {
    if (isAgentDriven(session)) {
      excludedAgentSessions += 1;
      continue;
    }
    const typed: Array<{ ms: number; words: number }> = [];
    for (const prompt of session.prompts) {
      if (isWrapped(prompt)) excludedWrapped += 1;
      if (!isVoice(prompt)) continue;
      prompts += 1;
      const words = tokens(prompt.text);
      const count = wordCount(prompt.text);
      wordsTyped += count;
      if (words.length === 1) oneWord += 1;
      if (isQuestion(prompt.text)) questions += 1;
      for (const word of new Set(words)) if (VOCABULARY.has(word)) bump(vocabulary, word);
      const open = opener(words);
      if (open) bump(openers, open);
      if (POLITE.please.test(prompt.text)) polite.please += 1;
      if (POLITE.thanks.test(prompt.text)) polite.thanks += 1;
      if (POLITE.sorry.test(prompt.text)) polite.sorry += 1;
      const ms = Date.parse(prompt.timestamp);
      if (Number.isFinite(ms)) typed.push({ ms, words: count });
    }
    if (!typed.length || !session.toolCalls.length) continue;
    typed.sort((a, b) => a.ms - b.ms);
    const calls = callsPerPrompt(session, typed);
    typed.forEach((prompt, index) => {
      const toolCalls = calls[index]!;
      if (prompt.words > 0 && prompt.words <= LEVERAGE_WORDS && toolCalls > 0 && (!leverage || toolCalls > leverage.toolCalls)) leverage = { words: prompt.words, toolCalls };
    });
  }
  const voice: RecapVoice = {
    prompts,
    excludedAgentSessions,
    excludedWrapped,
    words: toCounts(vocabulary, 5) as RecapCount[],
    openers: toCounts(openers, 3) as RecapCount[],
    polite,
    questionShare: prompts ? questions / prompts : 0,
    wordsTyped,
    oneWord,
  };
  if (leverage) voice.leverage = leverage;
  return voice;
}
