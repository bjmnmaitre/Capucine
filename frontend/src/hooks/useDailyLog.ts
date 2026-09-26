/**
 * Capucine — Hook de gestion du journal quotidien
 *
 * Gère les déclarations quotidiennes et le calcul du streak selon la règle métier :
 * - respecté → streak +1
 * - dépense évitée → streak +1
 * - dépense non essentielle → streak = 0 (interrompu)
 * - aucune déclaration → neutre (streak inchangé)
 *
 * Une seule déclaration par jour (challengeId + date unique)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Challenge, DailyLog, DailyLogType, ChallengeProgress } from '../types';
import { 
  getTodayISO, 
  daysBetween, 
  parseDateISO, 
  formatDateDisplay, 
  formatDateFull,
  daysInMonth,
  getYesterdayISO,
  isToday,
  isPast,
  generateDateRange
} from '../utils/date';
import { formatMoney } from '../utils/currency';

interface DailyLogInput {
  type: 'respected' | 'expense_avoided' | 'expense_made' | 'no_declaration';
  amountCents?: number;
  comment?: string;
}

interface DailyLogState {
  log: any; // DailyLog | null
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export function useDailyLog(challenge: any) {
  const [state, setState] = useState<DailyLogState>({
    log: null,
    loading: true,
    saving: false,
    error: null,
  });

  const today = new Date().toISOString().split('T')[0];
  const isChallengeActive = useMemo(() => {
    if (!challenge) return false;
    const today = new Date().toISOString().split('T')[0];
    return today >= challenge.startDate && today <= challenge.endDate;
  }, [challenge]);

  // Chargement du log du jour
  const loadLog = useCallback(async () => {
    if (!challenge) return;
    
    // Pour l'instant, on simule le stockage local
    // Dans la vraie implémentation, cela viendrait d'AsyncStorage ou du backend
    const today = new Date().toISOString().split('T')[0];
    const stored = localStorage.getItem(`capucine.daily.${challenge.id}.${today}`);
    
    if (stored) {
      try {
        const log = JSON.parse(stored);
        return log;
      } catch {
        // ignore
      }
    }
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const log = await loadLog();
      if (!cancelled) {
        setState(prev => ({ ...prev, log, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [loadLog]);

  // Calcul du streak
  const streak = useMemo(() => {
    // Logique de calcul du streak à partir de l'historique
    // Pour l'instant, on simule - sera remplacé par la vraie logique avec l'historique
    return 0;
  }, [challenge]);

  // Calcul de la progression
  const progress = useMemo(() => {
    if (!challenge) return null;
    
    const today = new Date().toISOString().split('T')[0];
    
    const totalDays = Math.max(0, Math.ceil((new Date(challenge.endDate).getTime() - new Date(challenge.startDate).getTime()) / (1000 * 60 * 60 * 24))) + 1;
    const daysElapsed = Math.max(0, Math.floor((new Date(today).getTime() - new Date(challenge.startDate).getTime()) / (1000 * 60 * 60 * 24))) + 1;
    const daysRemaining = Math.max(0, Math.ceil((new Date(challenge.endDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)));
    
    return {
      challengeId: challenge.id,
      totalDays: Math.max(0, totalDays),
      daysElapsed: Math.min(daysElapsed, totalDays),
      daysRemaining: Math.max(0, daysRemaining),
      daysRespected: 0, // TODO: calculer depuis l'historique
      daysExpenseAvoided: 0,
      daysExpenseMade: 0,
      daysNoDeclaration: 0,
      currentStreak: 0,
      bestStreak: 0,
      totalExpensesAvoidedCents: 0,
      completionRate: totalDays > 0 ? Math.round((0 / totalDays) * 100) : 0,
      isCompleted: new Date() > new Date(challenge.endDate),
      isActive: today >= challenge.startDate && today <= challenge.endDate,
    };
  }, [challenge]);

  // Soumission d'une déclaration
  const submitLog = useCallback(async (input: { type: string; amountCents?: number; comment?: string }) => {
    // TODO: implémenter la sauvegarde réelle
    // Pour l'instant, simulation
    console.log('Soumission déclaration:', input);
  }, []);

  // Modification d'une déclaration existante
  const updateLog = useCallback(async (input: { type: string; amountCents?: number; comment?: string }) => {
    // TODO: implémenter
  }, []);

  return {
    log: null,
    progress: null,
    streak: 0,
    loading: false,
    saving: false,
    error: null,
    submitLog,
    updateLog,
    canDeclare: true,
    isChallengeActive: false,
  };
}