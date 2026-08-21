/**
 * Capucine — English catalog (complete, same key set as fr.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Capucine = root.Capucine || {};
    root.Capucine.locales = root.Capucine.locales || {};
    root.Capucine.locales.en = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    'app.name': 'Capucine',
    'app.tagline': 'Describe what you’re looking for. Capucine searches, compares, and explains why.',

    'nav.newSearch': 'New search',
    'nav.history': 'Searches',
    'nav.settings': 'Settings',
    'nav.profile': 'Profile',
    'nav.skipToContent': 'Skip to content',
    'nav.toggleSidebar': 'Toggle menu',

    'history.today': 'Today',
    'history.yesterday': 'Yesterday',
    'history.previous7Days': 'Previous 7 days',
    'history.older': 'Older',
    'history.empty': 'No searches yet.',

    'home.title': 'What are you looking for?',
    'home.subtitle': 'Describe what you need in a sentence, like you would to a shop assistant.',
    'home.suggestion1': 'A 14-inch laptop with 16GB RAM, under €1,000',
    'home.suggestion2': 'The best running shoes for men under €120',
    'home.suggestion3': 'Bluetooth headphones with noise cancelling',
    'home.suggestion4': 'A tablet under €500',

    'composer.placeholder': 'Describe what you’re looking for…',
    'composer.send': 'Send',
    'composer.sendAriaLabel': 'Send search',
    'composer.micAriaLabel': 'Voice search',
    'composer.micComingSoon': 'Voice search coming soon',
    'composer.hint': 'Enter to send · Shift+Enter for a new line',

    'status.understanding': 'Understanding your request…',
    'status.searching': 'Searching for offers…',
    'status.searchingDeeper': 'Capucine is searching deeper…',
    'status.comparing': 'Comparing offers…',
    'status.verifying': 'Verifying information…',
    'status.ranking': 'Ranking results…',
    'status.generic': 'Searching…',
    'status.clarifying': 'Continuing the search with your answer…',

    'results.title': 'Results',
    'results.count.one': '{count} offer found',
    'results.count.other': '{count} offers found',
    'results.bestMatch': 'Best match',
    'results.rank': 'Result #{rank}',
    'results.priceUnknown': 'Price not verified',
    'results.noUrl': 'Link not available',
    'results.noUrlHint': 'No verified URL for this offer',
    'results.viewOffer': 'Open offer',
    'results.source': 'Source: {source}',
    'results.offersFor': 'Offers',
    'results.newSearch': 'New search',

    'criteria.title': 'Your criteria',
    'criteria.unknownTitle': 'Unverifiable information',
    'criteria.satisfied': 'Satisfied',
    'criteria.violated': 'Not satisfied',
    'criteria.unknown': 'Unverifiable',

    'coverage.title': 'Search coverage',
    'coverage.queries.one': '{count} query run',
    'coverage.queries.other': '{count} queries run',
    'coverage.sources.one': '{count} source queried',
    'coverage.sources.other': '{count} sources queried',
    'coverage.domains.one': '{count} domain analyzed',
    'coverage.domains.other': '{count} domains analyzed',
    'coverage.sourcesFailed.one': '{count} source unavailable',
    'coverage.sourcesFailed.other': '{count} sources unavailable',
    'coverage.saturatedYes': 'Search deemed sufficient',
    'coverage.saturatedNo': 'Limited coverage',
    'coverage.elapsed': 'Search completed in {seconds}s',

    'empty.title': 'I couldn’t find any offer matching all your criteria.',
    'empty.explainGeneric': 'Capucine found no candidate for this search.',
    'empty.actionIncreaseBudget': 'Increase budget',
    'empty.actionBroaden': 'Broaden the search',
    'empty.actionInternational': 'Search internationally',
    'empty.actionRemoveCriterion': 'Remove a criterion',
    'empty.actionLowerLevel': 'Relax a criterion',
    'empty.actionAcceptRefurbished': 'See refurbished options',
    'empty.actionRephrase': 'Rephrase the search',

    'error.network': 'Could not reach Capucine. Check that the server is running.',
    'error.server': 'The server returned an error ({status}).',
    'error.retry': 'Retry',
    'error.serverStatus': 'Server status unavailable.',

    'clarify.continue': 'Continue',
    'clarify.placeholder': 'Your answer',

    'voice.idle': 'Voice search',
    'voice.listening': 'Listening…',
    'voice.transcribing': 'Transcribing…',
    'voice.cancel': 'Cancel',
    'voice.play': 'Play response',
    'voice.pause': 'Pause',
    'voice.stop': 'Stop',
    'voice.notConfigured': 'No real voice service connected — technical preview only.',

    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.languagePreparing': ' (translation coming)',
    'settings.currency': 'Currency',
    'settings.country': 'Country',
    'settings.close': 'Close',

    'config.aiMock': 'AI: demo mode (no key configured)',
    'config.aiReal': 'AI: {providers}',
    'config.webNotConfigured': 'Web search: not configured (results limited to fallback catalog)',
    'config.webConfigured': 'Web search: {adapter}',
  };
});
