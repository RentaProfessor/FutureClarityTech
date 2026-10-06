// Distances for the radius search, which runs in the browser over the whole business list.

// Great-circle distance in miles (the haversine formula; Earth's mean radius is 3,958.8 miles).
export function milesBetween(lat1, lon1, lat2, lon2) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 7917.6 * Math.asin(Math.sqrt(h));
}

// Is a point inside a box [west, south, east, north]?
export const inBox = (lat, lon, [w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n;

// Does a circle around a point reach past the box? A degree of latitude is about 69 miles; a
// degree of longitude shrinks with the cosine of the latitude (about 57 miles in Los Angeles).
export function reachesPast(lat, lon, miles, [w, s, e, n]) {
  const dLat = miles / 69, dLon = miles / (69 * Math.cos((lat * Math.PI) / 180));
  return lat - dLat < s || lat + dLat > n || lon - dLon < w || lon + dLon > e;
}
