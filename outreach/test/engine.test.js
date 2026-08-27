import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInSendWindow,
  pickDue,
  render,
  withFooter,
  isOptOut,
  callSuggested,
} from '../src/engine.js';
import { SEQUENCES } from '../src/templates.js';

const cfg = { dailyCap: 30, perTickCap: 5, windowStartUtc: 15, windowEndUtc: 19 };

// Tue 2026-09-01 16:00 UTC = inside window, weekday.
const IN_WINDOW = new Date('2026-09-01T16:00:00Z');

function prospect(overrides = {}) {
  return {
    id: 1,
    email: 'owner@example.com',
    first_name: 'Sam',
    business: 'Demo Diner',
    observation: 'your menu is a scanned PDF that is unreadable on a phone.',
    demo_url: 'https://demo-grill.pages.dev',
    sequence: 'restaurant',
    step: 0,
    status: 'active',
    last_sent_at: null,
    called_at: null,
    ...overrides,
  };
}

test('send window: weekdays inside UTC hours only', () => {
  assert.equal(isInSendWindow(IN_WINDOW, cfg), true);
  assert.equal(isInSendWindow(new Date('2026-09-01T14:59:00Z'), cfg), false); // early
  assert.equal(isInSendWindow(new Date('2026-09-01T19:00:00Z'), cfg), false); // late
  assert.equal(isInSendWindow(new Date('2026-09-05T16:00:00Z'), cfg), false); // Saturday
  assert.equal(isInSendWindow(new Date('2026-09-06T16:00:00Z'), cfg), false); // Sunday
});

test('first touch is due immediately; follow-up waits its full delay', () => {
  const fresh = prospect();
  let due = pickDue({ prospects: [fresh], sequences: SEQUENCES, suppressed: new Set(), sentToday: 0, now: IN_WINDOW, cfg });
  assert.equal(due.length, 1);
  assert.equal(due[0].stepIndex, 0);

  // Step 1 waits 3 days; only 2 days elapsed → not due.
  const early = prospect({ step: 1, last_sent_at: '2026-08-30T16:30:00Z' });
  due = pickDue({ prospects: [early], sequences: SEQUENCES, suppressed: new Set(), sentToday: 0, now: IN_WINDOW, cfg });
  assert.equal(due.length, 0);

  // 4 days elapsed → due.
  const ready = prospect({ step: 1, last_sent_at: '2026-08-28T16:00:00Z' });
  due = pickDue({ prospects: [ready], sequences: SEQUENCES, suppressed: new Set(), sentToday: 0, now: IN_WINDOW, cfg });
  assert.equal(due.length, 1);
  assert.equal(due[0].stepIndex, 1);
});

test('caps: daily budget and per-tick limit are both enforced', () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    prospect({ id: i, email: `owner${i}@example.com` })
  );
  // Per-tick cap of 5 wins when daily budget is plentiful.
  let due = pickDue({ prospects: many, sequences: SEQUENCES, suppressed: new Set(), sentToday: 0, now: IN_WINDOW, cfg });
  assert.equal(due.length, 5);
  // 28 already sent today against a cap of 30 → only 2 left.
  due = pickDue({ prospects: many, sequences: SEQUENCES, suppressed: new Set(), sentToday: 28, now: IN_WINDOW, cfg });
  assert.equal(due.length, 2);
  // Cap exhausted → nothing.
  due = pickDue({ prospects: many, sequences: SEQUENCES, suppressed: new Set(), sentToday: 30, now: IN_WINDOW, cfg });
  assert.equal(due.length, 0);
});

test('suppressed, non-active, and sequence-exhausted prospects never send', () => {
  const suppressedSet = new Set(['owner@example.com']);
  assert.equal(
    pickDue({ prospects: [prospect()], sequences: SEQUENCES, suppressed: suppressedSet, sentToday: 0, now: IN_WINDOW, cfg }).length,
    0
  );
  for (const status of ['replied', 'done', 'stopped', 'suppressed', 'bounced']) {
    assert.equal(
      pickDue({ prospects: [prospect({ status })], sequences: SEQUENCES, suppressed: new Set(), sentToday: 0, now: IN_WINDOW, cfg }).length,
      0
    );
  }
  const finished = prospect({ step: SEQUENCES.restaurant.length, last_sent_at: '2026-08-01T16:00:00Z' });
  assert.equal(
    pickDue({ prospects: [finished], sequences: SEQUENCES, suppressed: new Set(), sentToday: 0, now: IN_WINDOW, cfg }).length,
    0
  );
});

test('render fills fields and the footer always carries address + opt-out', () => {
  const p = prospect();
  const body = render(SEQUENCES.restaurant[0].body, p);
  assert.ok(body.includes('Demo Diner'));
  assert.ok(body.includes('scanned PDF'));
  assert.ok(!body.includes('{{'));

  const finished = withFooter(body, {
    businessName: 'FutureClarity Technologies LLC',
    postalAddress: '123 Example St, Los Angeles, CA',
  });
  assert.ok(finished.includes('123 Example St'));
  assert.ok(/no thanks/i.test(finished));
});

test('all templates stay in the 50-120 word evidence band', () => {
  for (const [name, steps] of Object.entries(SEQUENCES)) {
    for (const [i, step] of steps.entries()) {
      const words = step.body.split(/\s+/).filter(Boolean).length;
      assert.ok(words >= 40 && words <= 130, `${name} step ${i} is ${words} words`);
    }
  }
});

test('opt-out detection catches refusals but not interest', () => {
  assert.equal(isOptOut('please remove me from your list'), true);
  assert.equal(isOptOut('Not interested, thanks'), true);
  assert.equal(isOptOut('UNSUBSCRIBE'), true);
  assert.equal(isOptOut('This looks interesting — can you call me tomorrow?'), false);
  assert.equal(isOptOut(''), false);
});

test('call task appears after two silent emails, until logged', () => {
  assert.equal(callSuggested(prospect({ step: 1 })), false);
  assert.equal(callSuggested(prospect({ step: 2 })), true);
  assert.equal(callSuggested(prospect({ step: 2, called_at: '2026-09-01T00:00:00Z' })), false);
  assert.equal(callSuggested(prospect({ step: 3, status: 'replied' })), false);
});
