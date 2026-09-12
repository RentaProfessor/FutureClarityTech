// Pure sequencing logic — no I/O, so every rule here is unit-testable.
//
// The rules encode the studio's playbook: small daily caps, a weekday send
// window, follow-ups spaced in days, hard stops on reply/opt-out/bounce.

/** Words in a reply that must permanently suppress the address. */
export const OPT_OUT_RE =
  /\b(unsubscribe|opt[ -]?out|stop (emailing|contacting)|remove me|not interested|no thanks|do not (email|contact))\b/i;

export function isOptOut(text) {
  return OPT_OUT_RE.test(text || '');
}

/**
 * True when `now` falls inside the send window: weekdays, between
 * cfg.windowStartUtc (inclusive) and cfg.windowEndUtc (exclusive), UTC hours.
 */
export function isInSendWindow(now, cfg) {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = now.getUTCHours();
  return hour >= cfg.windowStartUtc && hour < cfg.windowEndUtc;
}

/**
 * Pick which prospects get an email this tick.
 *
 * prospects: rows with {id, email, status, step, last_sent_at, sequence}
 * sequences: {name: [{subject, body, waitDays}, ...]}
 * suppressed: Set of lowercased emails
 * sentToday: sends already made today (for the daily cap)
 * cfg: {dailyCap, perTickCap, windowStartUtc, windowEndUtc}
 */
export function pickDue({ prospects, sequences, suppressed, sentToday, now, cfg }) {
  if (!isInSendWindow(now, cfg)) return [];
  let budget = Math.min(cfg.dailyCap - sentToday, cfg.perTickCap);
  if (budget <= 0) return [];

  const due = [];
  for (const p of prospects) {
    if (budget <= 0) break;
    if (p.status !== 'active') continue;
    if (suppressed.has(p.email.toLowerCase())) continue;
    const steps = sequences[p.sequence];
    if (!steps || p.step >= steps.length) continue;
    const step = steps[p.step];
    if (p.step > 0) {
      const last = new Date(p.last_sent_at).getTime();
      const waitMs = step.waitDays * 24 * 60 * 60 * 1000;
      if (now.getTime() - last < waitMs) continue;
    }
    due.push({ prospect: p, step, stepIndex: p.step });
    budget -= 1;
  }
  return due;
}

/** Fill {{field}} placeholders from the prospect row. Unknown fields become ''. */
export function render(template, prospect) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = prospect[key];
    return v == null ? '' : String(v);
  });
}

/**
 * CAN-SPAM footer: a real postal address and a working opt-out are legally
 * required on commercial email. Appended to every send, no way to skip it.
 */
export function withFooter(body, { businessName, postalAddress }) {
  return (
    body.trimEnd() +
    `\n\n—\n${businessName} · ${postalAddress}\n` +
    `If you'd rather not hear from me, reply "no thanks" and I won't email again.`
  );
}

/** After this many emails with no reply, surface a "call them" task instead. */
export const CALL_AFTER_STEP = 2;

export function callSuggested(prospect) {
  return (
    prospect.status === 'active' &&
    prospect.step >= CALL_AFTER_STEP &&
    !prospect.called_at
  );
}
