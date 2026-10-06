// Helpers and vocabulary shared by the Lead Finder page and the audit PDF: one copy of each.
import { REGION } from './config.js';

// ---------------------------------------------------------------- the page

export const $ = (id) => document.getElementById(id);
// Text from the business list, a website or a person, made safe to put in HTML.
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
// Only http(s) addresses become links: a scraped listing can't smuggle in javascript: or data:.
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

// ---------------------------------------------------------------- text, numbers, dates

// "https://www.example.com/home" (or "example.com") → "example.com"
export const hostOf = (u) => {
  const s = String(u || '');
  try {
    return new URL(/^https?:/i.test(s) ? s : 'http://' + s).hostname.replace(/^www\./, '');
  } catch {
    return s;
  }
};
export const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const known = (v) => v !== null && v !== undefined && v !== '';
// The first number in a listing ("+1 818-555-0100; 818-555-0101") as (818) 555-0100.
export const usPhone = (v) => {
  const first = String(v || '').split(/[;,]/)[0].trim(), d = first.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : first;
};

export const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const today = () => iso(new Date());
// n working days from today (follow-ups skip weekends)
export const workdays = (n) => {
  const d = new Date();
  let k = 0;
  while (k < n) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() % 6) k++;
  }
  return iso(d);
};
// "2026-10-06" → "Tue, Oct 6"
export const nice = (s) => (s ? new Date(s.length > 10 ? s : s + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '');
// "2026-10-06" → "October 6, 2026" (today when empty, '' when it isn't a date)
export const longDate = (d) => {
  const t = new Date(String(d || today()).slice(0, 10) + 'T12:00:00Z');
  return isNaN(t) ? '' : t.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

// ---------------------------------------------------------------- a business

// The place names a business goes by: the city in its address and the area it was found in.
// "14530 Oak St, Van Nuys, CA 91411" found near North Hollywood → ['Van Nuys', 'North Hollywood']
export const placesOf = (p) => {
  const parts = String(p.address || '').split(',').map((x) => x.trim());
  const i = parts.findIndex((x) => new RegExp(`^${REGION.state}\\b`, 'i').test(x));
  return [...new Set([i > 0 ? parts[i - 1] : '', p.area || ''].filter((x) => x && !/^\d+$/.test(x)))];
};

// ---------------------------------------------------------------- what the website check found

// Page titles that say nothing about the business.
export const GENERIC_TITLE = /^(home|home page|homepage|welcome|index|untitled|my site|new site)$/i;

// A placeholder page, by the reason the checker gives (functions/lib/site-check.js).
//   signal: the line on the lead's card      shows: what we found, after "Your web address, x.com,"
//   title:  the audit's summary line         fix:   what to do about it
// {by} is the host or site builder behind it (placeholderWho).
export const PLACEHOLDER = {
  'coming soon': {
    signal: 'Website is just "coming soon"',
    shows: 'only shows a "coming soon" page, nothing about your business',
    title: 'Your website is just "coming soon"',
    fix: 'Replace it with even one simple page: your services, hours, phone and a book-or-call button.',
  },
  'default page': {
    signal: "Website is a host's default page",
    shows: "shows your web host's default page instead of a website",
    title: "Your web address shows a host's default page",
    fix: 'It points at a server with no site set up. Ask whoever manages your hosting to put your site back, or point the address at a new one.',
  },
  suspended: {
    signal: 'Website account is suspended',
    shows: 'shows an "account suspended" page from your web host, usually over an unpaid bill',
    title: 'Your website account is suspended',
    fix: "Call {by} about the account. It's usually an unpaid bill or an expired card, and the site comes back once that's sorted.",
  },
  expired: {
    signal: 'Website plan has expired',
    shows: 'shows a "website expired" page from your site builder or host',
    title: 'Your website plan has expired',
    fix: 'Renew the website plan with {by}, and the site comes back as it was.',
  },
  'not connected': {
    signal: "Web address isn't connected to a site",
    shows: "isn't connected to your website; your site builder shows a setup page instead",
    title: "Your web address isn't connected to a site",
    fix: 'Finish connecting it in {by} (look for "Connect domain"). It takes a few minutes, though the change can take up to a day to show.',
  },
  'host home': {
    signal: "Web address goes to the host's homepage",
    shows: "sends visitors to {by}'s homepage instead of your website",
    title: "Your web address goes to {by}'s homepage",
    fix: "In {by}'s domain settings, point the address at your website so it stops sending people away.",
  },
  unavailable: {
    signal: "Website says it's unavailable",
    shows: 'says the site is currently unavailable',
    title: 'Your website says it is unavailable',
    fix: "Check with whoever runs your website. If the site is gone, put up a simple page so customers know you're open.",
  },
  blank: {
    signal: 'Website is a blank page',
    shows: 'shows an empty page with nothing about your business',
    title: 'Your website is a blank page',
    fix: 'Ask whoever set up your site to fix it, or put up a simple page with your services, hours and phone.',
  },
};
export const placeholderOf = (s) => PLACEHOLDER[s.reason] || PLACEHOLDER.blank;
// Who is behind a placeholder page, for {by}.
export const placeholderWho = (s) => s.by || (/expired|not connected/.test(s.reason) ? 'your site builder' : 'your hosting company');
