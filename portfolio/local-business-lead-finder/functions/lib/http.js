// Reading other sites' responses without paying for more than we need.

// Drop a response we won't read (a redirect, an error page) so its download stops.
export function discard(res) {
  try {
    if (res.body) res.body.cancel().catch(() => {});
  } catch {
    // already consumed or locked: nothing to stop
  }
}

// At most `max` characters of a page, then the download is cancelled: a 5 MB page costs the same as
// a 120 KB one. A page that times out partway keeps what arrived.
export async function readCapped(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = '';
  while (out.length < max) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch {
      break; // timed out mid-page: keep what arrived
    }
    if (chunk.done) break;
    out += dec.decode(chunk.value, { stream: true });
  }
  try {
    await reader.cancel();
  } catch {
    // the stream already ended
  }
  return out.slice(0, max);
}
