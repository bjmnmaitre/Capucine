import React, { useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { search } from './src/api';
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

  async function onSearch(query: string) {
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    try {
      const response = await search(query, USER_ID);
      // An empty result list is a legitimate answer, not an error: it moves to
      // the results screen, which explains that nothing was found.
      setStep({ name: 'results', query, response });
    } catch (err) {
      const e = err as ApiError;
      setError(e.message ?? 'La recherche a échoué.');
      setErrorDetail(e.detail ?? null);
    } finally {
      setLoading(false);
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
          onSelect={(offer) => setStep({ ...step, name: 'detail', offer })}
          onBack={() => setStep({ name: 'search' })}
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
