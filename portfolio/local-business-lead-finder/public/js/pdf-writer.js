// A small PDF writer with no dependencies, enough for the audit (audit.js): pages of text, lines,
// rectangles with rounded corners, circles, gradient fills, web links and bookmarks.
//
// Text is set in Helvetica, one of the fonts every PDF viewer has built in, so nothing is embedded
// and a page is a few KB. Those fonts only cover Western European letters (the WinAnsi encoding):
// anything else in a name is simplified (ō → o) or left out by clean(). Line breaks are measured
// with the fonts' real glyph widths, so wrapped text fits its column exactly.

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
const SWAP = { 'Đ': 'D', 'đ': 'd', 'Ł': 'L', 'ł': 'l', 'ı': 'i', 'Λ': 'A', '‐': '-', '‑': '-', '‒': '-', '−': '-', '′': "'", '″': '"', '★': '*' };
// A character's WinAnsi code, or 0 when the fonts don't have it.
const code = (ch) => {
  const c = ch.codePointAt(0);
  return (c >= 32 && c < 127) || (c >= 0xa0 && c < 256 && c !== 0xad) ? c : ANSI[c] || 0;
};

// Text as the fonts can show it. NFKC turns styled letters (𝙿𝚘𝚠𝚎𝚛) into plain ones; accents
// the fonts lack are dropped; other scripts, emoji and invisible characters are left out.
export function clean(s) {
  let out = '';
  for (const ch of String(s ?? '').normalize('NFKC')) {
    if (code(ch)) out += ch;
    else if (SWAP[ch]) out += SWAP[ch];
    else if (/\s/.test(ch)) out += ' ';
    else {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      if (base && base !== ch && [...base].every(code)) out += base;
    }
  }
  return out.replace(/ {2,}/g, ' ').trim();
}
// A business name, tidied after anything was left out ("Example Beauty Salon سالن" → "Example Beauty Salon").
// '' when fewer than two letters or digits survive.
export function cleanName(s) {
  const n = clean(s).replace(/\s+([,.;:)])/g, '$1').replace(/^[\s,;:·•\-–—|/]+|[\s,;:·•\-–—|/(]+$/g, '');
  return (n.match(/[A-Za-z0-9À-ÿ]/g) || []).length >= 2 ? n : '';
}

// The width of a line of text in points. font: 'R' (regular or oblique) or 'B' (bold).
export const width = (s, font, size) => {
  const w = WIDTHS[font === 'B' ? 'B' : 'R'];
  let t = 0;
  for (const ch of s) t += w[(code(ch) || 63) - 32] || 0;
  return (t * size) / 1000;
};
// Greedy line breaking. A word longer than the whole line (a long web address) is split anywhere.
export function wrap(s, font, size, max) {
  const lines = [];
  for (const para of String(s ?? '').split('\n')) {
    let line = '';
    for (let word of clean(para).split(' ')) {
      if (!word) continue;
      const next = line ? line + ' ' + word : word;
      if (width(next, font, size) <= max) {
        line = next;
        continue;
      }
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

export const PAGE_W = 612, PAGE_H = 792; // US Letter, in points
export const num = (n) => String(Math.round(n * 100) / 100);
export const rgb = (hex) => [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
// A string in the font's encoding, as a PDF literal: ( ) and \ are escaped.
const lit = (s) => {
  let o = '';
  for (const ch of s) {
    const c = code(ch) || 63;
    o += c === 40 || c === 41 || c === 92 ? '\\' + ch : String.fromCharCode(c);
  }
  return '(' + o + ')';
};
// Document info and bookmarks take any language: UTF-16 with a byte-order mark.
const utf16 = (s) => '<FEFF' + String(s).split('').map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>';
// Link targets: ASCII only, anything else percent-encoded.
const ascii = (s) => '(' + String(s).replace(/[^\x20-\x7e]/g, (c) => encodeURIComponent(c)).replace(/[\\()]/g, '\\$&') + ')';

// Rounded corners and circles are Bézier curves; K places the control points.
const K = 0.5523;
function roundRect(x, y, w, h, r) {
  const k = r * K, n = (a) => a.map(num).join(' ');
  return [n([x + r, y]) + ' m', n([x + w - r, y]) + ' l', n([x + w - r + k, y, x + w, y + r - k, x + w, y + r]) + ' c',
    n([x + w, y + h - r]) + ' l', n([x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h]) + ' c',
    n([x + r, y + h]) + ' l', n([x + r - k, y + h, x, y + h - r + k, x, y + h - r]) + ' c',
    n([x, y + r]) + ' l', n([x, y + r - k, x + r - k, y, x + r, y]) + ' c h'].join(' ');
}

// A document. Pages are drawn with the origin at the top left, like the screen; PDF counts up from
// the bottom. shadings: shading dictionaries the pages paint with "/S1 sh", "/S2 sh" and so on.
// ink, rule: the default colors of text and lines.
export function Doc({ shadings = [], ink = '#000000', rule = '#cccccc' } = {}) {
  const pages = [];
  let page = null;
  const Y = (v) => num(PAGE_H - v);
  return {
    pages,
    addPage() {
      page = { ops: [], links: [] };
      pages.push(page);
      return pages.length - 1;
    },
    onPage(i) {
      page = pages[i];
    },
    raw(op) {
      page.ops.push(op);
    },
    // base = the baseline, from the top of the page. tc = extra space between letters.
    text(x, base, s, { font = 'R', size = 10, color = ink, tc = 0 } = {}) {
      page.ops.push(`BT /F${font} ${num(size)} Tf ${rgb(color)} rg ${num(tc)} Tc 1 0 0 1 ${num(x)} ${Y(base)} Tm ${lit(s)} Tj ET`);
    },
    rect(x, top, w, h, { fill, stroke, lw = 1, r = 0 } = {}) {
      const y = PAGE_H - top - h;
      const path = r ? roundRect(x, y, w, h, r) : `${num(x)} ${num(y)} ${num(w)} ${num(h)} re`;
      page.ops.push(`${fill ? rgb(fill) + ' rg ' : ''}${stroke ? rgb(stroke) + ' RG ' + num(lw) + ' w ' : ''}${path} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    },
    line(x1, y1, x2, y2, { color = rule, lw = 0.75 } = {}) {
      page.ops.push(`${rgb(color)} RG ${num(lw)} w 0 J ${num(x1)} ${Y(y1)} m ${num(x2)} ${Y(y2)} l S`);
    },
    circle(cx, cy, r, color) {
      const x = cx, y = PAGE_H - cy, k = r * K, n = (a) => a.map(num).join(' ');
      page.ops.push(`${rgb(color)} rg ${n([x + r, y])} m ${n([x + r, y + k, x + k, y + r, x, y + r])} c ${n([x - k, y + r, x - r, y + k, x - r, y])} c ${n([x - r, y - k, x - k, y - r, x, y - r])} c ${n([x + k, y - r, x + r, y - k, x + r, y])} c f`);
    },
    // A tappable web, mail or phone link over a box on the page.
    link(x, top, w, h, uri) {
      page.links.push([x, PAGE_H - top - h, x + w, PAGE_H - top, uri]);
    },

    // The finished file, as bytes. bookmarks: [{ title, page }] (shown in the viewer's sidebar).
    bytes({ title, author, creator = 'Lead Finder', bookmarks = [] }) {
      const objs = [];
      const add = (s) => {
        objs.push(s);
        return objs.length;
      };
      const ref = (n) => n + ' 0 R';
      const catalog = add(''), root = add('');
      const fonts = [['R', 'Helvetica'], ['B', 'Helvetica-Bold'], ['I', 'Helvetica-Oblique']]
        .map(([k, name]) => `/F${k} ${ref(add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`))}`);
      const shades = shadings.map((s, i) => `/S${i + 1} ${ref(add(s))}`);
      const res = add(`<< /ProcSet [/PDF /Text] /Font << ${fonts.join(' ')} >>${shades.length ? ` /Shading << ${shades.join(' ')} >>` : ''} >>`);
      const kids = pages.map((p) => {
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
      const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
      const stamp = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      const info = add(`<< /Title ${utf16(title)} /Author ${utf16(author)} /Creator ${utf16(creator)} /Producer ${utf16(creator)} /CreationDate (${stamp}) /ModDate (${stamp}) >>`);
      const rand = new Uint8Array(16);
      (globalThis.crypto || { getRandomValues: (a) => a.forEach((_, i) => { a[i] = Math.random() * 256; }) }).getRandomValues(rand);
      const id = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');

      // Every character here is a single byte, so string length = file offset: the cross-reference
      // table can point at each object's exact byte position.
      let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
      const offsets = objs.map((o, i) => {
        const at = out.length;
        out += `${i + 1} 0 obj\n${o}\nendobj\n`;
        return at;
      });
      const xref = out.length;
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
      out += `trailer\n<< /Size ${objs.length + 1} /Root ${ref(catalog)} /Info ${ref(info)} /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`;
      const bytes = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
      return bytes;
    },
  };
}
