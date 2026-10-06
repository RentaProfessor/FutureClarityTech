// The Lead Finder's downloadable audit (dashboard/leads.html): a short PDF for one business
// with what we checked, what we found and what we'd set up, ready to email or print.
//
// It's built right here in the browser, with no library and no server: FCAudit.pdf(audits)
// returns the file's bytes. Each audit starts on a new page, so one file can hold a whole call
// list for printing. Text is set in Helvetica, one of the fonts every PDF viewer has built in,
// so nothing is embedded and a page is a few KB. Those fonts only cover Western European
// letters: anything else in a name is simplified (ō → o) or left out.
(() => {
  'use strict';

  // ================================================================ text
  // Glyph widths (1/1000 em) for WinAnsi codes 32–255, from Adobe's Helvetica AFM files.
  // Helvetica-Oblique has the same widths as regular.
  const WIDTHS = {
    R: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 500, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 0, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500],
    B: [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 556, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 0, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556],
  };
  // WinAnsi puts these at 0x80–0x9F, where Latin-1 has control codes.
  const ANSI = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
  // Look-alikes for letters the fonts don't have and Unicode can't simplify on its own.
  const SWAP = { 'Đ': 'D', 'đ': 'd', 'Ł': 'L', 'ł': 'l', 'ı': 'i', 'Λ': 'A', '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2212': '-', '\u2032': "'", '\u2033': '"', '\u2605': '*' };
  const code = ch => { const c = ch.codePointAt(0); return (c >= 32 && c < 127) || (c >= 0xa0 && c < 256 && c !== 0xad) ? c : ANSI[c] || 0; };

  // Text as the fonts can show it. NFKC turns styled letters (𝙿𝚘𝚠𝚎𝚛) into plain ones; accents
  // the fonts lack are dropped; other scripts, emoji and invisible characters are left out.
  function clean(s) {
    let out = '';
    for (const ch of String(s ?? '').normalize('NFKC')) {
      if (code(ch)) out += ch;
      else if (SWAP[ch]) out += SWAP[ch];
      else if (/\s/.test(ch)) out += ' ';
      else {
        const base = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
        if (base && base !== ch && [...base].every(code)) out += base;
      }
    }
    return out.replace(/ {2,}/g, ' ').trim();
  }
  // A business name, tidied after anything was left out ("Lida Beauty Salon سالن" → "Lida Beauty Salon").
  function cleanName(s) {
    const n = clean(s).replace(/\s+([,.;:)])/g, '$1').replace(/^[\s,;:·•\-–—|/]+|[\s,;:·•\-–—|/(]+$/g, '');
    return (n.match(/[A-Za-z0-9\u00c0-\u00ff]/g) || []).length >= 2 ? n : '';
  }

  const width = (s, font, size) => {
    const w = WIDTHS[font === 'B' ? 'B' : 'R'];
    let t = 0;
    for (const ch of s) t += w[(code(ch) || 63) - 32] || 0;
    return t * size / 1000;
  };
  // Greedy line breaking. A word longer than the whole line (a long web address) is split anywhere.
  function wrap(s, font, size, max) {
    const lines = [];
    for (const para of String(s ?? '').split('\n')) {
      let line = '';
      for (let word of clean(para).split(' ')) {
        if (!word) continue;
        const next = line ? line + ' ' + word : word;
        if (width(next, font, size) <= max) { line = next; continue; }
        if (line) lines.push(line);
        while (width(word, font, size) > max) {
          let i = word.length - 1;
          while (i > 1 && width(word.slice(0, i), font, size) > max) i--;
          lines.push(word.slice(0, i));
          word = word.slice(i);
        }
        line = word;
      }
      lines.push(line);
    }
    return lines;
  }

  // ================================================================ PDF
  const PAGE_W = 612, PAGE_H = 792; // US Letter, in points
  const num = n => String(Math.round(n * 100) / 100);
  const rgb = hex => [1, 3, 5].map(i => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
  // A string in the font's encoding, as a PDF literal: ( ) and \ are escaped.
  const lit = s => { let o = ''; for (const ch of s) { const c = code(ch) || 63; o += c === 40 || c === 41 || c === 92 ? '\\' + ch : String.fromCharCode(c); } return '(' + o + ')'; };
  // Document info and bookmarks take any language: UTF-16 with a byte-order mark.
  const utf16 = s => '<FEFF' + String(s).split('').map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>';
  const ascii = s => '(' + String(s).replace(/[^\x20-\x7e]/g, c => encodeURIComponent(c)).replace(/[\\()]/g, '\\$&') + ')';

  // Rounded corners and circles are Bézier curves; k places the control points.
  const K = 0.5523;
  function roundRect(x, y, w, h, r) {
    const k = r * K, n = a => a.map(num).join(' ');
    return [n([x + r, y]) + ' m', n([x + w - r, y]) + ' l', n([x + w - r + k, y, x + w, y + r - k, x + w, y + r]) + ' c',
      n([x + w, y + h - r]) + ' l', n([x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h]) + ' c',
      n([x + r, y + h]) + ' l', n([x + r - k, y + h, x, y + h - r + k, x, y + h - r]) + ' c',
      n([x, y + r]) + ' l', n([x, y + r - k, x + r - k, y, x + r, y]) + ' c h'].join(' ');
  }

  // Pages are drawn with the origin at the top left, like the screen; PDF counts up from the bottom.
  function Doc() {
    const pages = [];
    let page = null;
    const Y = v => num(PAGE_H - v);
    return {
      pages,
      addPage() { page = { ops: [], links: [] }; pages.push(page); return pages.length - 1; },
      onPage(i) { page = pages[i]; },
      raw(op) { page.ops.push(op); },
      // base = the baseline, from the top of the page
      text(x, base, s, { font = 'R', size = 10, color = INK, tc = 0 } = {}) {
        page.ops.push(`BT /F${font} ${num(size)} Tf ${rgb(color)} rg ${num(tc)} Tc 1 0 0 1 ${num(x)} ${Y(base)} Tm ${lit(s)} Tj ET`);
      },
      rect(x, top, w, h, { fill, stroke, lw = 1, r = 0 } = {}) {
        const y = PAGE_H - top - h;
        const path = r ? roundRect(x, y, w, h, r) : `${num(x)} ${num(y)} ${num(w)} ${num(h)} re`;
        page.ops.push(`${fill ? rgb(fill) + ' rg ' : ''}${stroke ? rgb(stroke) + ' RG ' + num(lw) + ' w ' : ''}${path} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
      },
      line(x1, y1, x2, y2, { color = LINE, lw = 0.75 } = {}) {
        page.ops.push(`${rgb(color)} RG ${num(lw)} w 0 J ${num(x1)} ${Y(y1)} m ${num(x2)} ${Y(y2)} l S`);
      },
      circle(cx, cy, r, color) {
        const x = cx, y = PAGE_H - cy, k = r * K, n = a => a.map(num).join(' ');
        page.ops.push(`${rgb(color)} rg ${n([x + r, y])} m ${n([x + r, y + k, x + k, y + r, x, y + r])} c ${n([x - k, y + r, x - r, y + k, x - r, y])} c ${n([x - r, y - k, x - k, y - r, x, y - r])} c ${n([x + k, y - r, x + r, y - k, x + r, y])} c f`);
      },
      link(x, top, w, h, uri) { page.links.push([x, PAGE_H - top - h, x + w, PAGE_H - top, uri]); },

      // The finished file. bookmarks: [{ title, page }] (shown in the viewer's sidebar).
      bytes({ title, author, bookmarks = [] }) {
        const objs = [];
        const add = s => { objs.push(s); return objs.length; };
        const ref = n => n + ' 0 R';
        const catalog = add(''), root = add('');
        const fonts = [['R', 'Helvetica'], ['B', 'Helvetica-Bold'], ['I', 'Helvetica-Oblique']]
          .map(([k, name]) => `/F${k} ${ref(add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`))}`);
        const shades = SHADES.map((s, i) => `/S${i + 1} ${ref(add(s))}`);
        const res = add(`<< /ProcSet [/PDF /Text] /Font << ${fonts.join(' ')} >> /Shading << ${shades.join(' ')} >> >>`);
        const kids = pages.map(p => {
          const data = p.ops.join('\n');
          const content = add(`<< /Length ${data.length} >>\nstream\n${data}\nendstream`);
          const annots = p.links.map(([x1, y1, x2, y2, uri]) =>
            add(`<< /Type /Annot /Subtype /Link /Rect [${[x1, y1, x2, y2].map(num).join(' ')}] /Border [0 0 0] /A << /S /URI /URI ${ascii(uri)} >> >>`));
          return add(`<< /Type /Page /Parent ${ref(root)} /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${ref(res)} /Contents ${ref(content)}${annots.length ? ` /Annots [${annots.map(ref).join(' ')}]` : ''} >>`);
        });
        objs[root - 1] = `<< /Type /Pages /Kids [${kids.map(ref).join(' ')}] /Count ${kids.length} >>`;
        let outline = '';
        if (bookmarks.length > 1) {
          const top = add(''), items = bookmarks.map(() => add(''));
          bookmarks.forEach((b, i) => {
            objs[items[i] - 1] = `<< /Title ${utf16(b.title)} /Parent ${ref(top)}${i ? ` /Prev ${ref(items[i - 1])}` : ''}${i < items.length - 1 ? ` /Next ${ref(items[i + 1])}` : ''} /Dest [${ref(kids[b.page])} /XYZ 0 ${PAGE_H} null] >>`;
          });
          objs[top - 1] = `<< /Type /Outlines /First ${ref(items[0])} /Last ${ref(items[items.length - 1])} /Count ${items.length} >>`;
          outline = ` /Outlines ${ref(top)} /PageMode /UseOutlines`;
        }
        objs[catalog - 1] = `<< /Type /Catalog /Pages ${ref(root)} /Lang (en-US) /ViewerPreferences << /DisplayDocTitle true >>${outline} >>`;
        const d = new Date(), p2 = n => String(n).padStart(2, '0');
        const stamp = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
        const info = add(`<< /Title ${utf16(title)} /Author ${utf16(author)} /Creator (FutureClarity Lead Finder) /Producer (FutureClarity Lead Finder) /CreationDate (${stamp}) /ModDate (${stamp}) >>`);
        const rand = new Uint8Array(16);
        (globalThis.crypto || { getRandomValues: a => a.forEach((_, i) => { a[i] = Math.random() * 256; }) }).getRandomValues(rand);
        const id = Array.from(rand, b => b.toString(16).padStart(2, '0')).join('');

        // Every character here is a single byte, so string length = file offset.
        let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
        const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
        const xref = out.length;
        out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
        out += `trailer\n<< /Size ${objs.length + 1} /Root ${ref(catalog)} /Info ${ref(info)} /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`;
        const bytes = new Uint8Array(out.length);
        for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
        return bytes;
      },
    };
  }

  // ================================================================ look
  const INK = '#14213d', MUTED = '#5b6275', LINE = '#d9dce5', SOFT = '#f4f5fa', ACCENT = '#3a3fc4';
  const OK = '#1d6b3a', WARN = '#b77900', BAD = '#b3261e', GRAY = '#8b91a3', OK_SOFT = '#e6f3ea';
  const STATUS = { pass: OK, fail: BAD, warn: WARN, unknown: GRAY, info: ACCENT };
  const M = 50, CW = PAGE_W - 2 * M, BOTTOM = PAGE_H - 58;
  const SITE = 'futureclaritytechnologies.com', PHONE = '(818) 939-7964';

  // The logo's gradients (src/components/SvgDefs.astro), in its SVG units. The beam fades to
  // transparent on the site; on white paper that's a fade to white.
  const stops = (a, mid, b, at) => `/Function << /FunctionType 3 /Domain [0 1] /Bounds [${at}] /Encode [0 1 0 1] /Functions [<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(a)}] /C1 [${rgb(mid)}] /N 1 >> << /FunctionType 2 /Domain [0 1] /C0 [${rgb(mid)}] /C1 [${rgb(b)}] /N 1 >>] >>`;
  const SHADES = [
    `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [274 0 326 0] /Extend [true true] ${stops('#07082a', '#3a3fc4', '#d8d3fb', 0.6)} >>`,
    `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [200 175 400 105] /Extend [true true] ${stops('#ffffff', '#7c83f0', '#ffffff', 0.5)} >>`,
  ];
  // w = the width of the whole mark (the beam spans it); it's 180/220 as tall.
  function logo(doc, x, top, w) {
    const s = w / 220;
    doc.raw(`q ${num(s)} 0 0 ${num(-s)} ${num(x - 190 * s)} ${num(PAGE_H - top + 50 * s)} cm`);
    doc.raw('q 300 58 m 334.67 112.67 334.67 167.33 300 222 c 265.33 167.33 265.33 112.67 300 58 c h W n /S1 sh Q');
    doc.raw('q 195 175 m 405 99 l 405 105 l 195 181 l h W n /S2 sh Q');
    doc.raw('Q');
  }
  function wordmark(doc, x, base, size) {
    const tc = size * 0.28;
    doc.text(x, base, 'FUTURE', { size, color: INK, tc });
    doc.text(x + width('FUTURE ', 'R', size) + tc * 7, base, 'CLARITY', { size, color: ACCENT, tc });
  }
  // A status mark: a colored disc with a white check, cross, "!" or "?".
  function mark(doc, cx, cy, status, r = 7) {
    const k = r / 7;
    doc.circle(cx, cy, r, STATUS[status]);
    const P = (dx, dy) => `${num(cx + dx * k)} ${num(PAGE_H - cy - dy * k)}`;
    const stroke = path => doc.raw(`1 1 1 RG ${num(1.6 * k)} w 1 J 1 j ${path} S`);
    if (status === 'pass') stroke(`${P(-3.2, 0.2)} m ${P(-0.9, 2.6)} l ${P(3.4, -2.6)} l`);
    else if (status === 'fail') stroke(`${P(-2.6, -2.6)} m ${P(2.6, 2.6)} l ${P(-2.6, 2.6)} m ${P(2.6, -2.6)} l`);
    else {
      const t = status === 'warn' ? '!' : status === 'info' ? 'i' : '?';
      doc.text(cx - width(t, 'B', 10 * k) / 2, cy + 3.6 * k, t, { font: 'B', size: 10 * k, color: '#ffffff' });
    }
  }
  // Wrapped text from a top edge. Returns the height used.
  function para(doc, x, top, text, { font = 'R', size = 10, color = INK, lead = size * 1.38, max = CW } = {}) {
    const lines = wrap(text, font, size, max);
    lines.forEach((l, i) => doc.text(x, top + size * 0.8 + i * lead, l, { font, size, color }));
    return lines.length * lead;
  }
  const paraH = (text, font, size, max, lead = size * 1.38) => wrap(text, font, size, max).length * lead;
  // A paragraph that opens with a bold lead-in: the first line is shorter by the lead-in's width.
  function leadLines(lead, text, size, max) {
    const words = clean(text).split(' '), room = max - width(lead + ' ', 'B', size);
    let firstLine = '';
    while (words.length && width(firstLine ? firstLine + ' ' + words[0] : words[0], 'R', size) <= room) firstLine = firstLine ? firstLine + ' ' + words.shift() : words.shift();
    return [firstLine, ...(words.length ? wrap(words.join(' '), 'R', size, max) : [])];
  }
  function heading(doc, top, text) {
    doc.text(M, top + 8, text.toUpperCase(), { font: 'B', size: 8.5, color: ACCENT, tc: 1.4 });
    return 18;
  }
  // Web addresses, emails and phone numbers in a line of text become tappable.
  function linkify(doc, x, base, line, size, font) {
    const re = /[\w.+-]+@[\w-]+(\.[\w-]+)+|(https?:\/\/)?([\w-]+\.)+(com|net|org|co|io|us|biz)\b(\/\S*)?|\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/gi;
    for (const m of line.matchAll(re)) {
      const t = m[0], at = x + width(line.slice(0, m.index), font, size);
      const uri = t.includes('@') ? 'mailto:' + t : /^[\d(]/.test(t) ? 'tel:+1' + t.replace(/\D/g, '').slice(-10) : (/^https?:/i.test(t) ? t : 'https://' + t);
      doc.link(at, base - size * 0.85, width(t, font, size), size * 1.15, uri);
    }
  }

  // ================================================================ what goes in it
  const money = n => '$' + Math.round(n).toLocaleString('en-US');
  const hostOf = u => { try { return new URL(/^https?:/i.test(u) ? u : 'http://' + u).hostname.replace(/^www\./, ''); } catch (e) { return String(u || ''); } };
  const known = v => v !== null && v !== undefined && v !== '';
  const either = list => list.length > 1 ? list.slice(0, -1).join(', ') + ' or ' + list[list.length - 1] : list[0] || '';
  const both = list => list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '';
  const BOOKING_PROFILE = /booksy|vagaro|styleseat|fresha|square|glossgenius|squire|thecut/i;
  const GENERIC_TITLE = /^(home|home page|homepage|welcome|index|untitled|my site|new site)$/i;
  // A page that holds a domain's place: [what it shows (after "Your web address, x.com,"), summary line].
  const PLACEHOLDER = {
    'coming soon': ['only shows a "coming soon" page, nothing about your business', 'Your website is just "coming soon"'],
    'default page': ["shows your web host's default page instead of a website", "Your web address shows a host's default page"],
    suspended: ['shows an "account suspended" page from your web host, usually over an unpaid bill', 'Your website account is suspended'],
    expired: ['shows a "website expired" page from your site builder or host', 'Your website plan has expired'],
    'not connected': ["isn't connected to your website; your site builder shows a setup page instead", "Your web address isn't connected to a site"],
    'host home': ["sends visitors to {by}'s homepage instead of your website", "Your web address goes to {by}'s homepage"],
    unavailable: ['says the site is currently unavailable', 'Your website says it is unavailable'],
    blank: ['shows an empty page with nothing about your business', 'Your website is a blank page'],
  };
  const SECTIONS = [['site', 'Your website'], ['find', 'Getting found on Google'], ['win', 'Turning visitors into customers']];

  // Every check: { section, label, status: pass | fail | warn | unknown | info, text, fine (its label
  // when it passes), and for problems a short line for the summary plus a weight to rank them }.
  // Rows only state what we actually saw: a missing phone or rating is left out, not called missing.
  function checks(a) {
    const V = a.vertical, biz = a.biz, s = a.site && a.site.kind ? a.site : null, out = [];
    const add = (section, label, status, text, extra) => out.push({ section, label, status, text, short: '', w: 0, fine: label, ...extra });
    const year = a.year || new Date().getFullYear();
    const host = a.website ? hostOf(a.website) : '', finalHost = s && s.finalUrl ? hostOf(s.finalUrl) : host;
    const areas = (a.areas || []).filter(Boolean), area = areas[0] || '';

    // ---- your website
    let checked = false, bookable = false;
    const profile = s && s.kind === 'profile' ? String(s.profile || 'profile page') : '';
    const profileName = profile.replace(/ \(.*/, '');
    const by = s && s.by ? ` from ${s.by}` : '';
    const site = (status, text, short, w) => add('site', 'Website', status, text, { short, w });
    if (!a.website) site('fail', `We couldn't find a website for ${biz}. People who look you up only see your map listing, and if nobody picks up, they call the next ${V.noun}.`, 'No website of your own', 25);
    else if (!s) site('unknown', "We couldn't check your website automatically this time.");
    else if (s.kind === 'profile' && /business\.site/.test(profile)) site('fail', 'Your listing still links to a Google business.site page. Google shut those down in 2024, so people who tap it never reach you.', 'Your website link is dead', 25);
    else if (s.kind === 'profile') {
      bookable = BOOKING_PROFILE.test(profile);
      if (bookable) site('warn', `Your listing links to your ${profileName}, not a website of your own. It takes bookings, but it's their page making your first impression, next to other businesses.`, 'No website of your own', 12);
      else site('fail', `Your listing links to your ${profileName}, not a website of your own. That's a good extra, but it can't show your services, prices and booking the way a site of your own can.`, 'No website of your own', 22);
    } else if (s.kind === 'unregistered') site('fail', `Your web address, ${host}, isn't registered to anyone right now. It doesn't load, and anyone could buy it and put up their own site.`, 'Your web address is up for grabs', 30);
    else if (s.kind === 'expired') site('fail', `Your web address, ${host}, has expired${s.domain && s.domain.ending ? ' and will soon be released for anyone to buy' : ''}, so visitors don't reach your site.`, 'Your web address has expired', 30);
    else if (s.kind === 'parked' && s.sale) site('fail', `Your web address, ${host}, shows a "for sale" page${by} instead of your business, so the domain may not be yours anymore.`, 'Your web address is for sale', 30);
    else if (s.kind === 'parked' || (s.kind === 'site' && s.parked)) site('fail', `Your web address, ${host}, shows a parking page${by} instead of your business. Either it was never connected to a website, or it lapsed and someone else holds it now.`, 'Your web address shows a parking page', 28);
    else if (s.kind === 'placeholder') {
      const [shows, short] = PLACEHOLDER[s.reason] || PLACEHOLDER.blank, who = s.by || 'your hosting company';
      site('fail', `Your web address, ${host}, ${shows.replace('{by}', who)}.`, short.replace('{by}', who), 25);
    } else if (s.kind === 'down') site('fail', `When we checked, your website didn't work: ${s.error || 'it returned an error'}. Customers who try it may think you've closed.`, "Your website doesn't load", 25);
    else if (s.kind !== 'site') site('unknown', s.kind === 'blocked' ? "Your website blocked our automated check, so we couldn't review it. Visitors usually aren't affected." : "We couldn't check your website automatically this time.");
    else if (s.notMine) site('fail', `The website on your listing, ${finalHost}, doesn't mention ${a.fullName || biz} anywhere. If it isn't yours anymore, your listing is sending customers to someone else.`, "Your listing's website doesn't mention you", 25);
    else {
      checked = true;
      if (s.thin) site('warn', "Your website loads, but there's very little on it, so visitors can't see your services, hours or prices.", 'Your website is nearly empty', 10);
      else add('site', 'Website', 'pass', `${s.movedTo && !s.freeHost ? `${host} forwards to ${s.movedTo}, which is` : `${finalHost} is`} up and running${s.builder ? ` (built with ${s.builder})` : ''}.`, { fine: 'Website works' });
      if (s.freeHost) add('site', 'Web address', 'warn', `Your site is on a free ${s.freeHost} address (${finalHost}) instead of a web address of your own, which looks less established and is harder to find on Google.`, { short: `Your site is on a free ${s.freeHost} address`, w: 6 });
    }
    if (checked) {
      if (s.mobile) add('site', 'Works on phones', 'pass', 'Your site is set up for phone screens.');
      else add('site', 'Works on phones', 'fail', `Your site isn't set up for phones, so it shows up tiny and hard to use on a small screen, where most people look up local ${V.plural}.`, { short: "Your website isn't built for phones", w: 12 });
      if (s.https) add('site', 'Secure (https)', 'pass', 'Browsers show your site as secure.');
      else add('site', 'Secure (https)', 'fail', 'Browsers mark your site "Not secure" because it doesn\'t use https, which makes some visitors leave.', { short: 'Browsers say your site is "Not secure"', w: 5 });
      if (s.ms > 5000) add('site', 'Speed', 'warn', `Your site took about ${Math.round(s.ms / 1000)} seconds to answer when we checked. Slow sites lose visitors, especially on phones.`, { short: 'Your website is slow', w: 5 });
      else if (s.ms) add('site', 'Speed', 'pass', 'Your site answered quickly when we checked.', { fine: 'Loads quickly' });
      if (s.year && s.year <= year - 3) add('site', 'Up to date', 'warn', `Your site's footer says © ${s.year}, so it can look out of date to new customers.`, { short: `Your website's footer says © ${s.year}`, w: 8 });
      else if (s.year) add('site', 'Up to date', 'pass', `Your site's footer shows a recent year (${s.year}).`);
    }

    // ---- getting found on Google
    if (a.phone) add('find', 'Map listing', 'pass', `You're listed on online maps with your phone number, ${a.phone}.`, { fine: 'On maps with your phone' });
    const g = checked && s.seo;
    if (g) {
      const t = String(s.title || '').trim();
      if (g.noindex) add('find', 'Visible to Google', 'fail', 'Your website tells Google not to list it (a "noindex" setting, often left on by mistake), so it won\'t show up in search at all.', { short: 'Your website is hidden from Google', w: 22 });
      else add('find', 'Visible to Google', 'pass', 'Google is allowed to list your site.');
      if (!t) add('find', 'Page title', 'fail', 'Your home page has no title, the headline Google shows for you in search results.', { short: 'No page title for Google', w: 8 });
      else if (GENERIC_TITLE.test(t) || t.toLowerCase() === host) add('find', 'Page title', 'warn', `Your page title is just "${t}", so Google has little to show when people search for a ${V.noun}${area ? ` in ${area}` : ' nearby'}.`, { short: 'Your page title is too generic', w: 7 });
      else if (t.length > 70) add('find', 'Page title', 'warn', `Your page title is ${t.length} characters long, so Google cuts it off in search results.`, { short: 'Your page title gets cut off', w: 3 });
      else add('find', 'Page title', 'pass', `Your page title: "${t}".`, { fine: 'Clear page title' });
      if (!g.desc) add('find', 'Description', 'warn', "There's no description for Google to show under your name, so it picks random text from the page.", { short: 'No description for Google', w: 6 });
      else if (g.desc < 50) add('find', 'Description', 'warn', `Your description for Google is only ${g.desc} characters. Around 150 tells searchers why to pick you.`, { short: 'Your Google description is too short', w: 3 });
      else add('find', 'Description', 'pass', 'Google has a description to show under your name.', { fine: 'Description for Google' });
      if (s.onPage && s.onPage.area === false && area) add('find', 'Your area', 'warn', `Your site doesn't mention ${either(areas)}, which helps Google show you to people searching nearby.`, { short: `Your site doesn't mention ${area}`, w: 6 });
      else if (s.onPage && s.onPage.area && area) add('find', 'Your area', 'pass', `Your site mentions ${area}.`, { fine: `Mentions ${area}` });
      if (s.onPage && s.onPage.phone === false && a.phone) add('find', 'Same phone', 'warn', `The phone number on your listing, ${a.phone}, isn't on your website. Google trusts a business more when its name, address and phone match everywhere.`, { short: "Your listing's phone isn't on your site", w: 5 });
      else if (s.onPage && s.onPage.phone && a.phone) add('find', 'Same phone', 'pass', 'Your website shows the same phone number as your listing.', { fine: 'Same phone as listing' });
      if (!g.schema) add('find', 'Business details', 'warn', "Your site doesn't give Google your business details in its own format (structured data), which helps it show your hours, location and reviews.", { short: 'No business details for Google', w: 3 });
      else add('find', 'Business details', 'pass', 'Your site gives Google your business details in its own format.', { fine: 'Business details for Google' });
    }
    if (known(a.reviews)) {
      const n = +a.reviews, r = known(a.rating) && n ? +a.rating : null;
      const rated = r !== null ? `, rated ${r.toFixed(1)}` : '';
      const rev = (status, text, short, w) => add('find', 'Google reviews', status, text, { short, w, fine: 'Strong Google reviews' });
      if (!n) rev('fail', `We couldn't find any Google reviews for ${biz}. Reviews are one of the first things people check before they call.`, 'No Google reviews yet', 15);
      else if (n < 25) rev('fail', `${n} Google review${n > 1 ? 's' : ''}${rated}. The ${V.plural} that show up first nearby usually have far more.`, `Only ${n} Google review${n > 1 ? 's' : ''}`, 14);
      else if (r !== null && r < 4.0) rev('warn', `${n} Google reviews${rated}. Asking every happy customer for a review is the fastest way to lift it.`, `Your Google rating is ${r.toFixed(1)}`, 10);
      else if (n < 80) rev('warn', `${n} Google reviews${rated}. A steady stream of new ones helps you show up higher in nearby searches.`, 'Room for more Google reviews', 7);
      else rev('pass', `${n} Google reviews${rated}. Keep them coming: recent reviews count the most.`);
    }

    // ---- turning visitors into customers
    const tools = (s && s.tools) || [], nobook = V.booking === false ? 10 : 18;
    const broken = !a.website || (s && (['profile', 'down', 'parked', 'placeholder', 'expired', 'unregistered'].includes(s.kind) || s.notMine || (s.kind === 'site' && s.parked)));
    const book = (status, text, extra) => add('win', 'Online booking', status, text, extra);
    if (checked && tools.length) book('pass', `Customers can book online through ${tools[0].name}.`);
    else if (checked && s.bookingWords) book('pass', 'Your site asks visitors to book or request an appointment.');
    else if (bookable) book('pass', `Customers can book online through your ${profileName}.`);
    else if (checked) book('fail', "We couldn't find a way to book or request an appointment on your site, so people who find you after hours can only call back later, and many won't.", { short: 'No way to book online', w: nobook });
    else if (broken) book('fail', "We couldn't find a way for customers to book with you online, so after hours the only option is to call back later.", { short: 'No way to book online', w: nobook });
    if (checked) {
      if (s.tel) add('win', 'Tap to call', 'pass', 'Your phone number is a tap-to-call button.');
      else add('win', 'Tap to call', 'warn', "Your phone number isn't a tap-to-call button, the quickest way for someone on a phone to reach you.", { short: 'No tap-to-call button', w: 4 });
      const x = s.extras || {};
      const spotted = [...tools.map(t => t.name), ...(x.analytics || []), ...(x.pay || []), ...(x.chat || []), ...(x.mail || [])].filter((v, i, l) => l.indexOf(v) === i).slice(0, 4);
      if (spotted.length) add('win', 'Software', 'info', `We spotted ${both(spotted)} on your site. Anything we set up works alongside ${spotted.length > 1 ? 'them' : 'it'}.`);
    }
    return out;
  }

  // What we'd set up: the three that matter most for this business, then more we could build.
  // A website comes first when the site is the problem; then getting found on Google, this kind
  // of business's main automation, the ones that fix what we found, and the rest, from what the
  // site is missing (payments, a quote form, a text button, visitor tracking, an app tune-up).
  // Workflow names match the Client Pipeline (dashboard/index.html).
  const NUDGE = {
    auto: 'Customers get a friendly text when their next service or smog check is due, so they come back to you.',
    groom: 'Regulars get a "time for Bella\'s next groom" text when they\'re due, so the book stays full.',
    detail: 'Past customers get a reminder when their next detail or coating maintenance is due.',
    dojo: 'Students who stop showing up get a friendly nudge to come back, before they cancel.',
    barber: 'Clients get a "time for your next cut?" text a few weeks after each visit.',
  };
  function plan(a, found) {
    const V = a.vertical, s = a.site && a.site.kind ? a.site : {}, x = s.extras || {};
    const area = (a.areas || [])[0] || '';
    const issue = label => found.find(c => c.short && c.label === label);
    const seo = found.filter(c => c.short && c.section === 'find' && c.label !== 'Google reviews');
    const TEXT = {
      'Get found on Google': [`Your page title, description and business details set up so Google shows you when people search for a ${V.noun}${area ? ` in ${area}` : ' nearby'}, with the same name and phone everywhere.`, `Show up when people nearby search for a ${V.noun}.`],
      'Missed-call text-back': [`When you can't pick up, the caller gets a text within seconds with a way to book, so they don't try the next ${V.noun}.`, 'Every missed caller gets a text back in seconds.'],
      'Online booking + reminders': ['Customers book any time, even after hours, and get a reminder the day before, which cuts no-shows.', 'Booking any time, with reminders that cut no-shows.'],
      'Review requests': ['After each visit, happy customers get a thank-you text with your Google review link. More reviews help you show up first nearby.', 'Happy customers get asked for a Google review.'],
      'Rebooking nudges': [NUDGE[V.k] || 'Customers get a friendly "time to come back?" text a few weeks after each visit.', 'A text when a customer is due to come back.'],
      'Estimates & quotes': ['Quote requests come in with the details you need, and every estimate gets a friendly follow-up, so fewer jobs walk.', 'Quote requests with automatic follow-ups.'],
      'App cleanup': ['You have an app: we can speed it up, fix the rough spots and connect it to your dashboard.', 'Speed up your app and connect it to your dashboard.'],
      'Website visitor tracking': ['See how many people visit your site, where they come from and what they tap, right on your dashboard. Nothing on your site tracks that today.', 'See who visits your site and what they tap.'],
      'Invoices & payment reminders': ["Send invoices by text, take payment online, and send polite reminders until they're paid.", 'Invoices by text, paid online, with reminders.'],
      'Text-us button on your site': ["Visitors can text you right from your website and you reply from your phone, so questions don't turn into lost jobs.", 'Visitors text you from your site; you reply from your phone.'],
      'Data entry / records': ['Customer and job details land in one place on their own instead of being typed in twice.', 'Customer and job details in one place, never typed twice.'],
    };
    const offers = new Map();
    const offer = (name, score, text = TEXT[name]) => { if (text && !(offers.has(name) && offers.get(name).score >= score)) offers.set(name, { name, score, long: text[0], short: text[1] }); };

    const bad = issue('Website') || issue('Works on phones') || issue('Web address');
    if (bad) {
      const k = s.kind;
      const long = ['expired', 'unregistered'].includes(k) || (k === 'parked' && s.sale) ? 'A fast site on a web address you own, with your services, hours, reviews and a book-or-call button. We\'ll check whether your old address can be recovered.'
        : k === 'parked' || s.parked ? 'A fast site with your services, hours, reviews and a book-or-call button, connected to your web address so it stops showing a parking page.'
        : s.notMine ? 'A site of your own, with your services, hours, reviews and a book-or-call button, and your listing pointed at it.'
        : bad.label === 'Web address' ? 'Your site moved to a web address of your own, which looks more established and helps you show up on Google.'
        : `One fast page with your services, hours, reviews and a book-or-call button, matched to your Google listing.${bad.label === 'Works on phones' ? ' We can rebuild it from the site you have now.' : ''}`;
      offer('A phone-first website', 100, [long, 'A fast site on your own web address, with booking and reviews.']);
    }
    if (issue('Visible to Google') || seo.length >= 2) offer('Get found on Google', bad ? 90 : 95);
    else if (seo.length) offer('Get found on Google', 45);
    offer(V.workflows[0], 85);
    if (issue('Google reviews') && V.workflows.includes('Review requests')) offer('Review requests', 78);
    if (issue('Online booking') && V.workflows.includes('Online booking + reminders')) offer('Online booking + reminders', 76);
    V.workflows.forEach((w, i) => offer(w, 62 - i * 3));
    offer('Missed-call text-back', 58);
    const realSite = s.kind === 'site' && !s.notMine && !s.parked;
    const statsBuiltIn = /Wix|Squarespace|GoDaddy|Weebly|Square|Shopify|Duda|Webflow/.test(s.builder || '') || !!s.freeHost;
    if (realSite && x.app) offer('App cleanup', 55);
    if (realSite && !x.analytics && !statsBuiltIn) offer('Website visitor tracking', 46);
    const jobs = ['auto', 'body', 'detail', 'custom'].includes(V.k);
    if (jobs && !x.pay) offer('Invoices & payment reminders', 44);
    if (jobs && !x.form) offer('Estimates & quotes', 40);
    if (realSite && !x.chat) offer('Text-us button on your site', 36);
    offer('Review requests', 32);
    offer('Rebooking nudges', 30);
    offer('Data entry / records', 20);
    if (found.some(c => c.label === 'Online booking' && c.status === 'pass')) offers.delete('Online booking + reminders');
    const ranked = [...offers.values()].sort((p, q) => q.score - p.score);
    return { top: ranked.slice(0, 3), more: ranked.slice(3, 7) };
  }

  // ================================================================ layout
  // Text cut to a width with an ellipsis.
  const fit = (s, font, size, max) => { if (width(s, font, size) <= max) return s; while (s && width(s + '…', font, size) > max) s = s.slice(0, -1); return s.trimEnd() + '…'; };

  // a = { name, btype, address, phone, website, rating, reviews, site, areas, vertical, from: [lines],
  //       date, checkedOn, year }
  function drawAudit(doc, input) {
    const V = input.vertical, title = cleanName(input.name) || 'Your business';
    // A long name reads badly mid-sentence, so sentences say "your shop" instead.
    const biz = cleanName(input.name) && title.length <= 38 ? title : /^(shop|studio|school)$/.test(V.noun) ? `your ${V.noun}` : 'your business';
    const a = { ...input, biz, fullName: cleanName(input.name) }, found = checks(a), { top: recs, more } = plan(a, found);
    const counted = found.filter(c => c.status !== 'info' && c.status !== 'unknown');
    const passed = counted.filter(c => c.status === 'pass').length;
    const issues = found.filter(c => c.short).sort((x, y) => y.w - x.w);
    const body = '#2a3350';
    const first = doc.addPage();
    let y = 0;

    const newPage = () => {
      doc.addPage();
      doc.text(M, 45, fit(`${title} · Online presence audit`, 'R', 8.5, CW - 50), { size: 8.5, color: MUTED });
      logo(doc, PAGE_W - M - 26, 30, 26);
      doc.line(M, 60, PAGE_W - M, 60);
      y = 80;
    };
    const need = h => { if (y + h > BOTTOM) newPage(); };

    // header: logo and wordmark, what this is and when
    logo(doc, M, 38, 32);
    wordmark(doc, M + 42, 55.3, 12);
    const kicker = 'ONLINE PRESENCE AUDIT';
    doc.text(PAGE_W - M - width(kicker, 'B', 8.5) - 1.4 * (kicker.length - 1), 48, kicker, { font: 'B', size: 8.5, color: ACCENT, tc: 1.4 });
    const when = `Prepared ${a.date}`;
    doc.text(PAGE_W - M - width(when, 'R', 9), 61, when, { size: 9, color: MUTED });
    doc.rect(M, 76, CW, 2, { fill: INK });
    y = 93;

    // who it's for
    y += para(doc, M, y, title, { font: 'B', size: 22, lead: 26 });
    const where = [a.btype || V.label, a.address].filter(Boolean).join(' · ');
    if (where) y += para(doc, M, y + 2, where, { size: 10, color: MUTED, lead: 14 });
    const reach = [a.phone, a.website ? hostOf(a.website) : ''].filter(Boolean).join(' · ');
    if (reach) y += para(doc, M, y + 2, reach, { size: 10, color: MUTED, lead: 14 });
    y += 14;

    // summary: how many checks passed, a bar with one block per check, the biggest openings
    // a score needs a few checks behind it; with almost nothing checkable, don't pretend
    const scored = counted.length >= 3, summary = scored ? GOOD : SPARSE;
    // several small Google gaps read better as one line here (each still gets its own row below)
    const gaps = issues.filter(c => c.section === 'find' && c.label !== 'Google reviews' && c.label !== 'Visible to Google');
    const ranked = gaps.length < 2 ? issues : [...issues.filter(c => !gaps.includes(c)),
      { short: `${gaps.length} things holding you back on Google`, w: 8 + gaps.length, status: gaps.some(c => c.status === 'fail') ? 'fail' : 'warn' }].sort((x, y) => y.w - x.w);
    const top3 = ranked.slice(0, 3), rightX = M + 176, rightW = PAGE_W - M - 16 - rightX;
    const listH = top3.length ? top3.reduce((t, c) => t + paraH(c.short, 'R', 10, rightW - 16, 14), 0) : paraH(summary, 'R', 10, rightW, 14);
    const boxH = Math.max(76, listH + 46);
    doc.rect(M, y, CW, boxH, { fill: SOFT, r: 8 });
    const by = y + boxH / 2;
    const [bigText, small] = scored ? [`${passed} of ${counted.length}`, 'checks passed'] : issues.length ? [String(issues.length), issues.length === 1 ? 'thing to fix' : 'things to fix'] : ['First look', 'the rest in person'];
    doc.text(M + 18, by - 6, bigText, { font: 'B', size: scored || issues.length ? 28 : 20, color: INK });
    doc.text(M + 18, by + 10, small, { size: 9.5, color: MUTED });
    if (scored) {
      const segW = Math.min(14, (138 - 2.5 * (counted.length - 1)) / counted.length);
      counted.forEach((c, i) => doc.rect(M + 18 + i * (segW + 2.5), by + 19, segW, 6, { fill: STATUS[c.status], r: 1.5 }));
    }
    doc.line(rightX - 16, y + 16, rightX - 16, y + boxH - 16, { color: LINE });
    doc.text(rightX, y + 25, top3.length ? 'Where you could win more customers' : scored ? 'In good shape' : 'What we could check', { font: 'B', size: 10.5, color: INK });
    let ly = y + 33;
    if (top3.length) {
      top3.forEach((c, i) => {
        doc.text(rightX, ly + 10, `${i + 1}`, { font: 'B', size: 10, color: STATUS[c.status] });
        ly += para(doc, rightX + 16, ly + 2, c.short, { size: 10, lead: 14, max: rightW - 16 });
      });
    } else para(doc, rightX, ly + 2, summary, { size: 10, lead: 14, max: rightW, color: body });
    y += boxH + 18;

    // the checks, section by section: problems in full, what's fine as a short list of ticks
    const TX = M + 136, TW = PAGE_W - M - TX, CHIP = CW / 3;
    const rowLines = c => wrap(c.text, 'R', 9.5, TW);
    const dated = `We checked on ${a.checkedOn || a.date}`;
    SECTIONS.forEach(([sec, name], si) => {
      const rows = found.filter(c => c.section === sec);
      if (!rows.length) return;
      const open = rows.filter(c => c.status !== 'pass'), fine = rows.filter(c => c.status === 'pass');
      const chipRows = Math.ceil(fine.length / 3);
      need(22 + (open.length ? rowLines(open[0]).length * 13 + 10 : chipRows * 16));
      heading(doc, y, name);
      if (!si) doc.text(PAGE_W - M - width(dated, 'R', 8.5), y + 8, dated, { size: 8.5, color: MUTED });
      y += 18;
      open.forEach((c, i) => {
        const lines = rowLines(c), h = lines.length * 13 + 10;
        need(h);
        if (i) doc.line(M, y, PAGE_W - M, y, { color: '#e6e8ef' });
        const base = y + 14.5;
        mark(doc, M + 7, base - 3.5, c.status);
        doc.text(M + 22, base, c.label, { font: 'B', size: 10, color: INK });
        lines.forEach((l, j) => doc.text(TX, base + j * 13, l, { size: 9.5, color: body }));
        y += h;
      });
      if (fine.length) {
        need(chipRows * 16 + 6);
        if (open.length) { doc.line(M, y, PAGE_W - M, y, { color: '#e6e8ef' }); y += 4; }
        fine.forEach((c, i) => {
          const x = M + (i % 3) * CHIP, cy = y + Math.floor(i / 3) * 16 + 9;
          mark(doc, x + 6, cy, 'pass', 5.5);
          doc.text(x + 16, cy + 3.4, fit(c.fine, 'R', 9.5, CHIP - 20), { size: 9.5, color: body });
        });
        y += chipRows * 16 + 2;
      }
      y += 12;
    });
    y += 4;

    // the plan, more we could build, the value and the next step stay together: on this page if
    // they fit, else the next
    const GAP = 18, colW = (CW - 2 * GAP) / 3, MW = (CW - GAP) / 2;
    const recTitle = r => wrap(r.name, 'B', 10.5, colW - 26);
    const recH = Math.max(...recs.map(r => Math.max(18, recTitle(r).length * 13) + 6 + paraH(r.long, 'R', 9.5, colW, 13)));
    const moreH = o => 12 + paraH(o.short, 'R', 9, MW - 10, 11.5) + 7;
    const moreRows = [];
    for (let i = 0; i < more.length; i += 2) moreRows.push(Math.max(moreH(more[i]), more[i + 1] ? moreH(more[i + 1]) : 0));
    const moreBlock = more.length ? 20 + moreRows.reduce((t, h) => t + h, 0) + 6 : 0;
    const value = V.ticket ? `A typical ${V.unit} runs about ${money(V.ticket)}. Catching just one extra customer a week who would otherwise have reached voicemail is about ${money(V.ticket * 4.33)} a month.` : '';
    const VALUE = 'What one missed call is worth:';
    const valueH = value ? leadLines(VALUE, value, 9.5, CW - 28).length * 13 + 18 : 0;
    const from = ((a.from || []).length ? a.from : ['FutureClarity Technologies', PHONE, SITE])
      .flatMap(l => String(l).split(/\s+·\s+|\s+\|\s+/)).map(clean).filter(Boolean);
    const fromW = 140, ctaW = CW - 28 - fromW - 24;
    const fromLines = from.flatMap((l, i) => wrap(l, i ? 'R' : 'B', i ? 9 : 10, fromW).map(t => [t, i]));
    const ctaText = `We'll come to ${biz}, see how your day runs, and show you a working demo before you pay anything. You get a fixed quote up front: most setups are a one-time build of $400 to $1,800, and monthly care is optional.`;
    const ctaH = Math.max(paraH(ctaText, 'R', 9.5, ctaW, 13) + 34, fromLines.length * 13 + 28);
    const note = `How we checked: on ${a.checkedOn || a.date} we ${a.website ? `opened ${hostOf(a.website)}${a.site && a.site.domain ? ', looked up who holds the domain,' : ''} and ` : ''}read your public map listings${known(a.reviews) ? ' and Google reviews' : ''}. Automated checks can miss things. If anything here is off, tell us and we'll correct it.`;
    const intro = 'Each one runs on its own, and you see all of it on one simple dashboard: calls caught, bookings, reviews and what they\'re worth.';
    const planH = 18 + paraH(intro, 'R', 9, CW, 12) + 8 + recH + 14 + moreBlock + (valueH ? valueH + 10 : 0) + ctaH + 9 + paraH(note, 'R', 8, CW, 10.5);
    need(planH);

    const setUp = `What we'd set up for ${biz}`;
    y += heading(doc, y, width(setUp.toUpperCase(), 'B', 8.5) + 1.4 * setUp.length < CW ? setUp : "What we'd set up");
    y += para(doc, M, y, intro, { size: 9, color: MUTED, lead: 12 }) + 8;
    recs.forEach((r, i) => {
      const x = M + i * (colW + GAP), t = recTitle(r);
      doc.rect(x, y, 18, 18, { fill: ACCENT, r: 4 });
      const n = String(i + 1);
      doc.text(x + 9 - width(n, 'B', 10) / 2, y + 12.6, n, { font: 'B', size: 10, color: '#ffffff' });
      t.forEach((l, j) => doc.text(x + 26, y + 12.8 + j * 13, l, { font: 'B', size: 10.5, color: INK }));
      para(doc, x, y + Math.max(18, t.length * 13) + 6, r.long, { size: 9.5, lead: 13, max: colW, color: body });
    });
    y += recH + 14;

    // other things we could build, from what the site is missing
    if (more.length) {
      doc.text(M, y + 9, 'More we could build for you', { font: 'B', size: 10.5, color: INK });
      y += 20;
      more.forEach((o, i) => {
        const x = M + (i % 2) * (MW + GAP), top = y + moreRows.slice(0, Math.floor(i / 2)).reduce((t, h) => t + h, 0);
        doc.circle(x + 3, top + 5.5, 2.3, ACCENT);
        doc.text(x + 10, top + 9, fit(o.name, 'B', 10, MW - 10), { font: 'B', size: 10, color: INK });
        para(doc, x + 10, top + 12.5, o.short, { size: 9, lead: 11.5, max: MW - 10, color: MUTED });
      });
      y += moreRows.reduce((t, h) => t + h, 0) + 6;
    }

    // what one missed customer is worth (the same estimate as the Lead Finder's)
    if (value) {
      doc.rect(M, y, CW, valueH, { fill: OK_SOFT, r: 8 });
      leadLines(VALUE, value, 9.5, CW - 28).forEach((l, i) => {
        if (!i) doc.text(M + 14, y + 17, VALUE, { font: 'B', size: 9.5, color: OK });
        doc.text(M + 14 + (i ? 0 : width(VALUE + ' ', 'B', 9.5)), y + 17 + i * 13, l, { size: 9.5, color: OK });
      });
      y += valueH + 10;
    }

    // next step, and who to call (the sign-off from "Your details", one item per line)
    doc.rect(M, y, CW, ctaH, { stroke: ACCENT, lw: 1.2, r: 8 });
    doc.text(M + 14, y + 21, 'Next step: a free in-person audit', { font: 'B', size: 12, color: INK });
    para(doc, M + 14, y + 27, ctaText, { size: 9.5, lead: 13, max: ctaW, color: body });
    const fx = PAGE_W - M - 14 - fromW;
    doc.line(fx - 12, y + 14, fx - 12, y + ctaH - 14, { color: LINE });
    fromLines.forEach(([l, i], j) => {
      const base = y + 22 + j * 13, font = i ? 'R' : 'B', size = i ? 9 : 10;
      doc.text(fx, base, l, { font, size, color: i ? MUTED : INK });
      linkify(doc, fx, base, l, size, font);
    });
    y += ctaH + 9;
    para(doc, M, y, note, { size: 8, color: MUTED, lead: 10.5 });

    // footers, now that we know how many pages this audit took
    const last = doc.pages.length - 1;
    for (let i = first; i <= last; i++) {
      doc.onPage(i);
      doc.line(M, PAGE_H - 40, PAGE_W - M, PAGE_H - 40);
      const lead = 'FutureClarity Technologies · ';
      doc.text(M, PAGE_H - 26, `${lead}${SITE} · ${PHONE}`, { size: 8, color: MUTED });
      doc.link(M + width(lead, 'R', 8), PAGE_H - 34, width(SITE, 'R', 8), 11, 'https://' + SITE);
      if (last > first) { const pg = `Page ${i - first + 1} of ${last - first + 1}`; doc.text(PAGE_W - M - width(pg, 'R', 8), PAGE_H - 26, pg, { size: 8, color: MUTED }); }
    }
    return { title: String(input.name || '').trim() || title, page: first };
  }
  const GOOD = 'Your online basics look solid. The next step is making sure every call and every customer gets followed up.';
  const SPARSE = "We couldn't check much automatically this time. A short visit fills in the rest.";

  // ================================================================ API
  globalThis.FCAudit = {
    // audits: one or more businesses (see drawAudit). Returns the PDF file's bytes.
    pdf(audits, { author = 'FutureClarity Technologies' } = {}) {
      const doc = Doc();
      const marks = audits.map(a => drawAudit(doc, a));
      return doc.bytes({ title: audits.length === 1 ? `${marks[0].title} · Online presence audit` : `Online presence audits (${audits.length} businesses)`, author, bookmarks: marks });
    },
    // A safe file name for one audit: "Valley Transmission - online audit.pdf".
    fileName(name) {
      const n = cleanName(name).replace(/[\\/:*?"<>|#%{}~]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
      return (n || 'Business') + ' - online audit.pdf';
    },
    checks: a => checks({ ...a, biz: cleanName(a.name) || 'your business' }),
    plan: a => { const x = { ...a, biz: cleanName(a.name) || 'your business' }; return plan(x, checks(x)); }, // { top, more }
    clean, cleanName, wrap, width,
  };
})();
