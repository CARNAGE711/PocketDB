/**
 * PocketDB — Connection-string utilities.
 *
 * A PocketDB "connection" points at a local data directory, expressed as a
 * URI so the studio feels familiar to MongoDB users:
 *
 *   pocketdb:///C:/Users/me/PocketDB/pocketdb-data      (Windows)
 *   pocketdb:///home/me/pocketdb-data                   (macOS / Linux)
 */
'use strict';

const path = require('path');

/** Parse "pocketdb://..." into an absolute data-directory path. */
function parsePocketUri(input) {
  let s = String(input || '').trim();
  if (!s) {
    throw new Error('Connection string is empty. Example: pocketdb:///C:/Users/me/pocketdb-data');
  }
  if (/^[a-z]+:\/\//i.test(s) && !/^pocketdb:\/\//i.test(s)) {
    throw new Error(`Unsupported scheme in "${s}". PocketDB uses pocketdb://<data-directory>.`);
  }
  s = s.replace(/^pocketdb:\/\//i, '');
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw text if it contains a stray '%' */
  }
  s = s.replace(/\/+$/, '');
  // pocketdb:///C:/... carries a leading slash from the URI authority; drop it
  // for drive paths only (a Unix absolute path legitimately starts with '/').
  if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1);
  if (!s) throw new Error('Connection string has no data directory. Example: pocketdb:///C:/data');
  return path.normalize(s);
}

/** Build a canonical pocketdb:// URI from a data-directory path. */
function toPocketUri(dataDir) {
  const normalized = String(dataDir).replace(/\\/g, '/').replace(/^\//, '');
  return 'pocketdb:///' + normalized;
}

module.exports = { parsePocketUri, toPocketUri };
