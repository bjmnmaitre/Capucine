/**
 * Capucine — Voice provider contracts (STT / TTS)
 *
 * "La voix n'est PAS nécessairement un modèle de langage" — kept deliberately
 * separate from AIProvider (ai-orchestrator.ts), which is the LLM contract.
 * A future real conversational-voice pipeline is:
 *
 *   audio in → SpeechToTextProvider → text (+ detected language)
 *            → LanguageDetector / interpret() (existing pipeline, unchanged)
 *            → CapucineEngine.search() (existing pipeline, unchanged)
 *            → explanation text in the user's locale (translate(), i18n.ts)
 *            → TextToSpeechProvider → audio out
 *
 * Nothing about CapucineEngine's core needs to change to add voice — these
 * are input/output adapters around the existing text pipeline, matching the
 * same shape as WebSearchAdapter around discovery: an interface + a
 * deterministic Mock implementation for tests, real backends added later
 * without touching callers.
 *
 * NO real STT/TTS/audio API is called anywhere in this module or its tests.
 */

import { SupportedLanguage } from './i18n';
import { OutputModality } from './interaction-preferences';
export type { OutputModality as ResponseMode } from './interaction-preferences';
type ResponseMode = OutputModality;

// ============================================================================
// SPEECH-TO-TEXT
// ============================================================================

export interface TranscriptionResult {
  text: string;
  language: SupportedLanguage | 'unknown';
  /** 0-1, never fabricated — see MockSpeechToTextProvider for how a mock
   *  reports this honestly (fixed, not an invented "0.99"). */
  confidence: number;
}

export interface SpeechToTextProvider {
  readonly name: string;
  isConfigured(): boolean;
  transcribe(audio: Uint8Array, hint?: { language?: SupportedLanguage }): Promise<TranscriptionResult>;
}

/**
 * Deterministic mock: the "audio" is actually a UTF-8 encoded string in
 * tests (never real audio bytes) — this provider decodes it back and
 * reports it as the transcription, with a fixed confidence. Exists purely
 * to let the full voice chain (input → text → search → text → "speech")
 * be tested end-to-end without any audio codec or network dependency.
 */
export class MockSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = 'mock_stt';
  isConfigured(): boolean {
    return true;
  }
  async transcribe(audio: Uint8Array, hint?: { language?: SupportedLanguage }): Promise<TranscriptionResult> {
    const text = new TextDecoder('utf-8').decode(audio);
    return { text, language: hint?.language ?? 'unknown', confidence: text.length > 0 ? 0.9 : 0 };
  }
}

// ============================================================================
// TEXT-TO-SPEECH
// ============================================================================

export interface SynthesisResult {
  audio: Uint8Array;
  /** Real audio codec info would go here in a real provider — mock reports
   *  what it actually produced (a UTF-8 encoding of the input), never a
   *  fabricated codec/bitrate. */
  mimeType: string;
}

export interface TextToSpeechProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** `voice` names a provider-specific voice/persona; providers advertise
   *  their available voices via listVoices() rather than the caller
   *  guessing an id. */
  synthesize(text: string, locale: SupportedLanguage | string, voice?: string): Promise<SynthesisResult>;
  listVoices(locale: SupportedLanguage | string): string[];
}

/** Deterministic mock: "synthesizes" by UTF-8 encoding the text — lets tests
 *  assert the full text→"audio"→(decode)→text round-trip without any real
 *  TTS engine or network call. */
export class MockTextToSpeechProvider implements TextToSpeechProvider {
  readonly name = 'mock_tts';
  isConfigured(): boolean {
    return true;
  }
  async synthesize(text: string, _locale: SupportedLanguage | string, _voice?: string): Promise<SynthesisResult> {
    return { audio: new TextEncoder().encode(text), mimeType: 'application/x-mock-audio' };
  }
  listVoices(_locale: SupportedLanguage | string): string[] {
    return ['mock-voice-1', 'mock-voice-2'];
  }
}

// ============================================================================
// RESPONSE MODE — how the answer should be delivered
// ============================================================================
// Reuses OutputModality ('text' | 'voice' | 'hybrid') from
// interaction-preferences.ts — that file already models this exact
// dimension (distinct from WHAT language to answer in, i18n.ts's
// SupportedLanguage) as part of the persistent user-preferences contract.
// No second "ResponseMode" type — see the re-export above.

export const DEFAULT_RESPONSE_MODE: ResponseMode = 'text';

export function isValidResponseMode(value: unknown): value is ResponseMode {
  return value === 'text' || value === 'voice' || value === 'hybrid';
}
