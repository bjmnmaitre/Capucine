/**
 * Shopping Routes
 * Endpoints pour gestion des listes de courses et articles
 */

const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { runQuery, getRow, getAll } = require('../utils/database');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/shopping/lists
 * Récupérer toutes les listes de courses de l'utilisateur
 */
router.get('/lists', asyncHandler(async (req, res) => {
  const lists = await getAll(
    `SELECT * FROM shopping_lists
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [req.userId]
  );

  res.json({
    lists,
    total: lists.length
  });
}));

/**
 * POST /api/shopping/lists
 * Créer une nouvelle liste de courses
 */
router.post('/lists', asyncHandler(async (req, res) => {
  const { title, description, budget } = req.body;

  if (!title || title.length < 1) {
    throw new AppError('Le titre de la liste est requis', 400, 'INVALID_TITLE');
  }

  const result = await runQuery(
    `INSERT INTO shopping_lists (user_id, title, description, total_cost)
     VALUES (?, ?, ?, ?)`,
    [req.userId, title, description || null, budget || 0]
  );

  logger.info(`Liste créée: ${result.id} pour l'utilisateur ${req.userId}`);

  const list = await getRow('SELECT * FROM shopping_lists WHERE id = ?', [result.id]);

  res.status(201).json({
    message: 'Liste de courses créée',
    list
  });
}));

/**
 * GET /api/shopping/lists/:listId
 * Récupérer les détails d'une liste et ses articles
 */
router.get('/lists/:listId', asyncHandler(async (req, res) => {
  const { listId } = req.params;

  const list = await getRow(
    'SELECT * FROM shopping_lists WHERE id = ? AND user_id = ?',
    [listId, req.userId]
  );

  if (!list) {
    throw new AppError('Liste non trouvée', 404, 'LIST_NOT_FOUND');
  }

  const items = await getAll(
    'SELECT * FROM shopping_items WHERE list_id = ? ORDER BY created_at ASC',
    [listId]
  );

  res.json({
    list,
    items,
    itemCount: items.length,
    checkedCount: items.filter(i => i.is_checked).length
  });
}));

/**
 * PUT /api/shopping/lists/:listId
 * Modifier une liste de courses
 */
router.put('/lists/:listId', asyncHandler(async (req, res) => {
  const { listId } = req.params;
  const { title, description, isCompleted } = req.body;

  const list = await getRow(
    'SELECT * FROM shopping_lists WHERE id = ? AND user_id = ?',
    [listId, req.userId]
  );

  if (!list) {
    throw new AppError('Liste non trouvée', 404, 'LIST_NOT_FOUND');
  }

  await runQuery(
    `UPDATE shopping_lists
     SET title = ?, description = ?, is_completed = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [title || list.title, description !== undefined ? description : list.description, isCompleted !== undefined ? isCompleted : list.is_completed, listId]
  );

  const updatedList = await getRow('SELECT * FROM shopping_lists WHERE id = ?', [listId]);

  logger.info(`Liste mise à jour: ${listId}`);

  res.json({
    message: 'Liste mise à jour',
    list: updatedList
  });
}));

/**
 * DELETE /api/shopping/lists/:listId
 * Supprimer une liste de courses
 */
router.delete('/lists/:listId', asyncHandler(async (req, res) => {
  const { listId } = req.params;

  const list = await getRow(
    'SELECT * FROM shopping_lists WHERE id = ? AND user_id = ?',
    [listId, req.userId]
  );

  if (!list) {
    throw new AppError('Liste non trouvée', 404, 'LIST_NOT_FOUND');
  }

  await runQuery('DELETE FROM shopping_lists WHERE id = ?', [listId]);

  logger.info(`Liste supprimée: ${listId}`);

  res.json({
    message: 'Liste supprimée'
  });
}));

/**
 * POST /api/shopping/items
 * Ajouter un article à une liste
 */
router.post('/items', asyncHandler(async (req, res) => {
  const { listId, name, quantity, unit, category, estimatedPrice } = req.body;

  // Vérifier que la liste appartient à l'utilisateur
  const list = await getRow(
    'SELECT * FROM shopping_lists WHERE id = ? AND user_id = ?',
    [listId, req.userId]
  );

  if (!list) {
    throw new AppError('Liste non trouvée', 404, 'LIST_NOT_FOUND');
  }

  if (!name || name.length < 1) {
    throw new AppError('Le nom de l\'article est requis', 400, 'INVALID_NAME');
  }

  const result = await runQuery(
    `INSERT INTO shopping_items (list_id, name, quantity, unit, category, estimated_price)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [listId, name, quantity || 1, unit || 'pcs', category || null, estimatedPrice || 0]
  );

  const item = await getRow('SELECT * FROM shopping_items WHERE id = ?', [result.id]);

  logger.debug(`Article créé: ${result.id} dans la liste ${listId}`);

  res.status(201).json({
    message: 'Article ajouté',
    item
  });
}));

/**
 * PUT /api/shopping/items/:itemId
 * Modifier un article
 */
router.put('/items/:itemId', asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  const { name, quantity, unit, category, actualPrice, isChecked, notes } = req.body;

  const item = await getRow('SELECT * FROM shopping_items WHERE id = ?', [itemId]);

  if (!item) {
    throw new AppError('Article non trouvé', 404, 'ITEM_NOT_FOUND');
  }

  // Vérifier que l'article appartient à l'utilisateur
  const list = await getRow(
    'SELECT * FROM shopping_lists WHERE id = ? AND user_id = ?',
    [item.list_id, req.userId]
  );

  if (!list) {
    throw new AppError('Accès refusé', 403, 'FORBIDDEN');
  }

  await runQuery(
    `UPDATE shopping_items
     SET name = ?, quantity = ?, unit = ?, category = ?, actual_price = ?, is_checked = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      name || item.name,
      quantity !== undefined ? quantity : item.quantity,
      unit || item.unit,
      category !== undefined ? category : item.category,
      actualPrice !== undefined ? actualPrice : item.actual_price,
      isChecked !== undefined ? isChecked : item.is_checked,
      notes !== undefined ? notes : item.notes,
      itemId
    ]
  );

  const updatedItem = await getRow('SELECT * FROM shopping_items WHERE id = ?', [itemId]);

  res.json({
    message: 'Article mis à jour',
    item: updatedItem
  });
}));

/**
 * DELETE /api/shopping/items/:itemId
 * Supprimer un article
 */
router.delete('/items/:itemId', asyncHandler(async (req, res) => {
  const { itemId } = req.params;

  const item = await getRow('SELECT * FROM shopping_items WHERE id = ?', [itemId]);

  if (!item) {
    throw new AppError('Article non trouvé', 404, 'ITEM_NOT_FOUND');
  }

  // Vérifier que l'article appartient à l'utilisateur
  const list = await getRow(
    'SELECT * FROM shopping_lists WHERE id = ? AND user_id = ?',
    [item.list_id, req.userId]
  );

  if (!list) {
    throw new AppError('Accès refusé', 403, 'FORBIDDEN');
  }

  await runQuery('DELETE FROM shopping_items WHERE id = ?', [itemId]);

  logger.debug(`Article supprimé: ${itemId}`);

  res.json({
    message: 'Article supprimé'
  });
}));

module.exports = router;
