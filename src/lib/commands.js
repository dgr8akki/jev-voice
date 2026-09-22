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

/**
 * The questions for one transcript: which action, which element, which site,
 * and (for partials) whether the speaker has finished.
 *
 * @param {{ elements: string[], final: boolean }} input
 */
export function buildQuestions({ elements, final }) {
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
        ...Object.fromEntries(elements.map((label, i) => [`e${i}`, label])),
        none: 'No page element is referred to',
      },
    },
    site: {
      type: 'choice',
      instructions: 'Which website does the user want to go to?',
      criteria: { ...Object.fromEntries(Object.keys(SITES).map((name) => [name, name])), other: 'None of these' },
    },
    ...(!final && {
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
  const action = answers.action.choice;
  const target = answers.target.choice === 'none' ? null : Number(answers.target.choice.slice(1));
  const site = answers.site.choice === 'other' ? null : answers.site.choice;

  if (!final) {
    const ready =
      !WAIT_FOR_FINAL.has(action) &&
      answers.action.confidence >= THRESHOLDS.early &&
      answers.complete.probability >= THRESHOLDS.complete &&
      (action !== 'click' || (target !== null && answers.target.confidence >= THRESHOLDS.earlyTarget)) &&
      (action !== 'navigate' || site !== null);
    if (!ready) return null;
  }
  if (answers.action.confidence < THRESHOLDS.act) return { action: 'none', target: null, site: null };
  return { action, target, site };
}

/**
 * A domain spoken outright ("facebook.com", "facebook dot com"), lowercased.
 *
 * @param {string} transcript
 * @returns {string | null}
 */
export function spokenDomain(transcript) {
  const match = transcript.match(/\b[a-z0-9-]+(?:(?:\.|\s+dot\s+)[a-z0-9-]+)*(?:\.|\s+dot\s+)[a-z]{2,}\b/i);
  return match ? match[0].replace(/\s+dot\s+/gi, '.').toLowerCase() : null;
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
