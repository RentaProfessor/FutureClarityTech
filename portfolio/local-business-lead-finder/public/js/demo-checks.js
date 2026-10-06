// Demo mode's website checker. The answers in /data/demo-checks.json were made by running the real
// checker (functions/lib/site-check.js) over synthetic pages with the network mocked
// (scripts/build-demo-data.mjs), so they have exactly the shape and wording of live ones.
let canned = null;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function demoSites({ urls = [] } = {}) {
  canned ||= fetch('/data/demo-checks.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => {
      canned = null;
      return {};
    });
  // about as long as a real check of three sites takes, so the page behaves the same way
  const [all] = await Promise.all([canned, pause(300 + Math.random() * 500)]);
  return { results: urls.map((u) => all[u] || { url: u, kind: 'error', error: 'only the sample businesses have website checks in the demo' }) };
}
