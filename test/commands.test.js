import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACTIONS,
  SITES,
  buildQuestions,
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
      e0: 'link: Pricing',
      e1: 'field: Email',
      none: 'No page element is referred to',
    });
    assert.deepEqual(Object.keys(q.site.criteria), [...Object.keys(SITES), 'other']);
    assert.equal(q.complete, undefined);
  });

  it('asks whether a partial transcript is complete', () => {
    assert.equal(buildQuestions({ elements: [], final: false }).complete.type, 'boolean');
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

describe('spokenDomain', () => {
  it('finds typed and spoken domains', () => {
    assert.equal(spokenDomain('go to facebook.com'), 'facebook.com');
    assert.equal(spokenDomain('open Facebook dot com'), 'facebook.com');
    assert.equal(spokenDomain('open news dot ycombinator dot com'), 'news.ycombinator.com');
  });

  it('ignores ordinary sentences', () => {
    assert.equal(spokenDomain('go to wikipedia'), null);
    assert.equal(spokenDomain('scroll down a bit'), null);
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
  it('quotes each candidate', () => {
    assert.deepEqual(textQuestion(['hello', 'hi']).text.criteria, { t0: '"hello"', t1: '"hi"' });
  });
});
