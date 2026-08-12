/**
 * Recommendations Routes
 * Endpoints pour obtenir des recommandations IA de Claude
 */

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { getRow, getAll, runQuery } = require('../utils/database');
const { logger } = require('../utils/logger');

const router = express.Router();

// Initialiser le client Anthropic
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * POST /api/recommendations/get
 * Obtenir des recommandations pour une liste de courses
 */
router.post('/get', asyncHandler(async (req, res) => {
  const { listId } = req.body;

  if (!listId) {
    throw new AppError('listId est requis', 400, 'MISSING_LIST_ID');
  }

  // Vérifier que la liste appartient à l'utilisateur
  const list = await getRow(
    'SELECT * FROM shopping_lists WHERE id = ? AND user_id = ?',
    [listId, req.userId]
  );

  if (!list) {
    throw new AppError('Liste non trouvée', 404, 'LIST_NOT_FOUND');
  }

  // Récupérer les articles de la liste
  const items = await getAll(
    'SELECT * FROM shopping_items WHERE list_id = ? ORDER BY category, name',
    [listId]
  );

  if (items.length === 0) {
    return res.json({
      recommendations: [],
      message: 'Aucun article à recommander'
    });
  }

  try {
    // Préparer le prompt pour Claude
    const itemsList = items
      .map(item => `- ${item.name} (${item.quantity} ${item.unit})${item.category ? ` [${item.category}]` : ''}`)
      .join('\n');

    const prompt = `Je suis un assistant d'achat intelligent. Voici une liste de courses de l'utilisateur:

${itemsList}

Veuillez fournir des recommandations utiles pour cette liste de courses. Pour chaque article ou groupe d'articles:
1. Suggérer des alternatives ou substituts moins chers
2. Signaler les articles qui sont généralement en promotion
3. Proposer des articles complémentaires utiles
4. Donner des conseils d'achat pratiques

Formatez votre réponse en JSON avec cette structure:
{
  "recommendations": [
    {
      "item": "nom de l'article",
      "suggestion": "votre suggestion",
      "type": "alternative|complement|promo|conseil",
      "savings": "économies estimées si applicable"
    }
  ],
  "summary": "résumé général et astuces d'achat"
}`;

    logger.info(`Demande de recommandations pour la liste ${listId}`);

    // Appeler Claude API
    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Extraire la réponse
    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Parser JSON de la réponse
    let recommendations = [];
    let summary = '';

    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        recommendations = parsed.recommendations || [];
        summary = parsed.summary || '';
      }
    } catch (parseError) {
      logger.warn('Erreur du parsing JSON de Claude, utilisation de la réponse brute');
      summary = responseText;
    }

    // Sauvegarder les recommandations en base de données
    for (const rec of recommendations) {
      const item = items.find(i => i.name.toLowerCase().includes(rec.item?.toLowerCase() || ''));
      if (item) {
        await runQuery(
          `INSERT INTO recommendations (user_id, item_id, recommendation_text, category)
           VALUES (?, ?, ?, ?)`,
          [req.userId, item.id, rec.suggestion, rec.type]
        );
      }
    }

    logger.info(`${recommendations.length} recommandations générées pour la liste ${listId}`);

    res.json({
      recommendations,
      summary,
      itemsCount: items.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Erreur lors de l\'appel à Claude API:', error);
    throw new AppError('Erreur lors de la génération des recommandations', 500, 'CLAUDE_ERROR');
  }
}));

/**
 * GET /api/recommendations/history
 * Récupérer l'historique des recommandations
 */
router.get('/history', asyncHandler(async (req, res) => {
  const recommendations = await getAll(
    `SELECT r.*, i.name as item_name
     FROM recommendations r
     LEFT JOIN shopping_items i ON r.item_id = i.id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC
     LIMIT 50`,
    [req.userId]
  );

  res.json({
    recommendations,
    total: recommendations.length
  });
}));

/**
 * POST /api/recommendations/quick
 * Obtenir une recommandation rapide pour un article spécifique
 */
router.post('/quick', asyncHandler(async (req, res) => {
  const { itemName, quantity } = req.body;

  if (!itemName) {
    throw new AppError('itemName est requis', 400, 'MISSING_ITEM_NAME');
  }

  try {
    const prompt = `Je suis un assistant d'achat intelligent. L'utilisateur veut acheter: "${itemName}" (quantité: ${quantity || 1})

Veuillez fournir une recommandation rapide en JSON:
{
  "item": "${itemName}",
  "alternatives": ["alternative1", "alternative2"],
  "tips": "conseils d'achat pratiques",
  "estimatedPrice": "prix estimé approximatif",
  "buyingTips": "astuces pour trouver moins cher"
}`;

    logger.debug(`Recommandation rapide demandée pour: ${itemName}`);

    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    let recommendation = {};
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        recommendation = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      recommendation = { raw: responseText };
    }

    res.json({
      recommendation,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Erreur lors de l\'appel à Claude API:', error);
    throw new AppError('Erreur lors de la génération de la recommandation', 500, 'CLAUDE_ERROR');
  }
}));

module.exports = router;
