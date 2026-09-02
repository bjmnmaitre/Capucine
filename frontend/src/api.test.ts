/**
 * Résolution de l'adresse backend — LE chemin par lequel un iPhone joint le
 * Mac. Une erreur ici = « service injoignable » sur l'appareil, sans autre
 * indice. On teste chaque branche sans monter Expo.
 *
 * `api.ts` importe `expo-constants` au chargement du module ; on le neutralise
 * (le vrai objet n'existe pas hors runtime Expo), exactement comme
 * `history.test.ts` neutralise AsyncStorage.
 */
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));

import { apiBaseUrlFrom, hostFromExpoHostUri, DEFAULT_API_PORT } from './api';

describe('hostFromExpoHostUri — extraire le seul host', () => {
  it('host:port nu (cas réel appareil LAN)', () => {
    expect(hostFromExpoHostUri('192.168.1.16:8081')).toBe('192.168.1.16');
  });

  it('préfixe de schéma retiré (exp://, http://)', () => {
    expect(hostFromExpoHostUri('exp://192.168.1.16:8081')).toBe('192.168.1.16');
    expect(hostFromExpoHostUri('http://192.168.1.16:8081')).toBe('192.168.1.16');
  });

  it('chemin / query retirés', () => {
    expect(hostFromExpoHostUri('192.168.1.16:8081/index.bundle?platform=ios')).toBe('192.168.1.16');
  });

  it('host sans port', () => {
    expect(hostFromExpoHostUri('mon-mac.local')).toBe('mon-mac.local');
  });

  it('rien d\'exploitable → null', () => {
    for (const v of [undefined, null, '', '   ', '://', 'exp://']) {
      expect(hostFromExpoHostUri(v as string | undefined)).toBeNull();
    }
  });
});

describe('apiBaseUrlFrom — priorité et repli', () => {
  it('EXPO_PUBLIC_API_URL explicite gagne toujours, slash final retiré', () => {
    expect(apiBaseUrlFrom('192.168.1.16:8081', 'http://10.0.0.5:3001/')).toBe('http://10.0.0.5:3001');
    expect(apiBaseUrlFrom(undefined, 'https://capucine.example')).toBe('https://capucine.example');
  });

  it('sinon : host LAN d\'Expo + port API', () => {
    expect(apiBaseUrlFrom('192.168.1.16:8081')).toBe(`http://192.168.1.16:${DEFAULT_API_PORT}`);
    expect(apiBaseUrlFrom('exp://192.168.1.16:8081', '')).toBe(`http://192.168.1.16:${DEFAULT_API_PORT}`);
  });

  it('aucune info d\'hôte → localhost en dernier recours seulement', () => {
    expect(apiBaseUrlFrom(undefined, undefined)).toBe(`http://localhost:${DEFAULT_API_PORT}`);
  });

  it('ne colle jamais le port API à une valeur qui contient déjà un port', () => {
    // 8081 (Metro) ne doit jamais fuiter dans l'URL backend.
    expect(apiBaseUrlFrom('192.168.1.16:8081')).not.toContain('8081');
  });

  it('un EXPO_PUBLIC_API_URL vide ou blanc est ignoré (pas prioritaire)', () => {
    expect(apiBaseUrlFrom('192.168.1.16:8081', '   ')).toBe(`http://192.168.1.16:${DEFAULT_API_PORT}`);
  });
});
