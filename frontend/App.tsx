import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { checkHealth, HealthStatus, refine, search } from './src/api';
import { recordSearch } from './src/history';
import { recordActivity } from './src/activity';
import { ApiError, RankedOffer, SearchResponse } from './src/types';
import { HomeScreen } from './src/screens/HomeScreen';
import { ResultsScreen } from './src/screens/ResultsScreen';
import { OfferDetailScreen } from './src/screens/OfferDetailScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { CompareScreen } from './src/screens/CompareScreen';
import { SearchesScreen } from './src/screens/SearchesScreen';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { TabBar, TabKey } from './src/components/TabBar';
import { theme } from './src/theme';

/**
 * Capucine is a five-tab app. The tab bar is the primary navigation; each tab
 * keeps its own state so switching between them never re-fetches anything.
 *
 * The SEARCH JOURNEY (ask → results → offer detail) is a small stack inside
 * the "Accueil" tab, carrying the session `/search` produced — the sessionId
 * is what `/clarify` and `/prepare-cart` both need, threaded through rather
 * than re-derived. "Comparer" is a real destination: an offer selection made
 * in the results hands off to that tab.
 */
type HomeStack =
  | { name: 'home' }
  | { name: 'results' }
  | { name: 'detail'; offer: RankedOffer };

const USER_ID = 'expo-user';

export default function App() {
  const [tab, setTab] = useState<TabKey>('home');
  const [homeStack, setHomeStack] = useState<HomeStack>({ name: 'home' });
  // A query pre-filled into the Home input (from a 0-result "reformuler", or a
  // re-run from the Recherches tab). Consumed on the next Home render.
  const [prefillQuery, setPrefillQuery] = useState<string | undefined>(undefined);

  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  // The UNTOUCHED first /search response of the current journey — never
  // overwritten by a refine. "Repartir de la recherche initiale" restores this
  // exact object with no network round-trip. The discovery backend is REAL,
  // LIVE web search: the same query re-run can legitimately return a different
  // offer count, so re-fetching on "reset" would look like a bug.
  const [originalResponse, setOriginalResponse] = useState<SearchResponse | null>(null);

  // Offers the user sent to the Comparer tab. `null` = nothing waiting there.
  const [compareOffers, setCompareOffers] = useState<RankedOffer[] | null>(null);

  const [health, setHealth] = useState<HealthStatus | undefined>(undefined);
  const [checkingHealth, setCheckingHealth] = useState(false);

  // Synchronous re-entry guard. `disabled` on the buttons covers the common
  // case, but two taps in the same frame both read the stale `loading === false`;
  // a ref updated immediately closes that window so a request never doubles.
  const inFlight = useRef(false);

  const recheckHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      setHealth(await checkHealth());
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  useEffect(() => { void recheckHealth(); }, [recheckHealth]);

  // Android hardware back: walk the current context backwards rather than
  // leaving the app. Non-home tab → home. Journey → one step back.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 'home') { setTab('home'); return true; }
      if (homeStack.name === 'detail') { setHomeStack({ name: 'results' }); return true; }
      if (homeStack.name === 'results') { setRefineError(null); setHomeStack({ name: 'home' }); return true; }
      return false; // home root — let the OS handle it (exit)
    });
    return () => sub.remove();
  }, [tab, homeStack]);

  function goHomeRoot() {
    setRefineError(null);
    setError(null);
    setHomeStack({ name: 'home' });
  }

  function onTabPress(next: TabKey) {
    // Tapping the active Accueil tab from deeper in the journey resets it.
    if (next === 'home' && tab === 'home' && homeStack.name !== 'home') {
      goHomeRoot();
      return;
    }
    setTab(next);
  }

  async function onSearch(nextQuery: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setTab('home');
    setQuery(nextQuery);
    setLoading(true);
    setError(null);
    setRefineError(null);
    setPrefillQuery(undefined);
    try {
      const res = await search(nextQuery, USER_ID);
      setResponse(res);
      setOriginalResponse(res);
      setHomeStack({ name: 'results' });
      void recordSearch(nextQuery, res.results.length);
      void recordActivity({ type: 'search', query: nextQuery, offerCount: res.results.length });
      recordExclusions(nextQuery, null, res);
      setHealth((h) => (h && !h.reachable ? { ...h, reachable: true, configured: true } : h));
    } catch (err) {
      setError((err as ApiError).message ?? 'La recherche a échoué.');
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  async function onRefine(answer: string) {
    if (homeStack.name !== 'results' || !response) return;
    if (inFlight.current) return;
    const sessionId = response.session?.sessionId;
    if (!sessionId) {
      setRefineError('Cette recherche ne peut plus être affinée. Relancez-la depuis l’accueil.');
      return;
    }
    inFlight.current = true;
    setRefining(true);
    setRefineError(null);
    const previous = response;
    try {
      const res = await refine(sessionId, answer);
      setResponse(res);
      void recordActivity({ type: 'refine', query, answer });
      recordExclusions(query, previous, res);
    } catch (err) {
      // The current results stay on screen — a failed refinement must not
      // discard offers the user already has.
      setRefineError((err as ApiError).message ?? "L'affinage n'a pas abouti.");
    } finally {
      setRefining(false);
      inFlight.current = false;
    }
  }

  /** Log a merchant-exclusion event only when NEW merchants become hidden —
   *  never on every refine, never when nothing changed. */
  function recordExclusions(q: string, before: SearchResponse | null, after: SearchResponse) {
    const now = after.merchantExclusions;
    if (!now || now.hiddenOfferCount <= 0) return;
    const had = new Set(before?.merchantExclusions?.hiddenMerchants ?? []);
    const fresh = now.hiddenMerchants.filter((m) => !had.has(m));
    if (fresh.length === 0 && before) return;
    void recordActivity({
      type: 'exclude', query: q,
      merchants: fresh.length > 0 ? fresh : now.hiddenMerchants,
      hiddenCount: now.hiddenOfferCount,
    });
  }

  function onResetRefinements() {
    if (homeStack.name !== 'results' || !originalResponse) return;
    setRefineError(null);
    setResponse(originalResponse);
  }

  function onReformulate(q: string) {
    setRefineError(null);
    setPrefillQuery(q);
    setHomeStack({ name: 'home' });
    setTab('home');
  }

  function openCompare(offers: RankedOffer[]) {
    setCompareOffers(offers);
    setTab('compare');
  }

  const results = response?.results ?? [];

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={theme.color.background} />
      <View style={styles.root}>
        <View style={styles.body}>
          {tab === 'home' && homeStack.name === 'home' ? (
            <HomeScreen
              loading={loading}
              error={error}
              health={health}
              checkingHealth={checkingHealth}
              onRecheckHealth={recheckHealth}
              initialQuery={prefillQuery}
              lastQuery={query && response ? query : null}
              onSearch={onSearch}
              onResume={() => setHomeStack({ name: 'results' })}
            />
          ) : tab === 'home' && homeStack.name === 'results' && response ? (
            <ResultsScreen
              query={query}
              response={response}
              refining={refining}
              refineError={refineError}
              onRefine={onRefine}
              onResetRefinements={onResetRefinements}
              onSelect={(offer) => setHomeStack({ name: 'detail', offer })}
              onCompare={openCompare}
              onReformulate={onReformulate}
              onBack={goHomeRoot}
            />
          ) : tab === 'home' && homeStack.name === 'detail' && response ? (
            <OfferDetailScreen
              offer={homeStack.offer}
              allOffers={results}
              ranking={response.rankingPreference}
              availabilityEmphasis={response.availabilityEmphasis}
              sessionId={response.session?.sessionId ?? null}
              onPrepared={(status, merchant) =>
                void recordActivity({ type: 'prepare', query, merchant, status })}
              onBack={() => setHomeStack({ name: 'results' })}
            />
          ) : tab === 'home' ? (
            // Journey state was cleared under a stale stack — recover to root.
            <HomeScreen
              loading={loading} error={error} health={health}
              checkingHealth={checkingHealth} onRecheckHealth={recheckHealth}
              initialQuery={prefillQuery} lastQuery={null}
              onSearch={onSearch} onResume={() => undefined}
            />
          ) : tab === 'searches' ? (
            <SearchesScreen
              onRun={(q) => onSearch(q)}
              onNewSearch={() => { goHomeRoot(); setTab('home'); }}
            />
          ) : tab === 'compare' ? (
            <CompareScreen
              offers={compareOffers ?? []}
              onBack={() => {
                setTab('home');
                if (response) setHomeStack({ name: 'results' });
              }}
              onClear={() => setCompareOffers(null)}
            />
          ) : tab === 'activity' ? (
            <ActivityScreen />
          ) : (
            <ProfileScreen userId={USER_ID} />
          )}
        </View>
        <TabBar active={tab} onChange={onTabPress} compareCount={compareOffers?.length ?? 0} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.background },
  body: { flex: 1 },
});
