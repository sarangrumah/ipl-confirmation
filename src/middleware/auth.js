'use strict';

// ------------------------------------------------------------
// System Architect domain
// HTTP Basic Authentication middleware for the admin dashboard.
//
// Protects:
//   - express.static  → the dashboard HTML/JS/CSS
//   - /api/payments/* → all REST endpoints
//
// Credentials are read from environment variables at request time
// (not at module load time) so a process restart is sufficient
// to pick up credential changes without a code redeploy.
// ------------------------------------------------------------

const REALM = 'IPL Dashboard';

/**
 * Fail-safe credential guard.
 * If either env var is missing the server refuses to start — see index.js.
 * This check here is a last-resort safety net in case the guard is bypassed.
 */
const getCredentials = () => {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;

  if (!username || !password) {
    throw new Error(
      '[auth] DASHBOARD_USERNAME and DASHBOARD_PASSWORD must be set in .env'
    );
  }

  return { username, password };
};

/**
 * Express middleware that enforces HTTP Basic Auth.
 *
 * Browser behaviour:
 *  - First visit → browser shows a native login dialog
 *  - Correct credentials → request proceeds, browser caches for the session
 *  - Wrong credentials → 401 returned, browser prompts again
 *
 * @type {import('express').RequestHandler}
 */
const basicAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return challenge(res);
  }

  // Decode "Basic <base64(username:password)>"
  const base64 = authHeader.slice('Basic '.length);
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  const colonIdx = decoded.indexOf(':');

  if (colonIdx === -1) return challenge(res);

  const suppliedUsername = decoded.slice(0, colonIdx);
  const suppliedPassword = decoded.slice(colonIdx + 1);

  let credentials;
  try {
    credentials = getCredentials();
  } catch (err) {
    console.error('[auth] Middleware misconfiguration:', err.message);
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // Constant-time comparison to prevent timing attacks
  const usernameMatch = timingSafeEqual(suppliedUsername, credentials.username);
  const passwordMatch = timingSafeEqual(suppliedPassword, credentials.password);

  if (!usernameMatch || !passwordMatch) {
    console.warn('[auth] Failed login attempt from IP:', req.ip);
    return challenge(res);
  }

  next();
};

/**
 * Send a 401 response that triggers the browser's Basic Auth dialog.
 */
const challenge = (res) => {
  res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  res.status(401).send('Authentication required.');
};

/**
 * Compare two strings in constant time to mitigate timing-based enumeration.
 * Falls back to a manual XOR loop when lengths differ.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
const timingSafeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));

  // Buffers must be same length for crypto.timingSafeEqual;
  // pad the shorter one so we always do the same amount of work.
  const len = Math.max(bufA.length, bufB.length);
  const padA = Buffer.concat([bufA, Buffer.alloc(len - bufA.length)]);
  const padB = Buffer.concat([bufB, Buffer.alloc(len - bufB.length)]);

  const equal = require('crypto').timingSafeEqual(padA, padB);
  // Also check original lengths to reject padded-match false positives
  return equal && bufA.length === bufB.length;
};

module.exports = { basicAuth };
