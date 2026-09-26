/**
 * Capucine — Utilitaires de dates
 *
 * Toutes les dates sont manipulées en UTC pour éviter les problèmes de fuseau horaire.
 * Les dates sont stockées au format ISO YYYY-MM-DD (date only) ou ISO timestamp complet.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Retourne la date d'aujourd'hui en UTC au format YYYY-MM-DD
 */
export function getTodayISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().split('T')[0];
}

/**
 * Convertit une date ISO (YYYY-MM-DD) en objet Date UTC à minuit
 */
export function parseDateISO(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Formate une date ISO (YYYY-MM-DD) pour l'affichage (ex: "lun. 15 janv.")
 */
export function formatDateDisplay(dateStr: string): string {
  const date = parseDateISO(dateStr);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

/**
 * Formate une date ISO pour l'affichage complet (ex: "lundi 15 janvier 2024")
 */
export function formatDateFull(dateStr: string): string {
  const date = parseDateISO(dateStr);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Retourne le nombre de jours entre deux dates (date2 - date1)
 * Les deux dates sont au format YYYY-MM-DD
 */
export function daysBetween(date1: string, date2: string): number {
  const d1 = parseDateISO(date1);
  const d2 = parseDateISO(date2);
  const diffMs = d2.getTime() - d1.getTime();
  return Math.round(diffMs / MS_PER_DAY);
}

/**
 * Vérifie si une date est aujourd'hui
 */
export function isToday(dateStr: string): boolean {
  return dateStr === getTodayISO();
}

/**
 * Vérifie si une date est dans le passé (strictement avant aujourd'hui)
 */
export function isPast(dateStr: string): boolean {
  return daysBetween(getTodayISO(), dateStr) > 0;
}

/**
 * Vérifie si une date est dans le futur (strictement après aujourd'hui)
 */
export function isFuture(dateStr: string): boolean {
  return daysBetween(dateStr, getTodayISO()) > 0;
}

/**
 * Vérifie si une date est dans une période [start, end] incluse
 */
export function isInRange(dateStr: string, startStr: string, endStr: string): boolean {
  return daysBetween(startStr, dateStr) >= 0 && daysBetween(dateStr, endStr) >= 0;
}

/**
 * Retourne la date d'hier au format YYYY-MM-DD
 */
export function getYesterdayISO(): string {
  const yesterday = new Date(Date.now() - MS_PER_DAY);
  return new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate())).toISOString().split('T')[0];
}

/**
 * Retourne la date de demain au format YYYY-MM-DD
 */
export function getTomorrowISO(): string {
  const tomorrow = new Date(Date.now() + MS_PER_DAY);
  return new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate())).toISOString().split('T')[0];
}

/**
 * Formate un timestamp ISO complet pour l'affichage relatif
 * Ex: "il y a 2 heures", "hier", "il y a 3 jours"
 */
export function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = Date.now();
  const diffMs = now - date.getTime();
  
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / MS_PER_DAY);
  
  if (diffMinutes < 1) return 'à l\'instant';
  if (diffMinutes < 60) return `il y a ${diffMinutes} min`;
  if (diffHours < 24) return `il y a ${diffHours} h`;
  if (diffDays === 1) return 'hier';
  if (diffDays < 7) return `il y a ${diffDays} jours`;
  
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

/**
 * Génère un tableau de dates ISO pour une période [start, end] inclusive
 */
export function generateDateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const start = parseDateISO(startStr);
  const end = parseDateISO(endStr);
  
  const current = new Date(start);
  while (current <= end) {
    dates.push(
      new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()))
        .toISOString().split('T')[0]
    );
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Retourte le nombre de jours dans un mois donné
 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Vérifie si une année est bissextile
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Formate une durée en jours pour l'affichage
 */
export function formatDuration(days: number): string {
  if (days === 1) return '1 jour';
  if (days < 7) return `${days} jours`;
  if (days < 30) return `${Math.floor(days / 7)} semaine${days >= 14 ? 's' : ''}`;
  if (days < 365) return `${Math.floor(days / 30)} mois`;
  return `${Math.floor(days / 365)} an${days >= 730 ? 's' : ''}`;
}