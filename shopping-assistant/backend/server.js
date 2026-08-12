#!/usr/bin/env node

/**
 * Shopping Assistant Backend Server
 * Serveur Express avec API pour gestion de listes de courses et recommandations IA
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Import des routes et middleware
const authRoutes = require('./routes/auth');
const shoppingRoutes = require('./routes/shopping');
const recommendationRoutes = require('./routes/recommendations');
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');
const { initializeDatabase } = require('./utils/database');
const { logger } = require('./utils/logger');

// Configuration
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialiser l'app Express
const app = express();

// Middleware de base
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Middleware de logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    uptime: process.uptime()
  });
});

// Routes publiques (avant authentification)
app.use('/api/auth', authRoutes);

// Middleware d'authentification
app.use(authMiddleware);

// Routes protégées
app.use('/api/shopping', shoppingRoutes);
app.use('/api/recommendations', recommendationRoutes);

// Route 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.path,
    method: req.method
  });
});

// Middleware de gestion des erreurs
app.use(errorHandler);

/**
 * Fonction de démarrage du serveur
 */
async function startServer() {
  try {
    // Initialiser la base de données
    logger.info('Initialisation de la base de données...');
    await initializeDatabase();
    logger.info('✅ Base de données initialisée');

    // Démarrer le serveur
    const server = app.listen(PORT, () => {
      logger.info(`
╔════════════════════════════════════════╗
║   Shopping Assistant Backend Ready     ║
╚════════════════════════════════════════╝
🚀 Serveur lancé sur http://localhost:${PORT}
📝 Environnement: ${NODE_ENV}
📦 API: http://localhost:${PORT}/api
🏥 Health: http://localhost:${PORT}/api/health
      `);
    });

    // Gestion des signaux d'arrêt
    const gracefulShutdown = (signal) => {
      logger.info(`Signal ${signal} reçu, arrêt du serveur...`);
      server.close(() => {
        logger.info('✅ Serveur arrêté proprement');
        process.exit(0);
      });

      // Force l'arrêt après 10 secondes
      setTimeout(() => {
        logger.error('❌ Forçage de l\'arrêt du serveur');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('❌ Erreur au démarrage du serveur:', error);
    process.exit(1);
  }
}

// Démarrer le serveur
if (require.main === module) {
  startServer();
}

module.exports = app;
