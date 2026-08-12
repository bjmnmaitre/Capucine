/**
 * Authentication Routes
 * Endpoints pour inscription, connexion, refresh token
 */

const express = require('express');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const validator = require('validator');

const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { runQuery, getRow } = require('../utils/database');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/auth/register
 * Inscription d'un nouvel utilisateur
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { email, username, password, fullName } = req.body;

  // Validation
  if (!email || !validator.isEmail(email)) {
    throw new AppError('Email invalide', 400, 'INVALID_EMAIL');
  }

  if (!username || username.length < 3) {
    throw new AppError('Le nom d\'utilisateur doit contenir au moins 3 caractères', 400, 'INVALID_USERNAME');
  }

  if (!password || password.length < 6) {
    throw new AppError('Le mot de passe doit contenir au moins 6 caractères', 400, 'WEAK_PASSWORD');
  }

  // Vérifier si l'utilisateur existe déjà
  const existingUser = await getRow(
    'SELECT id FROM users WHERE email = ? OR username = ?',
    [email, username]
  );

  if (existingUser) {
    throw new AppError('Email ou nom d\'utilisateur déjà utilisé', 409, 'USER_EXISTS');
  }

  // Hasher le mot de passe
  const passwordHash = await bcryptjs.hash(password, 10);

  // Créer l'utilisateur
  const result = await runQuery(
    'INSERT INTO users (email, username, password_hash, full_name) VALUES (?, ?, ?, ?)',
    [email, username, passwordHash, fullName || null]
  );

  // Générer le token JWT
  const token = jwt.sign(
    { userId: result.id, email, username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );

  logger.info(`Nouvel utilisateur inscrit: ${email}`);

  res.status(201).json({
    message: 'Utilisateur créé avec succès',
    user: {
      id: result.id,
      email,
      username,
      fullName
    },
    token
  });
}));

/**
 * POST /api/auth/login
 * Connexion d'un utilisateur
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Validation
  if (!email || !password) {
    throw new AppError('Email et mot de passe requis', 400, 'MISSING_CREDENTIALS');
  }

  // Récupérer l'utilisateur
  const user = await getRow(
    'SELECT id, email, username, password_hash FROM users WHERE email = ?',
    [email]
  );

  if (!user) {
    throw new AppError('Email ou mot de passe incorrect', 401, 'INVALID_CREDENTIALS');
  }

  // Vérifier le mot de passe
  const isPasswordValid = await bcryptjs.compare(password, user.password_hash);

  if (!isPasswordValid) {
    throw new AppError('Email ou mot de passe incorrect', 401, 'INVALID_CREDENTIALS');
  }

  // Générer le token JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );

  logger.info(`Utilisateur connecté: ${email}`);

  res.json({
    message: 'Connexion réussie',
    user: {
      id: user.id,
      email: user.email,
      username: user.username
    },
    token
  });
}));

/**
 * POST /api/auth/verify
 * Vérifier la validité du token
 */
router.post('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      valid: false,
      error: 'Token manquant'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({
      valid: true,
      user: decoded
    });
  } catch (error) {
    res.status(401).json({
      valid: false,
      error: 'Token invalide ou expiré'
    });
  }
});

module.exports = router;
