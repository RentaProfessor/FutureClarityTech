// FutureClarity: email the team when the website's quote form gets a new request.
//
// This runs as a Google Apps Script web app in brett@futureclaritytechnologies.com's
// account (script.google.com, project "FutureClarity lead alerts"), so alerts come from
// our own Google Workspace and cost nothing. The site's Cloudflare function
// (functions/api/lead.js) calls it after a request is saved.
//
// To change it: edit this file, paste it into the Apps Script project, then
// Deploy > Manage deployments > edit > Version: New version. The web app URL stays the same.
// The URL lives only in Cloudflare (Pages > Settings > Variables and secrets: LEAD_ALERT_URL),
// never in this public repo, because anyone holding it could send us alerts.

const TO = 'brett@futureclaritytechnologies.com';
const DASHBOARD = 'https://futureclaritytechnologies.com/dashboard/';
const MAX_PER_HOUR = 20; // a flood of form spam can't flood the inbox

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // One line, no control characters, capped: the text comes from a website visitor.
    const line = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
    const name = line(d.name, 200);
    const business = line(d.business, 200);
    const contact = line(d.contact, 200);
    if (!name || !business || !contact) return reply('missing');

    const cache = CacheService.getScriptCache();
    const hour = 'sent-' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH');
    const sent = Number(cache.get(hour) || 0);
    if (sent >= MAX_PER_HOUR) return reply('limit');
    cache.put(hour, String(sent + 1), 3600);

    const needs = String(d.needs || '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, 3000);
    const when = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'EEE, MMM d, h:mm a');
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    const body = [
      'New quote request from the website (' + when + ' Pacific).',
      '',
      'Name: ' + name,
      'Business: ' + business,
      (isEmail ? 'Email: ' : 'Phone: ') + contact,
      needs ? '\n' + needs : '',
      '',
      'Open the dashboard: ' + DASHBOARD,
      '',
      'This was typed by a website visitor, so check it before trusting any links in it.',
    ].join('\n');

    const options = { name: 'FutureClarity website' };
    if (isEmail) options.replyTo = contact;
    MailApp.sendEmail(TO, 'New quote request: ' + business, body, options);
    return reply('sent');
  } catch (err) {
    console.error(err);
    return reply('error');
  }
}

function reply(text) {
  return ContentService.createTextOutput(text);
}

// Run this once from the editor to grant the email permission and get a sample alert.
function sendTestAlert() {
  doPost({ postData: { contents: JSON.stringify({
    name: 'Test person', business: 'TEST alert - ignore', contact: 'test@example.com',
    needs: 'Interested in: A new website\nThis is a test of the lead alert.',
  }) } });
}
