'use strict';

// ------------------------------------------------------------
// Database & API Engineer domain
// Owned by: Database & API Engineer agent
// Singleton Prisma client — import this everywhere DB access is needed.
// ------------------------------------------------------------

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

module.exports = prisma;
