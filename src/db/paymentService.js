'use strict';

// ------------------------------------------------------------
// Database & API Engineer domain
// Owned by: Database & API Engineer agent
// All DB operations for the Payment model live here.
// ------------------------------------------------------------

const { PaymentStatus } = require('@prisma/client');
const prisma = require('./prismaClient');

/**
 * Check whether a payment for the same sender + block + month already exists.
 *
 * @param {string} senderNumber
 * @param {string} blockNumber
 * @param {string} paymentMonth
 * @returns {Promise<boolean>}
 */
const findDuplicatePayment = async (senderNumber, blockNumber, paymentMonth) => {
  try {
    const existing = await prisma.payment.findFirst({
      where: { sender_number: senderNumber, block_number: blockNumber, payment_month: paymentMonth },
    });
    return existing !== null;
  } catch (err) {
    console.error('[paymentService.findDuplicatePayment] DB error:', err);
    throw err;
  }
};

/**
 * Persist a new payment record.
 *
 * @param {{ senderNumber: string, blockNumber: string, paymentMonth: string, amount: number, evidenceUrl: string }} data
 * @returns {Promise<import('@prisma/client').Payment>}
 */
const createPayment = async ({ senderNumber, blockNumber, paymentMonth, amount, evidenceUrl }) => {
  try {
    return await prisma.payment.create({
      data: {
        sender_number: senderNumber,
        block_number:  blockNumber,
        payment_month: paymentMonth,
        amount,
        evidence_url:  evidenceUrl,
        status:        PaymentStatus.PENDING,
      },
    });
  } catch (err) {
    console.error('[paymentService.createPayment] Prisma write error:', err);
    throw err;
  }
};

/**
 * Paginated list of payments with optional status filter.
 *
 * @param {{ page?: number, limit?: number, status?: string }} options
 * @returns {Promise<{ data: Payment[], total: number, page: number, totalPages: number }>}
 */
const listPayments = async ({ page = 1, limit = 20, status } = {}) => {
  try {
    const where = status ? { status } : {};
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return { data, total, page, totalPages: Math.ceil(total / limit) };
  } catch (err) {
    console.error('[paymentService.listPayments] DB error:', err);
    throw err;
  }
};

/**
 * Fetch a single payment by ID.
 *
 * @param {number} id
 * @returns {Promise<import('@prisma/client').Payment | null>}
 */
const getPaymentById = async (id) => {
  try {
    return await prisma.payment.findUnique({ where: { id: Number(id) } });
  } catch (err) {
    console.error('[paymentService.getPaymentById] DB error:', err);
    throw err;
  }
};

/**
 * Update the status of a payment.
 * Only accepts valid PaymentStatus enum values: PENDING | VERIFIED | REJECTED
 *
 * @param {number} id
 * @param {'PENDING' | 'VERIFIED' | 'REJECTED'} status
 * @returns {Promise<import('@prisma/client').Payment>}
 */
const updatePaymentStatus = async (id, status) => {
  try {
    return await prisma.payment.update({
      where: { id: Number(id) },
      data:  { status },
    });
  } catch (err) {
    console.error('[paymentService.updatePaymentStatus] DB error:', err);
    throw err;
  }
};

module.exports = {
  findDuplicatePayment,
  createPayment,
  listPayments,
  getPaymentById,
  updatePaymentStatus,
};
