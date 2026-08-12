/**
 * Authentication Middleware
 * Vérification des tokens JWT
 */

const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');

/**
 * Middleware de vérification JWT
 */
const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        error: 'Token d\'authentification manquant',
        code: 'NO_TOKEN'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.user = decoded;

    logger.debug(`Utilisateur authentifié: ${decoded.userId}`);
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expiré',
        code: 'TOKEN_EXPIRED'
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token invalide',
        code: 'INVALID_TOKEN'
      });
    }

    logger.error('Erreur d\'authentification:', error);
    res.status(500).json({
      error: 'Erreur d\'authentification',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Middleware optionnel d'authentification
 * Ne retourne pas d'erreur si pas de token
 */
const optionalAuth = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.userId = decoded.userId;
      req.user = decoded;
    }

    next();
  } catch (error) {
    logger.debug('Auth optionnelle échouée (attendu):', error.message);
    next();
  }
};

module.exports = {
  authMiddleware,
  optionalAuth
};
