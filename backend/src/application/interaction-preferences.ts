/**
 * Capucine — Interaction Preferences
 *
 * User preferences for HOW to interact with Capucine.
 * Based on functional preferences, NOT medical information.
 *
 * PRINCIPLE: "Preference for using the voice" is functional.
 *            "User is blind" is medical — we never ask or store this.
 *
 * ARCHITECTURE:
 * - Permanent preferences (saved to user profile)
 * - Session overrides (temporary, lost when session ends)
 * - Device capabilities (detected, not asked)
 *
 * RGPD COMPLIANCE:
 * - No medical data stored
 * - Only functional interaction preferences
 * - User can export/delete anytime
 * - No profiling or assumption about disability
 */

// ============================================================================
// INTERACTION MODALITIES
// ============================================================================

/**
 * How the user prefers to provide input.
 */
export type InputModality =
  | 'text'      // Traditional keyboard/typing
  | 'voice'     // Speech input (requires STT)
  | 'hybrid';   // Both text and voice, user chooses per-request

/**
 * How the user prefers to receive output.
 */
export type OutputModality =
  | 'text'      // Read on screen
  | 'voice'     // Listen (requires TTS)
  | 'hybrid';   // User chooses per-response

/**
 * Reading style for textual output.
 *
 * Example:
 *   "essential" mode for product result:
 *     "Nike Air Max, €129.99, free delivery, arrives in 2 days"
 *
 *   "detailed" mode for same product:
 *     "Nike Air Max 90 Essential. Price: €129.99 (down from €159.99, saving €30).
 *      Free shipping on orders over €30. Estimated arrival: 2-3 business days.
 *      Rating: 4.2/5 (2,341 reviews). Seller: Amazon (trusted)."
 */
export type ReadingStyle =
  | 'essential'  // Only critical information for decision-making
  | 'standard'   // Normal level of detail
  | 'detailed';  // Comprehensive, all available info

// ============================================================================
// TEXT PRESENTATION PREFERENCES
// ============================================================================

export interface TextPresentation {
  /**
   * Font size multiplier.
   * 1.0 = normal (browser default)
   * 1.5 = 150% (large text)
   * 2.0 = 200% (very large)
   */
  textSizeMultiplier: number;

  /**
   * Apply high contrast color scheme?
   * If true, use high-contrast palette (e.g., black text on white, or white on black).
   * If false, use normal palette.
   */
  highContrast: boolean;

  /**
   * Reduce animations and transitions?
   * Responds to: prefers-reduced-motion: reduce
   * If true, disable animations, instant transitions.
   */
  reducedMotion: boolean;

  /**
   * Font weight preference.
   * "normal" = 400
   * "bold" = 700
   * Useful for users with visual acuity challenges.
   */
  fontWeight: 'normal' | 'bold';

  /**
   * Maximum line length (in characters).
   * Narrower text can improve readability.
   * Default: 80 (standard web recommendation)
   * Range: 40-120
   */
  maxLineLength: number;

  /**
   * Line spacing multiplier.
   * 1.0 = normal (1.5 or 1.6 depending on font)
   * 1.5 = 150% spacing
   * 2.0 = double spacing
   */
  lineSpacing: number;
}

// ============================================================================
// INTERACTION PREFERENCES (PERSISTENT)
// ============================================================================

/**
 * User's permanent interaction preferences.
 * These are stored in the user profile and persist across sessions.
 * User can modify at any time.
 */
export interface InteractionPreferences {
  /**
   * Unique identifier for this preferences set.
   */
  id: string;

  /**
   * User ID (foreign key to UserProfile).
   */
  userId: string;

  // ─────────────────────────────────────────────────────────
  // INPUT / OUTPUT MODALITIES
  // ─────────────────────────────────────────────────────────

  /**
   * Preferred input modality.
   *
   * - "text": Traditional typing (keyboard, touchscreen)
   * - "voice": Speech input (requires microphone + STT provider)
   * - "hybrid": User provides text OR voice (mix per-request)
   *
   * Default: "text" (works offline, no dependencies)
   */
  inputModality: InputModality;

  /**
   * Preferred output modality.
   *
   * - "text": Text displayed on screen
   * - "voice": Audio output (requires speakers + TTS provider)
   * - "hybrid": Text + voice together (belt-and-suspenders)
   *
   * Default: "text"
   */
  outputModality: OutputModality;

  /**
   * When using voice output, what reading style?
   * See ReadingStyle definition above.
   *
   * Default: "standard"
   */
  voiceReadingStyle: ReadingStyle;

  /**
   * When using text output, what reading style?
   *
   * Default: "standard"
   */
  textReadingStyle: ReadingStyle;

  // ─────────────────────────────────────────────────────────
  // TEXT PRESENTATION
  // ─────────────────────────────────────────────────────────

  /**
   * Text presentation settings.
   * Default values chosen for standard readability.
   */
  textPresentation: TextPresentation;

  // ─────────────────────────────────────────────────────────
  // SPEECH SETTINGS (if using voice input/output)
  // ─────────────────────────────────────────────────────────

  /**
   * Preferred language for voice interaction.
   * e.g., "fr-FR", "en-US", "de-DE"
   * If undefined, falls back to browser/system language.
   */
  voiceLanguage?: string;

  /**
   * Speech rate multiplier for TTS.
   * 1.0 = normal speed
   * 0.8 = 20% slower
   * 1.5 = 50% faster
   * Range: 0.5 - 2.0
   */
  speechRate: number;

  /**
   * Voice variant preference for TTS.
   * "natural" = closer to human speech
   * "clear" = articulated, perhaps more robotic but clearer
   * "expressive" = with emphasis and emotion
   */
  voiceVariant: 'natural' | 'clear' | 'expressive';

  /**
   * Confirmation required for voice commands?
   * If true, voice commands are not executed until user confirms.
   * Reduces accidental purchases via voice.
   *
   * Example:
   *   User: "Buy the first option"
   *   Capucine: "Confirm: Nike Air Max, €129.99. Say yes to continue."
   *   User: "Yes" → Purchase
   *
   * Default: true (safety)
   */
  voiceCommandsRequireConfirmation: boolean;

  // ─────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────

  /**
   * When were these preferences created?
   */
  createdAt: Date;

  /**
   * When were these preferences last modified?
   */
  updatedAt: Date;

  /**
   * User has explicitly consented to store these preferences?
   * Required for RGPD compliance.
   *
   * If false: preferences are session-only, not persisted.
   * If true: preferences are saved to persistent storage.
   */
  userConsent: boolean;

  /**
   * How long to retain these preferences (days)?
   * 0 = indefinite (until user deletes)
   * 30 = auto-delete after 30 days of inactivity
   * etc.
   *
   * Default: 0 (keep indefinitely, or until user deletes)
   * For RGPD compliance: user can set a retention period.
   */
  retentionDays: number;

  /**
   * Description of these preferences (user-provided).
   * Example: "Setting up for my grandmother's phone"
   * Helps user manage multiple preference sets.
   */
  description?: string;
}

// ============================================================================
// SESSION OVERRIDES (TEMPORARY)
// ============================================================================

/**
 * Temporary overrides for a single session.
 * Merged on top of InteractionPreferences.
 * Lost when session ends.
 *
 * RATIONALE: User might say "Just use text for this search" without
 *            permanently changing their voice preference.
 */
export interface SessionInteractionOverrides {
  /**
   * Override input modality for this session only.
   * If undefined: use user's permanent preference.
   */
  inputModality?: InputModality;

  /**
   * Override output modality for this session only.
   */
  outputModality?: OutputModality;

  /**
   * Override text size for this session.
   * 1.0 = normal, 1.5 = 150%, etc.
   * If undefined: use permanent preference.
   */
  textSizeMultiplier?: number;

  /**
   * Temporary reason for override.
   * Example: "User said 'text only'"
   * For logging/debugging purposes.
   */
  reason?: string;
}

// ============================================================================
// DEVICE CAPABILITIES (DETECTED, NOT ASKED)
// ============================================================================

/**
 * Capabilities of the current device.
 * Detected automatically from browser/OS, NOT asked to user.
 *
 * PRINCIPLE: Never assume limitation = disability.
 *            If device has no microphone, we just can't use voice input.
 *            This is technical, not medical.
 */
export interface DeviceCapabilities {
  /**
   * Can device capture audio input?
   * Detected via: navigator.mediaDevices.enumerateDevices()
   * Requires: user permission
   */
  hasAudioInput: boolean;

  /**
   * Can device play audio output?
   * Detected via: test audio element playback
   */
  hasAudioOutput: boolean;

  /**
   * Is screen reader active?
   * Detected via: window.getComputedStyle(document.body).getPropertyValue('--sr-only-display')
   * Or: aria-live regions present, Chromevox extension, etc.
   * Unreliable, but can be detected heuristically.
   *
   * If true: Capucine can emphasize text-based and ARIA-friendly output.
   */
  screenReaderLikelyActive: boolean;

  /**
   * Operating system type.
   * "iOS" | "Android" | "Windows" | "macOS" | "Linux" | "unknown"
   */
  osType: string;

  /**
   * Is device online?
   * Detected via: navigator.onLine
   * Affects: ability to use cloud-based STT/TTS
   */
  isOnline: boolean;

  /**
   * Browser type.
   * "Chrome" | "Firefox" | "Safari" | "Edge" | "Opera" | "unknown"
   * Affects: API support (e.g., Web Speech API availability)
   */
  browserType: string;

  /**
   * Timestamp when capabilities were last detected.
   */
  detectedAt: Date;
}

// ============================================================================
// EFFECTIVE PREFERENCES (MERGED FOR RUNTIME)
// ============================================================================

/**
 * Merged preferences ready for use at runtime.
 *
 * Priority: SessionOverrides > InteractionPreferences > Defaults
 *
 * INVARIANT: At runtime, we use effectivePreferences, not the raw user preference.
 * This respects session-level choices while preserving permanent user settings.
 */
export interface EffectiveInteractionPreferences extends InteractionPreferences {
  /**
   * Which preferences were applied?
   * "permanent" = from InteractionPreferences
   * "session" = from SessionInteractionOverrides
   * "default" = hardcoded fallback
   */
  appliedPreferenceLevels: {
    inputModality: 'permanent' | 'session' | 'default';
    outputModality: 'permanent' | 'session' | 'default';
    textPresentation: 'permanent' | 'session' | 'default';
    // etc.
  };
}

// ============================================================================
// FACTORY / DEFAULTS
// ============================================================================

/**
 * Create default text presentation preferences.
 * These are reasonable defaults that work for most users.
 */
export function createDefaultTextPresentation(): TextPresentation {
  return {
    textSizeMultiplier: 1.0,
    highContrast: false,
    reducedMotion: false,
    fontWeight: 'normal',
    maxLineLength: 80,
    lineSpacing: 1.5,
  };
}

/**
 * Create default interaction preferences for a new user.
 * Functional defaults, no assumptions about user.
 */
export function createDefaultInteractionPreferences(
  userId: string,
  id: string = `prefs_${Date.now()}`
): InteractionPreferences {
  const now = new Date();

  return {
    id,
    userId,

    // Modalities
    inputModality: 'text',  // Text first (requires no setup)
    outputModality: 'text', // Text first
    voiceReadingStyle: 'standard',
    textReadingStyle: 'standard',

    // Text presentation
    textPresentation: createDefaultTextPresentation(),

    // Voice settings
    voiceLanguage: undefined, // Auto-detect
    speechRate: 1.0,
    voiceVariant: 'natural',
    voiceCommandsRequireConfirmation: true,

    // Metadata
    createdAt: now,
    updatedAt: now,
    userConsent: false, // Must explicitly opt-in
    retentionDays: 0,   // Keep indefinitely by default
  };
}

/**
 * Create device capabilities from current browser.
 * Called once on app load.
 */
export async function detectDeviceCapabilities(): Promise<DeviceCapabilities> {
  // Detect audio input
  let hasAudioInput = false;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    hasAudioInput = devices.some(d => d.kind === 'audioinput');
  } catch (e) {
    // Permission denied or not supported
    hasAudioInput = false;
  }

  // Detect audio output
  let hasAudioOutput = false;
  try {
    const audio = new Audio();
    hasAudioOutput = !audio.paused || audio.play !== undefined;
  } catch (e) {
    hasAudioOutput = false;
  }

  // Detect screen reader (heuristic)
  const screenReaderLikelyActive =
    (document as any).__a11ytest !== undefined || // Some SR extensions set this
    document.body.getAttribute('role') === 'application'; // App-mode hint

  // Detect OS
  const userAgent = navigator.userAgent;
  let osType = 'unknown';
  if (userAgent.indexOf('Win') !== -1) osType = 'Windows';
  else if (userAgent.indexOf('Mac') !== -1) osType = 'macOS';
  else if (userAgent.indexOf('X11') !== -1) osType = 'Linux';
  else if (userAgent.indexOf('Android') !== -1) osType = 'Android';
  else if (userAgent.indexOf('iPhone') !== -1 || userAgent.indexOf('iPad') !== -1)
    osType = 'iOS';

  // Detect browser
  let browserType = 'unknown';
  if (userAgent.indexOf('Edg') !== -1) browserType = 'Edge';
  else if (userAgent.indexOf('Chrome') !== -1) browserType = 'Chrome';
  else if (userAgent.indexOf('Firefox') !== -1) browserType = 'Firefox';
  else if (userAgent.indexOf('Safari') !== -1) browserType = 'Safari';
  else if (userAgent.indexOf('Opera') !== -1) browserType = 'Opera';

  return {
    hasAudioInput,
    hasAudioOutput,
    screenReaderLikelyActive,
    osType,
    isOnline: navigator.onLine,
    browserType,
    detectedAt: new Date(),
  };
}

/**
 * Merge permanent preferences with session overrides.
 * Session overrides take priority.
 */
export function mergePreferences(
  permanent: InteractionPreferences,
  sessionOverrides?: SessionInteractionOverrides
): EffectiveInteractionPreferences {
  const effective: EffectiveInteractionPreferences = {
    ...permanent,
    appliedPreferenceLevels: {
      inputModality: 'permanent',
      outputModality: 'permanent',
      textPresentation: 'permanent',
    },
  };

  if (sessionOverrides) {
    if (sessionOverrides.inputModality !== undefined) {
      effective.inputModality = sessionOverrides.inputModality;
      effective.appliedPreferenceLevels.inputModality = 'session';
    }

    if (sessionOverrides.outputModality !== undefined) {
      effective.outputModality = sessionOverrides.outputModality;
      effective.appliedPreferenceLevels.outputModality = 'session';
    }

    if (sessionOverrides.textSizeMultiplier !== undefined) {
      effective.textPresentation.textSizeMultiplier = sessionOverrides.textSizeMultiplier;
      effective.appliedPreferenceLevels.textPresentation = 'session';
    }
  }

  return effective;
}
