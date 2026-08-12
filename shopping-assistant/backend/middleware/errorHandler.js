/**
 * Error Handler Middleware
 * Gestion centralisée des erreurs
 */

const { logger } = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Middleware de gestion des erreurs
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Erreur interne du serveur';

  // Logger l'erreur
  if (statusCode >= 500) {
    logger.error(`[${code}] ${message}`, {
      url: req.originalUrl,
      method: req.method,
      userId: req.userId,
      stack: err.stack
    });
  } else {
    logger.warn(`[${code}] ${message}`, {
      url: req.originalUrl,
      method: req.method
    });
  }

  // Répondre au client
  res.status(statusCode).json({
    error: message,
    code: code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

/**
 * Wrapper pour les fonctions asynchrones
 * Capture les erreurs non gérées
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  errorHandler,
  asyncHandler,
  AppError
};
