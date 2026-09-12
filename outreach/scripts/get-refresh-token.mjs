#!/usr/bin/env node
// One-time helper: obtain a Gmail OAuth refresh token for the sequencer.
//
// Prereqs (Google Cloud console, ~10 minutes):
//   1. Create a project, enable the Gmail API.
//   2. OAuth consent screen → External → add your outreach address as a
//      test user (stays in "Testing"; no verification needed for yourself).
//   3. Credentials → Create credentials → OAuth client ID → Desktop app.
//
// Run:  node scripts/get-refresh-token.mjs <client_id> <client_secret>
// Sign in AS THE OUTREACH-DOMAIN ACCOUNT, then paste the printed refresh
// token into:  npx wrangler secret put GMAIL_REFRESH_TOKEN

import http from 'node:http';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('usage: node scripts/get-refresh-token.mjs <client_id> <client_secret>');
  process.exit(1);
}

const PORT = 8765;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });

console.log('\nOpen this URL in a browser and sign in as the OUTREACH account:\n');
console.log(authUrl + '\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('No code in request.');
    return;
  }
  res.end('Done — you can close this tab and return to the terminal.');
  server.close();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });
  const data = await tokenRes.json();
  if (!data.refresh_token) {
    console.error('\nNo refresh token returned:', data);
    process.exit(1);
  }
  console.log('\nRefresh token (store with `npx wrangler secret put GMAIL_REFRESH_TOKEN`):\n');
  console.log(data.refresh_token + '\n');
});

server.listen(PORT, () => console.log(`Waiting for the OAuth redirect on ${REDIRECT} ...`));
