/**
 * Capucine — Utilitaires de devises
 *
 * Toutes les montants sont stockés en centimes (entiers) pour éviter
 * les problèmes de précision des floats.
 * L'affichage utilise formatMoney pour la présentation.
 */

/**
 * Convertit un montant en centimes vers une chaîne formatée
 */
export function formatMoney(cents: number, currency: string = 'EUR'): string {
  const euros = cents / 100;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(euros);
}

/**
 * Parse une chaîne utilisateur (ex: "12,50" ou "12.50") en centimes
 * Retourne null si invalide
 */
export function parseAmount(input: string): number | null {
  if (!input || typeof input !== 'string') return null;
  
  // Normaliser: remplacer virgule par point, supprimer espaces et symboles
  const cleaned = input
    .replace(',', '.')
    .replace(/[€$£\s]/g, '')
    .trim();
  
  const value = parseFloat(cleaned);
  if (isNaN(value)) return null;
  if (value < 0) return null;
  
  // Convertir en centimes (arrondi au centime le plus proche)
  return Math.round(value * 100);
}

/**
 * Formate un montant en centimes pour l'affichage dans un champ de saisie
 * (sans symbole de devise, avec virgule décimale)
 */
export function formatInputAmount(cents: number): string {
  const euros = (cents / 100).toFixed(2);
  return euros.replace('.', ',');
}

/**
 * Vérifie si un montant en centimes est valide (> 0)
 */
export function isValidAmount(cents: number): boolean {
  return Number.isInteger(cents) && cents > 0;
}

/**
 * Additionne plusieurs montants en centimes
 */
export function sumAmounts(...amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + (amount || 0), 0);
}

/**
 * Calcule un pourcentage d'un montant en centimes
 * Arrondi au centime le plus proche
 */
export function calculatePercentage(cents: number, percent: number): number {
  return Math.round(cents * (percent / 100));
}