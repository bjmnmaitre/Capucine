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

import {
  apiBaseUrlFrom, hostFromExpoHostUri, isLanReachableHost, resolveApiFrom, DEFAULT_API_PORT,
} from './api';

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

  it('un host de tunnel Expo/ngrok n\'est JAMAIS transformé en backend', () => {
    // Le bug observé sur iPhone : http://<sous-domaine>.exp.direct:3001
    expect(apiBaseUrlFrom('g_tuo7y-bmtdr-8082.exp.direct')).toBe(`http://localhost:${DEFAULT_API_PORT}`);
    expect(apiBaseUrlFrom('exp://abc-def-8081.exp.direct:80')).toBe(`http://localhost:${DEFAULT_API_PORT}`);
    expect(apiBaseUrlFrom('scalded-glacier.ngrok-free.dev')).toBe(`http://localhost:${DEFAULT_API_PORT}`);
    expect(apiBaseUrlFrom('foo.trycloudflare.com')).toBe(`http://localhost:${DEFAULT_API_PORT}`);
  });

  it('un backend explicite passe outre le tunnel (cas start:tunnel)', () => {
    expect(apiBaseUrlFrom('abc.exp.direct', 'https://xyz.ngrok-free.dev')).toBe('https://xyz.ngrok-free.dev');
  });
});

describe('isLanReachableHost — distinguer LAN et relais public', () => {
  it('IP privée, .local, hostname nu → joignable en direct', () => {
    for (const h of ['192.168.1.16', '10.0.0.5', 'mon-mac.local', 'capucine-dev']) {
      expect(isLanReachableHost(h)).toBe(true);
    }
  });
  it('domaines de tunnel → NON joignables en direct', () => {
    for (const h of [
      'x.exp.direct', 'y-8081.exp.host', 'z.ngrok-free.app', 'z.ngrok-free.dev',
      'w.ngrok.io', 'v.trycloudflare.com', 'u.loca.lt',
    ]) {
      expect(isLanReachableHost(h)).toBe(false);
    }
  });
  it('vide / absent → non joignable', () => {
    expect(isLanReachableHost('')).toBe(false);
    expect(isLanReachableHost(null)).toBe(false);
    expect(isLanReachableHost(undefined)).toBe(false);
  });
});

describe('resolveApiFrom — la source de l\'adresse est explicite', () => {
  it('backend explicite → source "explicit"', () => {
    expect(resolveApiFrom('192.168.1.16:8081', 'https://api.example')).toEqual({
      baseUrl: 'https://api.example', source: 'explicit',
    });
  });
  it('host LAN d\'Expo → source "lan"', () => {
    expect(resolveApiFrom('192.168.1.16:8081')).toEqual({
      baseUrl: `http://192.168.1.16:${DEFAULT_API_PORT}`, source: 'lan',
    });
  });
  it('tunnel sans backend explicite → source "unconfigured" (l\'UI le dira sans URL)', () => {
    expect(resolveApiFrom('abc.exp.direct')).toEqual({
      baseUrl: `http://localhost:${DEFAULT_API_PORT}`, source: 'unconfigured',
    });
    expect(resolveApiFrom(undefined, undefined)).toEqual({
      baseUrl: `http://localhost:${DEFAULT_API_PORT}`, source: 'unconfigured',
    });
  });
});
