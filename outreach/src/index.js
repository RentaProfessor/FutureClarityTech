// Outreach sequencer — Cloudflare Worker.
//
// Cron (every 30 min): check threads of active prospects for replies/bounces,
// then send whatever pickDue() allows. HTTP API (Bearer-auth) manages the
// pipeline. See README.md for setup and the compliance rules this enforces.

import {
  pickDue,
  render,
  withFooter,
  isOptOut,
  callSuggested,
} from './engine.js';
import { SEQUENCES } from './templates.js';
import { getAccessToken, sendEmail, checkThread } from './gmail.js';

function cfg(env) {
  return {
    dailyCap: Number(env.SEND_CAP_PER_DAY ?? 30),
    perTickCap: Number(env.SEND_CAP_PER_TICK ?? 5),
    windowStartUtc: Number(env.SEND_WINDOW_UTC_START ?? 15), // 8am PT
    windowEndUtc: Number(env.SEND_WINDOW_UTC_END ?? 19), // noon PT
  };
}

async function loadSuppressed(db) {
  const { results } = await db.prepare('SELECT email FROM suppressed').all();
  return new Set(results.map((r) => r.email.toLowerCase()));
}

async function suppress(db, email, reason) {
  await db
    .prepare('INSERT OR IGNORE INTO suppressed (email, reason, created_at) VALUES (?, ?, ?)')
    .bind(email.toLowerCase(), reason, new Date().toISOString())
    .run();
}

// --- cron ---------------------------------------------------------------

async function syncReplies(env, token) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM prospects WHERE status = 'active' AND thread_id IS NOT NULL ORDER BY last_sent_at ASC LIMIT 25"
  ).all();

  for (const p of results) {
    try {
      const { replied, bounced, replyText } = await checkThread(token, p.thread_id, env.FROM_EMAIL);
      if (bounced) {
        await env.DB.prepare("UPDATE prospects SET status = 'bounced' WHERE id = ?").bind(p.id).run();
        await suppress(env.DB, p.email, 'bounce');
      } else if (replied) {
        const optOut = isOptOut(replyText);
        await env.DB.prepare('UPDATE prospects SET status = ? WHERE id = ?')
          .bind(optOut ? 'suppressed' : 'replied', p.id)
          .run();
        if (optOut) await suppress(env.DB, p.email, 'opt-out reply');
      }
    } catch (err) {
      console.error(`thread check failed for prospect ${p.id}:`, err.message);
    }
  }
}

async function sendDue(env, token, now) {
  const c = cfg(env);
  const { results: prospects } = await env.DB.prepare(
    "SELECT * FROM prospects WHERE status = 'active' ORDER BY created_at ASC"
  ).all();
  const suppressed = await loadSuppressed(env.DB);
  const today = now.toISOString().slice(0, 10);
  const sentToday =
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM sends WHERE substr(sent_at, 1, 10) = ?')
        .bind(today)
        .all()
    ).results[0]?.n ?? 0;

  const due = pickDue({ prospects, sequences: SEQUENCES, suppressed, sentToday, now, cfg: c });

  for (const { prospect, step, stepIndex } of due) {
    const fields = { ...prospect, sender_name: env.SENDER_FIRST_NAME };
    const body = withFooter(render(step.body, fields), {
      businessName: 'FutureClarity Technologies LLC',
      postalAddress: env.POSTAL_ADDRESS,
    });
    const subject = render(step.subject, fields);
    // Refuse to send anything still carrying setup placeholders.
    if (/REPLACE_WITH/.test(body + subject + env.FROM_EMAIL)) {
      console.error('send blocked: unconfigured REPLACE_WITH placeholder present');
      break;
    }
    try {
      const sent = await sendEmail(token, {
        fromName: env.FROM_NAME,
        fromEmail: env.FROM_EMAIL,
        to: prospect.email,
        subject,
        body,
        threadId: stepIndex > 0 ? prospect.thread_id : undefined,
      });
      await env.DB.prepare(
        'UPDATE prospects SET step = ?, last_sent_at = ?, thread_id = ? WHERE id = ?'
      )
        .bind(stepIndex + 1, now.toISOString(), sent.threadId, prospect.id)
        .run();
      await env.DB.prepare(
        'INSERT INTO sends (prospect_id, step, sent_at, gmail_id) VALUES (?, ?, ?, ?)'
      )
        .bind(prospect.id, stepIndex, now.toISOString(), sent.id)
        .run();
      // Sequence exhausted with no reply → mark done (a future manual batch
      // can re-enroll; automated re-enrollment is deliberately not a feature).
      if (stepIndex + 1 >= SEQUENCES[prospect.sequence].length) {
        await env.DB.prepare("UPDATE prospects SET status = 'done' WHERE id = ?")
          .bind(prospect.id)
          .run();
      }
    } catch (err) {
      console.error(`send failed for prospect ${prospect.id}:`, err.message);
    }
  }
  return due.length;
}

// --- HTTP API -----------------------------------------------------------

function unauthorized() {
  return Response.json({ error: 'missing or invalid Authorization: Bearer token' }, { status: 401 });
}

async function handleApi(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${env.API_TOKEN}`) return unauthorized();

  const url = new URL(request.url);
  const { pathname } = url;
  const now = new Date();

  // POST /prospects  — body: [{email, first_name, business, observation, demo_url, sequence}]
  if (request.method === 'POST' && pathname === '/prospects') {
    const rows = await request.json();
    if (!Array.isArray(rows)) return Response.json({ error: 'expected a JSON array' }, { status: 400 });
    const suppressed = await loadSuppressed(env.DB);
    let added = 0;
    const skipped = [];
    for (const r of rows) {
      if (!r.email || !r.sequence || !SEQUENCES[r.sequence]) {
        skipped.push({ email: r.email, reason: 'missing email or unknown sequence' });
        continue;
      }
      if (!r.observation) {
        skipped.push({ email: r.email, reason: 'observation is required — no generic sends' });
        continue;
      }
      if (suppressed.has(r.email.toLowerCase())) {
        skipped.push({ email: r.email, reason: 'suppressed' });
        continue;
      }
      const dup = await env.DB.prepare('SELECT id FROM prospects WHERE email = ?')
        .bind(r.email.toLowerCase())
        .first();
      if (dup) {
        skipped.push({ email: r.email, reason: 'already in pipeline' });
        continue;
      }
      await env.DB.prepare(
        `INSERT INTO prospects (email, first_name, business, observation, demo_url, sequence, step, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?)`
      )
        .bind(
          r.email.toLowerCase(),
          r.first_name ?? '',
          r.business ?? '',
          r.observation,
          r.demo_url ?? '',
          r.sequence,
          now.toISOString()
        )
        .run();
      added += 1;
    }
    return Response.json({ added, skipped });
  }

  // GET /pipeline — status counts, reply rate, and suggested call tasks
  if (request.method === 'GET' && pathname === '/pipeline') {
    const { results: prospects } = await env.DB.prepare('SELECT * FROM prospects').all();
    const byStatus = {};
    for (const p of prospects) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    const contacted = prospects.filter((p) => p.step > 0).length;
    const replied = prospects.filter((p) => p.status === 'replied').length;
    return Response.json({
      byStatus,
      contacted,
      replied,
      replyRate: contacted ? +((replied / contacted) * 100).toFixed(1) : null,
      benchmark: 'healthy: 3-8% replies; <3% → tighten list + personalization before raising volume',
      callSuggested: prospects.filter(callSuggested).map((p) => ({
        id: p.id,
        business: p.business,
        email: p.email,
        emailsSent: p.step,
      })),
    });
  }

  // POST /prospects/:id/stop | /prospects/:id/called
  const m = pathname.match(/^\/prospects\/(\d+)\/(stop|called)$/);
  if (request.method === 'POST' && m) {
    const [, id, action] = m;
    if (action === 'stop') {
      await env.DB.prepare("UPDATE prospects SET status = 'stopped' WHERE id = ?").bind(id).run();
    } else {
      await env.DB.prepare('UPDATE prospects SET called_at = ? WHERE id = ?')
        .bind(now.toISOString(), id)
        .run();
    }
    return Response.json({ ok: true });
  }

  // POST /suppress — body: {email, reason?}
  if (request.method === 'POST' && pathname === '/suppress') {
    const { email, reason } = await request.json();
    if (!email) return Response.json({ error: 'email required' }, { status: 400 });
    await suppress(env.DB, email, reason ?? 'manual');
    await env.DB.prepare("UPDATE prospects SET status = 'suppressed' WHERE email = ?")
      .bind(email.toLowerCase())
      .run();
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'not found' }, { status: 404 });
}

export default {
  async fetch(request, env) {
    return handleApi(request, env);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const token = await getAccessToken(env);
        await syncReplies(env, token);
        const sent = await sendDue(env, token, new Date());
        if (sent) console.log(`tick: sent ${sent} email(s)`);
      })()
    );
  },
};
