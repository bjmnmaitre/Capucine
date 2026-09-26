/**
 * Capucine — Hook de gestion des challenges
 *
 * Gère le cycle de vie des challenges : création, activation, progression, fin.
 * Utilise AsyncStorage pour la persistance locale.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Challenge, ChallengeProgress, DailyLog, DailyLogType } from '../types';
import { getTodayISO, daysBetween, isInRange, generateDateRange, parseDateISO, formatDateDisplay } from '../utils/date';

const STORAGE_KEY = 'capucine.challenges.v1';
const ACTIVE_CHALLENGE_KEY = 'capucine.active_challenge';

interface StoredData {
  challenges: Challenge[];
  activeChallengeId: string | null;
}

const DEFAULT_DATA: StoredData = {
  challenges: [],
  activeChallengeId: null,
};

function generateId(): string {
  return `challenge_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateDailyLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useChallenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chargement initial
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('capucine.challenges.v1');
        if (stored) {
          const data: { challenges: Challenge[]; activeChallengeId: string | null } = JSON.parse(stored);
          if (!cancelled) {
            setChallenges(data.challenges);
            setActiveChallengeId(data.activeChallengeId);
          }
        }
      } catch {
        // Silencieux - données corrompues = remise à zéro
      } finally {
        if (!cancelled) setLoading(false);
      }
      return () => { cancelled = true; };
    })();
  }, []);

  // Sauvegarde automatique
  const save = useCallback(async (challenges: Challenge[], activeId: string | null) => {
    try {
      await AsyncStorage.setItem('capucine.challenges.v1', JSON.stringify({
        challenges,
        activeChallengeId: activeId,
      }));
    } catch {
      // Silencieux - échec d'écriture non bloquant
    }
  }, []);

  // Création d'un challenge
  const createChallenge = useCallback(async (
    name: string,
    startDate: string,
    endDate: string,
    description?: string,
    goal?: string
  ): Promise<Challenge> => {
    const now = new Date().toISOString();
    const newChallenge: Challenge = {
      id: `challenge_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      userId: 'expo-user', // TODO: vrai userId quand auth
      name,
      description,
      startDate,
      endDate,
      goal,
      isActive: true,
      isCompleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newChallenges = [...challenges, newChallenge];
    setChallenges(newChallenges);
    await save(newChallenges, activeChallengeId);
    
    // Activer automatiquement le premier challenge créé
    if (challenges.length === 0) {
      setActiveChallengeId(newChallenge.id);
      await save(newChallenges, newChallenge.id);
    }

    return newChallenge;
  }, [challenges, activeChallengeId, save]);

  // Activation/désactivation d'un challenge
  const setActiveChallenge = useCallback(async (challengeId: string | null) => {
    if (challengeId === null) {
      setActiveChallengeId(null);
      await save(challenges, null);
      return;
    }

    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return;

    const today = new Date().toISOString().split('T')[0];
    if (!isInRange(new Date().toISOString().split('T')[0], challenge.startDate, challenge.endDate)) {
      // Hors période - on peut quand même activer pour consultation
    }

    setActiveChallengeId(challengeId);
    await save(challenges, challengeId);
  }, [challenges]);

  // Suppression d'un challenge
  const deleteChallenge = useCallback(async (challengeId: string) => {
    const newChallenges = challenges.filter(c => c.id !== challengeId);
    setChallenges(newChallenges);
    
    let newActiveId = activeChallengeId;
    if (activeChallengeId === challengeId) {
      newActiveId = newChallenges[0]?.id || null;
      setActiveChallengeId(newActiveId);
    }
    
    await save(newChallenges, newActiveId);
  }, [challenges, activeChallengeId, save]);

  // Mise à jour d'un challenge
  const updateChallenge = useCallback(async (challengeId: string, updates: Partial<Challenge>) => {
    const newChallenges = challenges.map(c => 
      c.id === challengeId 
        ? { ...c, ...updates, updatedAt: new Date().toISOString() }
        : c
    );
    setChallenges(newChallenges);
    await save(newChallenges, activeChallengeId);
  }, [challenges, activeChallengeId, save]);

  // Challenge actif actuel
  const activeChallenge = useMemo(() => 
    challenges.find(c => c.id === activeChallengeId) || null,
    [challenges, activeChallengeId]
  );

  // Challenges triés (actif d'abord, puis par date de création)
  const sortedChallenges = useMemo(() => 
    [...challenges].sort((a, b) => {
      if (a.id === activeChallengeId) return -1;
      if (b.id === activeChallengeId) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }),
    [challenges, activeChallengeId]
  );

  return {
    challenges: sortedChallenges,
    activeChallenge,
    activeChallengeId,
    loading,
    error,
    createChallenge,
    setActiveChallenge,
    deleteChallenge,
    updateChallenge,
    setChallenges,
  };
}

export type { Challenge };