import React, { useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { refine, search } from './src/api';
import { recordSearch } from './src/history';
import { ApiError, RankedOffer, SearchResponse } from './src/types';
import { SearchScreen } from './src/screens/SearchScreen';
import { ResultsScreen } from './src/screens/ResultsScreen';
import { OfferDetailScreen } from './src/screens/OfferDetailScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { theme } from './src/theme';

/**
 * The journey is one state machine, not three independent screens:
 * search -> results -> offer detail -> user action, each step carrying the
 * session produced by the previous one. The sessionId returned by /search is
 * what /prepare-cart needs, so it is threaded through rather than re-derived.
 */
type Step =
  | { name: 'search' }
  | { name: 'results'; query: string; response: SearchResponse }
  | { name: 'detail'; query: string; response: SearchResponse; offer: RankedOffer }
  // Permanent preferences live outside the search flow on purpose: entering
  // them must never carry search state, and leaving them must not disturb it.
  | { name: 'profile' };

const USER_ID = 'expo-user';

export default function App() {
  const [step, setStep] = useState<Step>({ name: 'search' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // Refinement runs from the results screen and has its own in-flight state:
  // the list stays visible and interactive while a follow-up is being applied.
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  async function onSearch(query: string) {
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    try {
      const response = await search(query, USER_ID);
      // An empty result list is a legitimate answer, not an error: it moves to
      // the results screen, which explains that nothing was found.
      setStep({ name: 'results', query, response });
      void recordSearch(query, response.results.length);
    } catch (err) {
      const e = err as ApiError;
      setError(e.message ?? 'La recherche a échoué.');
      setErrorDetail(e.detail ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function onRefine(answer: string) {
    if (step.name !== 'results') return;
    const sessionId = step.response.session?.sessionId;
    if (!sessionId) {
      setRefineError('Cette recherche ne peut pas être affinée. Relancez une recherche.');
      return;
    }
    setRefining(true);
    setRefineError(null);
    try {
      const response = await refine(sessionId, answer);
      setStep({ name: 'results', query: step.query, response });
    } catch (err) {
      // The current results stay on screen — a failed refinement must not
      // discard offers the user already has.
      setRefineError((err as ApiError).message ?? "L'affinage a échoué.");
    } finally {
      setRefining(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      {step.name === 'search' ? (
        <SearchScreen
          loading={loading}
          error={error}
          errorDetail={errorDetail}
          onSearch={onSearch}
          onOpenProfile={() => setStep({ name: 'profile' })}
        />
      ) : step.name === 'profile' ? (
        <ProfileScreen userId={USER_ID} onBack={() => setStep({ name: 'search' })} />
      ) : step.name === 'results' ? (
        <ResultsScreen
          query={step.query}
          response={step.response}
          refining={refining}
          refineError={refineError}
          onRefine={onRefine}
          onSelect={(offer) => setStep({ ...step, name: 'detail', offer })}
          onBack={() => { setRefineError(null); setStep({ name: 'search' }); }}
        />
      ) : (
        <OfferDetailScreen
          offer={step.offer}
          sessionId={step.response.session?.sessionId ?? null}
          onBack={() =>
            setStep({ name: 'results', query: step.query, response: step.response })
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.color.background },
});
