'use strict';

// ---------------------------------------------------------------------------
// Expected format: PAY#<BLOCK>#<MONTH>#<AMOUNT>
//
// Examples:
//   PAY#A3#MARCH2025#150000
//   PAY#B12#JANUARY2026#200000
//
// Rules:
//   - BLOCK : alphanumeric, e.g. A3, B12, C1
//   - MONTH : alphanumeric, e.g. MARCH2025, JANUARY2026
//   - AMOUNT: numeric only (integer or decimal), no currency symbols
// ---------------------------------------------------------------------------

const MESSAGE_REGEX = /^PAY#([A-Z0-9]+)#([A-Z0-9]+)#(\d+(?:\.\d+)?)$/i;

/**
 * Parse a WhatsApp payment message body.
 *
 * @param {string} body - Raw WhatsApp message body
 * @returns {{ block: string, month: string, amount: number } | null}
 *   Returns null if the body does not match the expected format.
 */
const parsePaymentMessage = (body) => {
  if (!body || typeof body !== 'string') return null;

  const match = body.trim().match(MESSAGE_REGEX);
  if (!match) return null;

  return {
    block:  match[1].toUpperCase(),
    month:  match[2].toUpperCase(),
    amount: parseFloat(match[3]),
  };
};

module.exports = { parsePaymentMessage };
