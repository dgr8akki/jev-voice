/**
 * The command vocabulary and the rules that turn Jev's answers into browser
 * actions. Pure functions only: no Chrome APIs, so everything here is unit-tested.
 *
 * Jev never generates URLs, selectors or text. Code lists the candidates (actions,
 * on-page elements, known sites, spans of the transcript) and Jev picks one.
 *
 * @module lib/commands
 */

/** Sites reachable by name without a search. */
export const SITES = {
  google: 'https://www.google.com',
  youtube: 'https://www.youtube.com',
  wikipedia: 'https://en.wikipedia.org',
  github: 'https://github.com',
  gmail: 'https://mail.google.com',
  reddit: 'https://www.reddit.com',
  amazon: 'https://www.amazon.com',
  linkedin: 'https://www.linkedin.com',
  x: 'https://x.com',
  hackernews: 'https://news.ycombinator.com',
  maps: 'https://maps.google.com',
  vercel: 'https://vercel.com',
};

/** Every action the extension can take, described for Jev. */
export const ACTIONS = {
  navigate: 'Go to a website by name that is not one of the links on the current page',
  search: 'Search the web for something',
  click: 'Click, open or select something on the current page (a link, result, button)',
  type: 'Type or enter text into a field',
  retarget:
    'The text just typed went into the wrong field: move it to another field (e.g. "no, that is the first name not the surname", "put it in email instead")',
  scroll_down: 'Scroll down',
  scroll_up: 'Scroll up',
  back: 'Go back to the previous page',
  forward: 'Go forward',
  reload: 'Reload or refresh the page',
  new_tab: 'Open a new empty tab',
  close_tab: 'Close the current tab',
  next_tab: 'Switch to the next tab',
  prev_tab: 'Switch to the previous tab',
  none: 'Not a browser command (chatter, filler, unclear)',
};

/** Actions whose argument keeps growing while the user talks: never act on a partial. */
const WAIT_FOR_FINAL = new Set(['search', 'type', 'retarget', 'none']);

/** A partial that ends on one of these verbs has its text still to come; there is nothing to ask about yet. */
const FREE_TEXT_VERB = /\b(?:search(?:\s+for)?|look\s+up|google|type|write|enter|put|insert)\s*$/i;

/** Hand-tuned against the eval suite; lower acts sooner but misfires more. */
export const THRESHOLDS = { act: 0.5, early: 0.8, earlyTarget: 0.8, complete: 0.7 };

/** Commands longer than this are dictation: type everything after the verb. */
const MAX_SPAN_WORDS = 16;

const SUBMIT_SUFFIX = /\s*\band (?:press |hit )?(?:enter|submit|search)\s*$/i;

/**
 * @typedef {object} Command
 * @property {keyof typeof ACTIONS} action
 * @property {number | null} target Index into the page's element list.
 * @property {string | null} site Key of `SITES`, if Jev recognised one.
 */

/** How much of a page's own text goes into a candidate label. */
const LABEL_LIMIT = 60;

const ordinal = (n) => {
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
};

/** Page text as it may travel to the provider: no quotes or line breaks, one line, at most LABEL_LIMIT characters. */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/["'`\u2018\u2019\u201c\u201d]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LABEL_LIMIT);
}

/**
 * A snapshot label as Jev sees it. The page wrote the text, so it is cut to
 * a sentence, stripped of quotes and line breaks that could dress it up as an
 * instruction, and prefixed with the element's kind and position, which the
 * page does not control. "3rd link: Pricing".
 *
 * @param {string} label `kind: text` from `snapshot()`.
 * @param {number} index Position in the snapshot, top to bottom.
 */
export function describeElement(label, index) {
  const colon = label.indexOf(': ');
  const kind = colon === -1 ? 'element' : label.slice(0, colon);
  const text = cleanText(colon === -1 ? label : label.slice(colon + 2));
  return `${ordinal(index + 1)} ${kind}: ${text || '(unlabeled)'}`;
}

/**
 * The questions for one transcript: which action, which element, which site,
 * and (for partials) whether the speaker has finished. That last one is left
 * out when the partial ends in a verb that takes free text, since the answer
 * is known to be no.
 *
 * @param {{ elements: string[], final: boolean, text?: string }} input
 */
export function buildQuestions({ elements, final, text = '' }) {
  return {
    action: {
      type: 'choice',
      instructions: 'Which browser action does the spoken command ask for?',
      criteria: ACTIONS,
    },
    target: {
      type: 'choice',
      instructions: 'Which on-page element does the command refer to? Elements are listed top to bottom.',
      criteria: {
        ...Object.fromEntries(elements.map((label, i) => [`e${i}`, describeElement(label, i)])),
        none: 'No page element is referred to',
      },
    },
    site: {
      type: 'choice',
      instructions: 'Which website does the user want to go to?',
      criteria: { ...Object.fromEntries(Object.keys(SITES).map((name) => [name, name])), other: 'None of these' },
    },
    ...(!final &&
      !FREE_TEXT_VERB.test(text) && {
        complete: {
          type: 'boolean',
          instructions:
            'This is a live partial speech transcript. Is the command already complete enough to act on, with nothing important likely still to be said?',
          criteria: {
            true: 'Complete, e.g. "go to youtube", "scroll down", "go back"',
            false: 'Cut off mid-command, e.g. "go to", "click the", "open the second"',
          },
        },
      }),
  };
}

/**
 * Turns Jev's answers into a command, or `null` while a partial transcript
 * isn't safe to act on yet.
 *
 * @param {Record<string, any>} answers
 * @param {{ final: boolean }} context
 * @returns {Command | null}
 */
export function toCommand(answers, { final }) {
  // A partial reply or a schema change must read as "no command", not as a TypeError.
  // On a partial transcript that means "wait", so the utterance stays open for its final.
  const action = answers?.action?.choice;
  if (typeof action !== 'string') return final ? { action: 'none', target: null, site: null } : null;
  const targetChoice = answers.target?.choice;
  const target = /^e\d+$/.test(targetChoice ?? '') ? Number(targetChoice.slice(1)) : null;
  const siteChoice = answers.site?.choice;
  const site = typeof siteChoice === 'string' && siteChoice in SITES ? siteChoice : null;

  if (!final) {
    const ready =
      !WAIT_FOR_FINAL.has(action) &&
      (answers.action.confidence ?? 0) >= THRESHOLDS.early &&
      (answers.complete?.probability ?? 0) >= THRESHOLDS.complete &&
      (action !== 'click' || (target !== null && (answers.target.confidence ?? 0) >= THRESHOLDS.earlyTarget)) &&
      (action !== 'navigate' || site !== null);
    if (!ready) return null;
  }
  if ((answers.action.confidence ?? 0) < THRESHOLDS.act) return { action: 'none', target: null, site: null };
  return { action, target, site };
}

/** Spoken forms of the commands that need neither the page nor Jev. Anchored, so "go back to the list" falls through. */
const LOCAL = [
  [/^scroll\s+down\b/, 'scroll_down'],
  [/^scroll\s+up\b/, 'scroll_up'],
  [/^(?:go\s+)?back$/, 'back'],
  [/^(?:go\s+)?forward$/, 'forward'],
  [/^(?:reload|refresh)(?:\s+(?:the\s+)?page)?$/, 'reload'],
  [/^(?:open\s+(?:a\s+)?)?new\s+tab$/, 'new_tab'],
  [/^next\s+tab$/, 'next_tab'],
  [/^(?:previous|prev|last)\s+tab$/, 'prev_tab'],
  [/^close\s+(?:(?:this|the|current)\s+)?tab$/, 'close_tab'],
];
const GO = /^(?:go\s+to|open|visit|navigate\s+to)\s+(.+)$/;

/**
 * The command a transcript spells out on its own, or `null` when it takes the
 * page or Jev to know. Scroll, history, tabs, and "open" followed by a known
 * site or a spoken domain: enough to be useful before a key is connected.
 *
 * @param {string} text
 * @param {{ final?: boolean }} [context]
 * @returns {Command | null}
 */
export function localCommand(text, { final = true } = {}) {
  const said = text
    .trim()
    .toLowerCase()
    .replace(/[.,!?]+$/, '');
  for (const [pattern, action] of LOCAL) if (pattern.test(said)) return { action, target: null, site: null };

  const name = said.match(GO)?.[1];
  if (!name) return null;
  if (spokenDomain(name) === name.replace(/\s+dot\s+/g, '.')) return { action: 'navigate', target: null, site: null };
  const site = name.replace(/\s+/g, '');
  if (!SITES[site]) return null;
  // A one-letter site name ("x") can be the first letter of a longer word while the sentence is still coming.
  if (!final && site.length < 3) return null;
  return { action: 'navigate', target: null, site };
}

/**
 * Endings a spoken "something.x" may have before it counts as a web address.
 * Recognizers write "readme.md" and "node.js" with a dot too, and those are
 * not sites. Saying "dot" out loud is taken at its word whatever follows.
 */
const TLDS = new Set(
  'com net org io co uk ie de fr es it nl eu us ca au nz in jp ch se no dk fi pl be at edu gov info biz dev app ai me tv fm gg to xyz site online tech store shop blog news'.split(
    ' ',
  ),
);

/**
 * A domain spoken outright ("facebook.com", "facebook dot com"), lowercased.
 *
 * @param {string} transcript
 * @returns {string | null}
 */
export function spokenDomain(transcript) {
  const match = transcript.match(/\b[a-z0-9-]+(?:(?:\.|\s+dot\s+)[a-z0-9-]+)*(?:\.|\s+dot\s+)[a-z]{2,}\b/i);
  if (!match) return null;
  const spokenDot = /\sdot\s/i.test(match[0]);
  const domain = match[0].replace(/\s+dot\s+/gi, '.').toLowerCase();
  return spokenDot || TLDS.has(domain.slice(domain.lastIndexOf('.') + 1)) ? domain : null;
}

/**
 * The URL for a `navigate` command: a spoken domain, then a known site, then
 * Google's "I'm Feeling Lucky" for the spoken name.
 *
 * @param {string} transcript
 * @param {string | null} site
 */
export function navigationUrl(transcript, site) {
  const domain = spokenDomain(transcript);
  if (domain) return `https://${domain}`;
  if (site && SITES[site]) return SITES[site];
  const name = transcript.replace(/^.*?\b(?:go to|open|visit|navigate to)\b\s*/i, '').trim();
  return `https://www.google.com/search?btnI=1&q=${encodeURIComponent(name)}`;
}

/**
 * The query in "search for alan turing" / "look up the weather".
 *
 * @param {string} transcript
 */
export function searchQuery(transcript) {
  return transcript.replace(/^.*?\b(?:search|look up|google)\b(?:\s+for)?\s*/i, '').trim();
}

/**
 * Candidate texts for a `type` command, plus whether to submit afterwards.
 *
 * Jev can't write text, so every run of consecutive words is a candidate and Jev
 * picks the one to type. Word order and verb don't matter ("surname Pahuja",
 * "in first name put Akash"). Long commands are dictation: everything after the verb.
 *
 * @param {string} transcript
 * @returns {{ candidates: string[], submit: boolean }}
 */
export function textCandidates(transcript) {
  const submit = SUBMIT_SUFFIX.test(transcript);
  const body = transcript.replace(SUBMIT_SUFFIX, '').trim();
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length > MAX_SPAN_WORDS) {
    return { candidates: [body.replace(/^.*?\b(?:type|write|enter|put|insert)\b\s*/i, '')], submit };
  }
  const spans = [];
  for (let start = 0; start < words.length; start += 1) {
    for (let end = words.length; end > start; end -= 1) spans.push(words.slice(start, end).join(' '));
  }
  return { candidates: [...new Set(spans)], submit };
}

/**
 * The question asking Jev which candidate is the text to type.
 *
 * @param {string[]} candidates
 */
export function textQuestion(candidates) {
  return {
    text: {
      type: 'choice',
      instructions:
        'Exactly which words should be typed into the field? Leave out the command words and the field name (e.g. "type", "in the email bar", "surname").',
      criteria: Object.fromEntries(candidates.map((text, i) => [`t${i}`, `"${text}"`])),
    },
  };
}
