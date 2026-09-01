import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { checkHealth, HealthStatus, refine, search } from './src/api';
import { recordSearch } from './src/history';
import { ApiError, RankedOffer, SearchResponse } from './src/types';
import { SearchScreen } from './src/screens/SearchScreen';
import { ResultsScreen } from './src/screens/ResultsScreen';
import { OfferDetailScreen } from './src/screens/OfferDetailScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { CompareScreen } from './src/screens/CompareScreen';
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
  // Side-by-side comparison of 2–3 offers the user picked from the results.
  | { name: 'compare'; query: string; response: SearchResponse; offers: RankedOffer[] }
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

  // The UNTOUCHED response from the very first /search of the current
  // journey — never overwritten by a refine. "Repartir de la recherche
  // initiale" restores exactly this object, instantly, with no network
  // round-trip. This matters because the discovery backend is REAL, LIVE web
  // search: re-running the same query a second time can legitimately return
  // a different offer count (verified: 3 identical calls in a row returned
  // 12/12/14 results) — re-fetching on "reset" would look like a bug where
  // there isn't one. Keeping the original object sidesteps that entirely.
  const [originalResponse, setOriginalResponse] = useState<SearchResponse | null>(null);

  // Backend reachability — checked once on launch and re-checkable from the
  // search screen. `undefined` = not yet known (no banner shown).
  const [health, setHealth] = useState<HealthStatus | undefined>(undefined);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const recheckHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      setHealth(await checkHealth());
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  useEffect(() => { void recheckHealth(); }, [recheckHealth]);

  // Android hardware back walks the journey backwards instead of leaving the
  // app. iOS has no such button; this is a no-op there.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step.name === 'search') return false; // let the OS handle it (exit)
      if (step.name === 'detail' || step.name === 'compare') {
        setStep({ name: 'results', query: step.query, response: step.response });
      } else {
        setRefineError(null);
        setStep({ name: 'search' });
      }
      return true;
    });
    return () => sub.remove();
  }, [step]);

  async function onSearch(query: string) {
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    try {
      const response = await search(query, USER_ID);
      // An empty result list is a legitimate answer, not an error: it moves to
      // the results screen, which explains that nothing was found.
      setStep({ name: 'results', query, response });
      setOriginalResponse(response);
      void recordSearch(query, response.results.length);
      // A successful search proves the backend is reachable — clear any stale
      // "unreachable" banner without a second round-trip.
      setHealth((h) => (h && !h.reachable ? { ...h, reachable: true } : h));
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

  /**
   * "Repartir de la recherche initiale" — the session is append-only (a
   * refinement cannot be individually undone), so this restores the ACTUAL
   * first response object rather than re-searching. Instant, no network
   * call, and — unlike a fresh /search — guaranteed to be the exact list the
   * user started from (see `originalResponse`'s doc comment for why a
   * re-fetch would not give that guarantee against a live Web backend).
   */
  function onResetRefinements() {
    if (step.name !== 'results' || !originalResponse) return;
    setRefineError(null);
    setStep({ name: 'results', query: step.query, response: originalResponse });
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      {step.name === 'search' ? (
        <SearchScreen
          loading={loading}
          error={error}
          errorDetail={errorDetail}
          health={health}
          checkingHealth={checkingHealth}
          onRecheckHealth={recheckHealth}
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
          onResetRefinements={onResetRefinements}
          onSelect={(offer) => setStep({ ...step, name: 'detail', offer })}
          onCompare={(offers) => setStep({ ...step, name: 'compare', offers })}
          onBack={() => { setRefineError(null); setStep({ name: 'search' }); }}
        />
      ) : step.name === 'compare' ? (
        <CompareScreen
          offers={step.offers}
          onBack={() => setStep({ name: 'results', query: step.query, response: step.response })}
        />
      ) : (
        <OfferDetailScreen
          offer={step.offer}
          allOffers={step.response.results ?? []}
          ranking={step.response.rankingPreference}
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
