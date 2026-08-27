// Thin Gmail API client. Auth is a long-lived OAuth refresh token exchanged
// for a short-lived access token on each tick (scripts/get-refresh-token.mjs
// produces the refresh token).

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function getAccessToken(env) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function base64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// RFC 2047 so names/subjects with non-ASCII survive.
function encodeHeader(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(text)))}?=`;
}

/**
 * Send a plaintext email (deliberately no HTML, no tracking pixel — pixels
 * add ~15% spam-folder likelihood per Lemlist's data, and plaintext is what
 * a real person writing one email would send).
 * Pass threadId to keep follow-ups in the same Gmail thread.
 */
export async function sendEmail(token, { fromName, fromEmail, to, subject, body, threadId }) {
  const mime = [
    `From: ${encodeHeader(fromName)} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');

  const payload = { raw: base64Url(mime) };
  if (threadId) payload.threadId = threadId;

  const res = await fetch(`${API}/messages/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`send failed: ${res.status} ${await res.text()}`);
  return res.json(); // { id, threadId, ... }
}

/**
 * Inspect a thread we started. Returns:
 *   { replied, bounced, replyText } — replied when any message is from
 *   someone other than us; bounced when mailer-daemon shows up.
 */
export async function checkThread(token, threadId, ourEmail) {
  const res = await fetch(
    `${API}/threads/${threadId}?format=metadata&metadataHeaders=From`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`thread fetch failed: ${res.status} ${await res.text()}`);
  const thread = await res.json();

  let replied = false;
  let bounced = false;
  let replyText = '';
  for (const msg of thread.messages || []) {
    const from = (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === 'from')?.value || '';
    const lower = from.toLowerCase();
    if (lower.includes('mailer-daemon') || lower.includes('postmaster')) {
      bounced = true;
    } else if (!lower.includes(ourEmail.toLowerCase())) {
      replied = true;
      replyText += ' ' + (msg.snippet || '');
    }
  }
  return { replied, bounced, replyText: replyText.trim() };
}
