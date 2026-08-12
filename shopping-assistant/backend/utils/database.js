/**
 * Database Utility
 * Gestion de la base de données SQLite
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');

const DB_PATH = process.env.DATABASE_PATH || './data/shopping_assistant.db';

// S'assurer que le répertoire exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

/**
 * Obtenir l'instance de la base de données
 */
const getDatabase = () => {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        logger.error('Erreur de connexion à la base de données:', err);
        throw err;
      }
    });
    db.configure('busyTimeout', 5000);
  }
  return db;
};

/**
 * Exécuter une requête SQL
 */
const runQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

/**
 * Récupérer une seule ligne
 */
const getRow = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

/**
 * Récupérer toutes les lignes
 */
const getAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    const database = getDatabase();
    database.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

/**
 * Initialiser la base de données avec les schémas
 */
const initializeDatabase = async () => {
  try {
    const database = getDatabase();

    // Activer les foreign keys
    await runQuery('PRAGMA foreign_keys = ON');

    // Table Users
    await runQuery(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        budget REAL DEFAULT 0,
        currency TEXT DEFAULT 'EUR',
        preferences TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table Shopping Lists
    await runQuery(`
      CREATE TABLE IF NOT EXISTS shopping_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        total_cost REAL DEFAULT 0,
        is_completed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Table Shopping Items
    await runQuery(`
      CREATE TABLE IF NOT EXISTS shopping_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity REAL DEFAULT 1,
        unit TEXT DEFAULT 'pcs',
        estimated_price REAL,
        actual_price REAL,
        category TEXT,
        is_checked INTEGER DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE
      )
    `);

    // Table Purchase History
    await runQuery(`
      CREATE TABLE IF NOT EXISTS purchase_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        list_id INTEGER,
        total_spent REAL,
        items_bought INTEGER,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(list_id) REFERENCES shopping_lists(id) ON DELETE SET NULL
      )
    `);

    // Table Recommendations
    await runQuery(`
      CREATE TABLE IF NOT EXISTS recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_id INTEGER,
        recommendation_text TEXT,
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(item_id) REFERENCES shopping_items(id) ON DELETE SET NULL
      )
    `);

    // Créer les index pour les performances
    await runQuery('CREATE INDEX IF NOT EXISTS idx_shopping_lists_user ON shopping_lists(user_id)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_items(list_id)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_purchase_history_user ON purchase_history(user_id)');
    await runQuery('CREATE INDEX IF NOT EXISTS idx_recommendations_user ON recommendations(user_id)');

    logger.info('✅ Schémas de base de données créés avec succès');
  } catch (error) {
    logger.error('❌ Erreur lors de l\'initialisation de la base de données:', error);
    throw error;
  }
};

/**
 * Fermer la base de données
 */
const closeDatabase = () => {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) reject(err);
        else {
          db = null;
          logger.info('Base de données fermée');
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
};

module.exports = {
  getDatabase,
  runQuery,
  getRow,
  getAll,
  initializeDatabase,
  closeDatabase
};
