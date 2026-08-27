/**
 * CAPUCINE — lecture de page, indépendante de toute extraction produit
 * ====================================================================
 *
 * Une page Web doit pouvoir être LUE et CARACTÉRISÉE sans qu'on sache encore
 * si elle porte un produit. C'était la faiblesse corrigée ici : la lecture
 * était un sous-produit de l'extraction, si bien qu'une page dont aucun
 * `Product` n'était lisible ne disait plus rien du tout — ni sa pagination, ni
 * ses contrôles de liste, ni son `ItemList`, ni même son type déclaré.
 *
 * Mesuré sur le corpus (112 pages réellement téléchargées) :
 *
 *   44 % des pages lues ne rendent aucune donnée produit ;
 *   28 d'entre elles portaient pourtant un relevé de structure exploitable ;
 *   4 auraient été classées différemment, dont 3 avec bascule d'éligibilité.
 *
 * Autrement dit : trois pages incapables de porter une offre passaient pour des
 * offres, uniquement parce qu'on avait renoncé à les lire.
 *
 * ── Invariant ────────────────────────────────────────────────────────────────
 *
 *   `read()` ne rend `null` QUE si la page n'a pas pu être récupérée.
 *
 * Dès lors que le document est en main, un `PageSnapshot` existe — même vide,
 * même illisible, même dépourvu de tout balisage. Une page muette est une
 * information ; une page non lue n'en est pas une, et les deux ne doivent
 * jamais se confondre.
 *
 * ── Ce que ce module ne fait pas ─────────────────────────────────────────────
 *
 * Il ne classe rien (page-classification.ts) et n'extrait aucun produit
 * (product-page-extractor.ts). Il constate, et c'est tout.
 */

import { collectPageObservations } from './page-structure-evidence';
import type { PageStructureEvidence } from './page-classification';

/**
 * Récupérateur de document.
 *
 * Déclaré ici par sa FORME plutôt qu'importé : `HttpPageFetcher` la satisfait
 * sans le savoir, et ce module n'a donc aucune dépendance vers l'extracteur
 * produit — c'est précisément ce découplage qu'on cherche. L'implémentation
 * est fournie par l'appelant, jamais choisie ici.
 */
export interface PageFetcherLike {
  fetch(url: string, timeoutMs?: number): Promise<string | null>;
  /**
   * Récupération rapportant l'URL finale et le chemin des redirections.
   * Optionnelle : un récupérateur qui ne l'implémente pas laisse `finalUrl`
   * à `null`, ce qui signifie « non observée » — et surtout pas « identique
   * à l'URL demandée », qui serait une affirmation gratuite.
   */
  fetchPage?(url: string, timeoutMs?: number): Promise<{
    html: string;
    requestedUrl: string;
    finalUrl: string;
    redirectChain: string[];
  } | null>;
}

/**
 * Ce qu'on a constaté d'une page, indépendamment de tout produit.
 *
 * Ne contient aucune donnée commerciale : ni prix, ni marchand, ni
 * disponibilité. Uniquement la nature du document.
 */
export interface PageSnapshot {
  /**
   * URL DEMANDÉE — celle que le fournisseur de recherche a donnée. Jamais
   * réécrite, jamais devinée.
   */
  requestedUrl: string;
  /**
   * URL FINALEMENT SERVIE, après redirections.
   *
   * `null` signifie « non observée » : le récupérateur employé ne la rapporte
   * pas. Elle n'est jamais repliée sur `requestedUrl` par défaut — une page
   * qui a peut-être redirigé n'est pas une page dont on sait qu'elle n'a pas
   * redirigé.
   */
  finalUrl: string | null;
  /**
   * URL CANONIQUE déclarée par la page (`<link rel="canonical">`).
   *
   * C'est une affirmation du site sur sa propre adresse, à ne confondre ni
   * avec l'adresse demandée, ni avec l'adresse servie. Elle peut désigner une
   * autre page (variante, pagination, page déplacée). `null` si absente.
   */
  canonicalUrl: string | null;
  /** Sauts de redirection réellement suivis, dans l'ordre. Vide si aucun. */
  redirectChain: string[];
  fetchedAt: Date;
  /** Taille du document effectivement lu, en caractères. */
  length: number;
  /**
   * Ce que la page déclare de sa propre structure. Toujours présent dès lors
   * que la page a été récupérée — éventuellement sans aucun champ renseigné,
   * ce qui signifie « lue, et elle ne déclare rien ».
   */
  signals: PageStructureEvidence;
}

/** Résultat d'une lecture : le document brut et son constat. */
export interface PageRead {
  snapshot: PageSnapshot;
  /**
   * Document tel que reçu. Mis à disposition pour les lectures ultérieures de
   * la même requête — notamment l'extraction produit — afin qu'aucune page ne
   * soit téléchargée deux fois.
   */
  html: string;
}

export class PageReader {
  /**
   * @param fetcher - Injecté, jamais construit ici : ce module ne décide pas
   *   comment on atteint le réseau, et reste ainsi testable sans lui.
   */
  constructor(private readonly fetcher: PageFetcherLike) {}

  /**
   * Récupère et caractérise une page.
   *
   * @returns `null` UNIQUEMENT si la page n'a pas pu être récupérée. Toute
   *   page obtenue produit un instantané, quelle que soit sa pauvreté.
   */
  async read(url: string, timeoutMs = 8000): Promise<PageRead | null> {
    // Voie complète quand le récupérateur sait rapporter l'URL finale ;
    // repli sur la voie simple sinon, en assumant explicitement de ne pas
    // l'avoir observée.
    const fetched = this.fetcher.fetchPage
      ? await this.fetcher.fetchPage(url, timeoutMs)
      : await this.fetcher.fetch(url, timeoutMs).then(html =>
          html === null ? null : { html, requestedUrl: url, finalUrl: null as string | null, redirectChain: [] }
        );
    if (fetched === null) return null;

    const { html } = fetched;
    // Le canonical relatif est résolu contre l'adresse RÉELLEMENT servie —
    // pas contre l'adresse demandée : après une redirection, elles diffèrent
    // et la mauvaise base produirait une URL fausse.
    const base = fetched.finalUrl ?? url;
    // Ne lève jamais : un document illisible produit un constat vide, ce qui
    // laisse la classification à son état d'ignorance plutôt que de lui faire
    // croire à une absence constatée.
    const observed = collectPageObservations(html, base);

    return {
      html,
      snapshot: {
        requestedUrl: url,
        finalUrl: fetched.finalUrl,
        canonicalUrl: observed.canonicalUrl,
        redirectChain: fetched.redirectChain,
        fetchedAt: new Date(),
        length: html.length,
        signals: observed.signals,
      },
    };
  }
}
