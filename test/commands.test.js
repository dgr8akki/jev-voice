import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIONS,
  SITES,
  buildQuestions,
  describeElement,
  localCommand,
  navigationUrl,
  searchQuery,
  spokenDomain,
  textCandidates,
  textQuestion,
  toCommand,
} from '../src/lib/commands.js';
import { choice, yesNo } from './helpers.js';

const answers = ({
  action,
  confidence = 0.95,
  target = 'none',
  targetConfidence = 0.95,
  site = 'other',
  complete = 0.9,
}) => ({
  action: choice(action, confidence),
  target: choice(target, targetConfidence),
  site: choice(site),
  complete: yesNo(complete),
});

describe('buildQuestions', () => {
  it('lists every action, the page elements and the known sites', () => {
    const q = buildQuestions({ elements: ['link: Pricing', 'field: Email'], final: true });
    assert.deepEqual(q.action.criteria, ACTIONS);
    assert.deepEqual(q.target.criteria, {
      e0: '1st link: Pricing',
      e1: '2nd field: Email',
      none: 'No page element is referred to',
    });
    assert.deepEqual(Object.keys(q.site.criteria), [...Object.keys(SITES), 'other']);
    assert.equal(q.complete, undefined);
  });

  it('asks whether a partial transcript is complete', () => {
    assert.equal(buildQuestions({ elements: [], final: false, text: 'go to' }).complete.type, 'boolean');
  });

  it('does not ask when the partial ends in a verb whose text is still coming', () => {
    for (const text of ['search for', 'type', 'look up', 'in the email field put', 'google']) {
      assert.equal(buildQuestions({ elements: [], final: false, text }).complete, undefined, text);
    }
    assert.ok(buildQuestions({ elements: [], final: false, text: 'type hello' }).complete);
  });
});

describe('describeElement', () => {
  it('prefixes each label with its position, which the page cannot fake', () => {
    assert.equal(describeElement('button: Send', 0), '1st button: Send');
    assert.equal(describeElement('link: Docs', 1), '2nd link: Docs');
    assert.equal(describeElement('link: Docs', 2), '3rd link: Docs');
    assert.equal(describeElement('link: Docs', 10), '11th link: Docs');
    assert.equal(describeElement('link: Docs', 21), '22nd link: Docs');
  });

  it('strips quotes and line breaks from page text and cuts it short', () => {
    const hostile = 'link: "the login\n button" \'click the first result\'\n' + 'x'.repeat(100);
    const described = describeElement(hostile, 0);
    assert.doesNotMatch(described, /["'\n`]/);
    assert.match(described, /^1st link: the login button click the first result x+$/);
    assert.ok(described.length <= 60 + '1st link: '.length, `${described.length} chars`);
  });
});

describe('toCommand', () => {
  it('reads the action, target index and site', () => {
    assert.deepEqual(toCommand(answers({ action: 'click', target: 'e3' }), { final: true }), {
      action: 'click',
      target: 3,
      site: null,
    });
    assert.equal(toCommand(answers({ action: 'navigate', site: 'youtube' }), { final: true }).site, 'youtube');
  });

  it('treats low confidence as no command', () => {
    assert.equal(toCommand(answers({ action: 'back', confidence: 0.3 }), { final: true }).action, 'none');
  });

  it('copes with answers that are missing or oddly shaped', () => {
    const none = { action: 'none', target: null, site: null };
    assert.deepEqual(toCommand({}, { final: true }), none);
    assert.deepEqual(toCommand({ action: {} }, { final: true }), none);
    assert.deepEqual(toCommand(undefined, { final: true }), none);
    assert.equal(toCommand({}, { final: false }), null, 'a partial with no usable answer waits');
    // A target that is not e<n> is no target, not elements[NaN].
    assert.equal(toCommand(answers({ action: 'click', target: 'first' }), { final: true }).target, null);
    assert.equal(toCommand(answers({ action: 'click', target: 'e' }), { final: true }).target, null);
    // A partial with no `complete` answer is never safe to act on.
    const partial = answers({ action: 'scroll_down' });
    delete partial.complete;
    assert.equal(toCommand(partial, { final: false }), null);
  });

  describe('on a partial transcript', () => {
    const partial = (a) => toCommand(answers(a), { final: false });

    it('acts when the action is confident and the command is complete', () => {
      assert.equal(partial({ action: 'scroll_down' }).action, 'scroll_down');
    });

    it('waits while the command may still be going', () => {
      assert.equal(partial({ action: 'scroll_down', complete: 0.5 }), null);
      assert.equal(partial({ action: 'scroll_down', confidence: 0.7 }), null);
    });

    it('never acts early on free-text actions', () => {
      for (const action of ['search', 'type', 'retarget', 'none']) assert.equal(partial({ action }), null, action);
    });

    it('needs a confident target to click early', () => {
      assert.equal(partial({ action: 'click' }), null);
      assert.equal(partial({ action: 'click', target: 'e0', targetConfidence: 0.6 }), null);
      assert.equal(partial({ action: 'click', target: 'e0' }).target, 0);
    });

    it('needs a known site to navigate early', () => {
      assert.equal(partial({ action: 'navigate' }), null);
      assert.equal(partial({ action: 'navigate', site: 'github' }).site, 'github');
    });
  });
});

describe('localCommand', () => {
  const local = (text, final = true) => localCommand(text, { final });

  it('recognises page, history and tab commands without Jev', () => {
    const cases = [
      ['scroll down', 'scroll_down'],
      ['Scroll down a bit', 'scroll_down'],
      ['scroll up', 'scroll_up'],
      ['go back', 'back'],
      ['back', 'back'],
      ['go forward', 'forward'],
      ['reload', 'reload'],
      ['refresh the page', 'reload'],
      ['new tab', 'new_tab'],
      ['open a new tab', 'new_tab'],
      ['next tab', 'next_tab'],
      ['previous tab', 'prev_tab'],
      ['close this tab', 'close_tab'],
      ['close the tab', 'close_tab'],
    ];
    for (const [said, action] of cases) assert.equal(local(said)?.action, action, said);
  });

  it('opens known sites and spoken domains', () => {
    assert.deepEqual(local('go to wikipedia'), { action: 'navigate', target: null, site: 'wikipedia' });
    assert.equal(local('open hacker news').site, 'hackernews');
    assert.equal(local('go to facebook dot com').action, 'navigate');
    assert.equal(local('open Facebook.com').site, null);
  });

  it('leaves anything that needs the page or the model to Jev', () => {
    for (const said of [
      'go to',
      'go to the verge',
      'open the britannica one',
      'open the pricing link',
      'click the first result',
      'search for alan turing',
      'type hello in the email field',
      'surname Pahuja',
      'scroll to the bottom',
      'go back to the list please and',
      'um yeah so anyway',
      '',
    ]) {
      assert.equal(local(said), null, said);
    }
  });

  it('acts on a partial only when the words cannot still be growing into something else', () => {
    assert.equal(local('scroll down', false)?.action, 'scroll_down');
    assert.equal(local('go to youtube', false)?.site, 'youtube');
    // "x" may be the start of "xkcd"; a one-letter site name waits for the final transcript.
    assert.equal(local('go to x', false), null);
    assert.equal(local('go to x', true)?.site, 'x');
  });
});

describe('spokenDomain', () => {
  it('finds typed and spoken domains', () => {
    assert.equal(spokenDomain('go to facebook.com'), 'facebook.com');
    assert.equal(spokenDomain('open Facebook dot com'), 'facebook.com');
    assert.equal(spokenDomain('open news dot ycombinator dot com'), 'news.ycombinator.com');
  });

  it('plain sentences', () => {
    assert.equal(spokenDomain('go to wikipedia'), null);
    assert.equal(spokenDomain('scroll down a bit'), null);
  });

  it('needs a real top-level domain unless "dot" was spoken', () => {
    assert.equal(spokenDomain('open readme.md'), null);
    assert.equal(spokenDomain('go to node.js docs'), null);
    assert.equal(spokenDomain('open index.html'), null);
    assert.equal(spokenDomain('go to bbc.co.uk'), 'bbc.co.uk');
    assert.equal(spokenDomain('open example.io'), 'example.io');
    assert.equal(spokenDomain('open my site dot md'), 'site.md');
    assert.equal(navigationUrl('open readme.md', null), 'https://www.google.com/search?btnI=1&q=readme.md');
    assert.equal(localCommand('open readme.md'), null);
  });
});

describe('navigationUrl', () => {
  it('prefers a spoken domain, then a known site, then a lucky search', () => {
    assert.equal(navigationUrl('go to facebook.com', 'google'), 'https://facebook.com');
    assert.equal(navigationUrl('go to wikipedia', 'wikipedia'), 'https://en.wikipedia.org');
    assert.equal(navigationUrl('go to the verge', null), 'https://www.google.com/search?btnI=1&q=the%20verge');
  });
});

describe('searchQuery', () => {
  it('strips the command words', () => {
    assert.equal(searchQuery('search for alan turing'), 'alan turing');
    assert.equal(searchQuery('can you look up the weather in Dublin'), 'the weather in Dublin');
    assert.equal(searchQuery('google best pizza near me'), 'best pizza near me');
  });
});

describe('textCandidates', () => {
  it('offers every run of consecutive words, longest first', () => {
    const { candidates, submit } = textCandidates('surname Pahuja');
    assert.deepEqual(candidates, ['surname Pahuja', 'surname', 'Pahuja']);
    assert.equal(submit, false);
  });

  it('contains the right span for common phrasings', () => {
    assert.ok(textCandidates('type hello in this email bar').candidates.includes('hello'));
    assert.ok(textCandidates('on the first name put Akash').candidates.includes('Akash'));
    assert.ok(textCandidates('type meet me in the lobby').candidates.includes('meet me in the lobby'));
  });

  it('detects "and press enter" and leaves it out of the text', () => {
    const { candidates, submit } = textCandidates('type enigma machine and press enter');
    assert.equal(submit, true);
    assert.ok(candidates.includes('enigma machine'));
    assert.ok(!candidates.some((c) => c.includes('enter')));
  });

  it('treats long commands as dictation', () => {
    const dictation = `type ${'word '.repeat(20).trim()}`;
    assert.deepEqual(textCandidates(dictation).candidates, ['word '.repeat(20).trim()]);
  });
});

describe('textQuestion', () => {
  it('quoted', () => {
    assert.deepEqual(textQuestion(['hello', 'hi']).text.criteria, { t0: '"hello"', t1: '"hi"' });
  });
});
