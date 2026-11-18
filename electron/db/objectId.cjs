/**
 * PocketDB — ObjectId simulation.
 *
 * Generates MongoDB-style unique ids: a 24-character lowercase hex string
 * built from a 4-byte timestamp, a per-process 5-byte machine nonce and a
 * 3-byte incrementing counter. Collisions are practically impossible within
 * a session and ids sort roughly by creation time.
 */
const crypto = require('crypto');

// 5 random bytes fixed for this process (stands in for machine id + pid).
const PROCESS_NONCE = crypto.randomBytes(5).toString('hex');

// 3-byte incrementing counter, random start to avoid clashes across runs.
let counter = crypto.randomInt(0, 0xffffff);

function nextCounter() {
  counter = (counter + 1) % 0xffffff;
  return counter;
}

/** @returns {string} 24-hex-char unique document id. */
function objectId() {
  const time = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  const count = nextCounter().toString(16).padStart(6, '0');
  return `${time}${PROCESS_NONCE}${count}`;
}

/** Extract the creation timestamp (ms) encoded in an ObjectId. */
function objectIdTimestamp(id) {
  const seconds = parseInt(String(id).slice(0, 8), 16);
  return Number.isNaN(seconds) ? null : seconds * 1000;
}

/** Basic shape validation for ids coming from the UI. */
function isValidObjectId(id) {
  return typeof id === 'string' && /^[0-9a-f]{24}$/.test(id);
}

module.exports = { objectId, objectIdTimestamp, isValidObjectId };
