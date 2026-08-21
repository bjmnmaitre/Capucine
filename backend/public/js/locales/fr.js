/**
 * Capucine — catalogue français (langue de lancement, complet).
 * Chargé par js/i18n.js via registerCatalog('fr', ...).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.locales = root.Capucine.locales || {};
    root.Capucine.locales.fr = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    'app.name': 'Capucine',
    'app.tagline': 'Décrivez ce que vous cherchez. Capucine recherche, compare et vous explique pourquoi.',

    'nav.newSearch': 'Nouvelle recherche',
    'nav.history': 'Recherches',
    'nav.settings': 'Paramètres',
    'nav.profile': 'Profil',
    'nav.skipToContent': 'Aller au contenu',
    'nav.toggleSidebar': 'Afficher/masquer le menu',

    'history.today': "Aujourd'hui",
    'history.yesterday': 'Hier',
    'history.previous7Days': '7 derniers jours',
    'history.older': 'Plus ancien',
    'history.empty': 'Aucune recherche pour le moment.',

    'home.title': 'Que recherchez-vous ?',
    'home.subtitle': 'Décrivez votre besoin en une phrase, comme vous le feriez à un vendeur.',
    'home.suggestion1': 'Un ordinateur portable 14 pouces, 16 Go de RAM, moins de 1 000 €',
    'home.suggestion2': 'Les meilleures chaussures de course pour homme à moins de 120 €',
    'home.suggestion3': 'Un casque bluetooth avec réduction de bruit',
    'home.suggestion4': 'Une tablette à moins de 500 €',

    'composer.placeholder': 'Décrivez ce que vous cherchez…',
    'composer.send': 'Envoyer',
    'composer.sendAriaLabel': 'Envoyer la recherche',
    'composer.micAriaLabel': 'Recherche vocale',
    'composer.micComingSoon': 'Recherche vocale bientôt disponible',
    'composer.hint': 'Entrée pour envoyer · Maj+Entrée pour un saut de ligne',

    'status.understanding': 'Compréhension de votre recherche…',
    'status.searching': 'Recherche des offres…',
    'status.searchingDeeper': 'Capucine approfondit la recherche…',
    'status.comparing': 'Comparaison des offres…',
    'status.verifying': 'Vérification des informations…',
    'status.ranking': 'Classement des résultats…',
    'status.generic': 'Recherche en cours…',
    'status.clarifying': 'Je poursuis la recherche avec votre réponse…',

    'results.title': 'Résultats',
    'results.count.one': '{count} offre trouvée',
    'results.count.other': '{count} offres trouvées',
    'results.bestMatch': 'Meilleure correspondance',
    'results.rank': 'Résultat #{rank}',
    'results.priceUnknown': 'Prix non vérifié',
    'results.noUrl': 'Lien non disponible',
    'results.noUrlHint': "Aucune URL vérifiée pour cette offre",
    'results.viewOffer': "Ouvrir l'offre",
    'results.source': 'Source : {source}',
    'results.offersFor': 'Offres',
    'results.newSearch': 'Nouvelle recherche',

    'criteria.title': 'Vos critères',
    'criteria.unknownTitle': 'Informations non vérifiables',
    'criteria.satisfied': 'Respecté',
    'criteria.violated': 'Non respecté',
    'criteria.unknown': 'Non vérifiable',

    'coverage.title': 'Couverture de la recherche',
    'coverage.queries.one': '{count} requête exécutée',
    'coverage.queries.other': '{count} requêtes exécutées',
    'coverage.sources.one': '{count} source interrogée',
    'coverage.sources.other': '{count} sources interrogées',
    'coverage.domains.one': '{count} domaine analysé',
    'coverage.domains.other': '{count} domaines analysés',
    'coverage.sourcesFailed.one': '{count} source indisponible',
    'coverage.sourcesFailed.other': '{count} sources indisponibles',
    'coverage.saturatedYes': 'Recherche jugée suffisante',
    'coverage.saturatedNo': 'Couverture limitée',
    'coverage.elapsed': 'Recherche effectuée en {seconds} s',

    'empty.title': "Je n'ai trouvé aucune offre correspondant à tous vos critères.",
    'empty.explainGeneric': "Capucine n'a pas trouvé de candidat pour cette recherche.",
    'empty.actionIncreaseBudget': 'Augmenter le budget',
    'empty.actionBroaden': 'Élargir la recherche',
    'empty.actionInternational': "Rechercher à l'international",
    'empty.actionRemoveCriterion': 'Retirer un critère',
    'empty.actionLowerLevel': 'Assouplir un critère',
    'empty.actionAcceptRefurbished': 'Voir le reconditionné',
    'empty.actionRephrase': 'Reformuler la recherche',

    'error.network': 'Impossible de contacter Capucine. Vérifiez que le serveur est démarré.',
    'error.server': 'Le serveur a renvoyé une erreur ({status}).',
    'error.retry': 'Réessayer',
    'error.serverStatus': 'État du serveur indisponible.',

    'clarify.continue': 'Continuer',
    'clarify.placeholder': 'Votre réponse',

    'voice.idle': 'Recherche vocale',
    'voice.listening': 'Écoute en cours…',
    'voice.transcribing': 'Transcription…',
    'voice.cancel': 'Annuler',
    'voice.play': 'Écouter la réponse',
    'voice.pause': 'Mettre en pause',
    'voice.stop': 'Arrêter',
    'voice.notConfigured': 'Aucun service vocal réel connecté — préparation technique uniquement.',

    'settings.title': 'Paramètres',
    'settings.language': 'Langue',
    'settings.languagePreparing': ' (traduction à venir)',
    'settings.currency': 'Devise',
    'settings.country': 'Pays',
    'settings.close': 'Fermer',

    'config.aiMock': 'IA : mode démonstration (aucune clé configurée)',
    'config.aiReal': 'IA : {providers}',
    'config.webNotConfigured': 'Recherche web : non configurée (résultats limités au catalogue de secours)',
    'config.webConfigured': 'Recherche web : {adapter}',
  };
});
