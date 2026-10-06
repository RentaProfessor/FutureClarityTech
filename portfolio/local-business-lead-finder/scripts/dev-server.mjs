#!/usr/bin/env node
// Serves public/ (the demo) the way Cloudflare Pages will: clean URLs, directory indexes, and the
// response headers from public/_headers, including the Content-Security-Policy. No dependencies.
//
//   node scripts/dev-server.mjs [--port 8788] [--root public]
//
// It doesn't run functions/ (the live website checker needs `wrangler pages dev`); the demo
// doesn't call it.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.map': 'application/json',
};

// public/_headers: a path pattern at the start of a line, then indented "Name: value" lines.
// * matches anything (slashes too), :name one path segment.
export function parseHeaders(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const re = line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:\w+/g, '[^/]+');
      rules.push({ re: new RegExp(`^${re}$`), headers: [] });
    } else if (rules.length) {
      const i = line.indexOf(':');
      if (i > 0) rules[rules.length - 1].headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}
// Every rule that matches applies; a header set by two rules gets both values, comma-joined (as on Pages).
export function headersFor(rules, path) {
  const out = {};
  for (const { re, headers } of rules) {
    if (!re.test(path)) continue;
    for (const [k, v] of headers) out[k] = out[k] ? `${out[k]}, ${v}` : v;
  }
  return out;
}

async function fileAt(root, path) {
  const full = resolve(root, '.' + path);
  if (full !== root && !full.startsWith(root + sep)) return null; // no ../ out of the root
  try {
    const s = await stat(full);
    if (s.isFile()) return full;
    if (s.isDirectory()) return 'dir';
  } catch {
    // not there: try the clean URL below
  }
  try {
    if ((await stat(full + '.html')).isFile()) return full + '.html'; // /about → about.html
  } catch {
    // a real 404
  }
  return null;
}

export async function startServer({ root = 'public', port = 8788, host = '127.0.0.1' } = {}) {
  root = resolve(root);
  let rules = [];
  try {
    rules = parseHeaders(await readFile(join(root, '_headers'), 'utf8'));
  } catch {
    // no _headers: serve without them
  }
  const server = createServer(async (req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const headers = headersFor(rules, path);
    // upgrade-insecure-requests only makes sense over https; this serves plain http, so it's dropped
    // here to keep the demo working in any browser. Everything else is sent exactly as written.
    if (headers['Content-Security-Policy']) headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/;?\s*upgrade-insecure-requests/, '');
    let file = path.endsWith('/') ? await fileAt(root, path + 'index.html') : await fileAt(root, path);
    if (file === 'dir') {
      res.writeHead(308, { Location: path + '/' }).end();
      return;
    }
    if (!file || /(^|\/)_headers$/.test(path)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }).end(path.startsWith('/api/') ? 'The website checker only runs on Cloudflare (wrangler pages dev); the demo uses canned checks.\n' : 'Not found\n');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': body.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(port, host, ok));
  const { port: actual } = server.address();
  return { url: `http://${host}:${actual}`, close: () => new Promise((ok) => server.close(ok)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const { url } = await startServer({ root: arg('--root', 'public'), port: Number(arg('--port', process.env.PORT || 8788)) });
  console.log(`Lead Finder demo: ${url}/  (the app is at ${url}/app/)`);
}
