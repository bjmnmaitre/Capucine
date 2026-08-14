/**
 * Capucine — Conversation Model + SearchState
 *
 * A CONVERSATION is the persistent context between a user and Capucine.
 * It contains multiple SEARCH SESSIONs (each triggered by a user request).
 * Each session holds a SEARCH STATE — the complete, versioned state of that search.
 *
 * KEY INVARIANTS:
 * - Modifying a search (adding constraint, changing budget) creates a NEW state version
 * - Previous states are never deleted — full history is always accessible
 * - Profile snapshot is captured at session start — profile changes after that don't affect the session
 * - AI interpretations are logged but NEVER silently alter the declared user request
 * - A SessionMessage records every user message and Capucine response
 *
 * GATE 24 + GATE 25 IMPLEMENTATION
 */

import { UserProfile, CurrentSearchRequirements, Offer, RankedOffer } from '../domain/types';
import { ProfileSnapshot, ProfileOverride } from '../domain/profile';
import { SearchPlan } from './search-plan';
import { AdmissibilityBatch } from '../domain/admissibility';
import { DeduplicationResult } from './deduplication';
import { AIInterpretationResult } from '../domain/types';

// ============================================================================
// USER MESSAGE
// ============================================================================

export type MessageRole = 'user' | 'capucine' | 'system';
export type MessageKind =
  | 'search_request'       // User initiates a search
  | 'clarification_query'  // Capucine asks user a clarifying question
  | 'clarification_answer' // User answers a clarifying question
  | 'modification_request' // User asks to modify the search (change constraint)
  | 'result_presentation'  // Capucine presents results
  | 'expansion_proposal'   // Capucine proposes expanding the search
  | 'expansion_decision'   // User accepts/declines expansion
  | 'explanation_request'  // User asks why an offer was ranked a certain way
  | 'explanation_response' // Capucine explains ranking
  | 'feedback'             // User gives thumbs up/down or explicit feedback
  | 'end_of_session';      // User ends the search

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  kind: MessageKind;
  content: string;           // Human-readable text
  structuredContent?: unknown; // Machine-readable payload (JSON)
  timestamp: Date;

  // For user messages: which search state was active when this was sent?
  activeStateVersion?: number;

  // For Capucine messages: based on which state was the response generated?
  basedOnStateVersion?: number;
}

// ============================================================================
// SEARCH STATE
// ============================================================================

/**
 * The complete, versioned state of a search at a point in time.
 *
 * Versioned: every user modification creates a new SearchState version.
 * The history of states is the complete audit trail of what was searched and why.
 *
 * INVARIANT: State versions are append-only. Version N is never modified.
 */
export interface SearchState {
  sessionId: string;
  version: number;      // 1, 2, 3... (incremented on each modification)
  createdAt: Date;

  // What the user originally said (raw, unmodified)
  originalRequest: string;

  // What was understood (may be enriched by AI, but always traceable)
  interpretedRequest: CurrentSearchRequirements | null;

  // AI interpretation result (logged for auditability; does NOT override ranking)
  aiInterpretation: AIInterpretationResult | null;

  // Profile snapshot at search start (immutable for this session)
  profileSnapshot: ProfileSnapshot;

  // Active overrides for this search state
  overrides: ProfileOverride[];

  // What was planned
  searchPlan: SearchPlan | null;

  // Raw candidates before any filtering
  rawCandidates: Offer[];

  // After admissibility filtering
  admissibilityResult: AdmissibilityBatch | null;

  // After deduplication
  deduplicationResult: DeduplicationResult | null;

  // Final ranked results
  rankedResults: RankedOffer[];

  // Status of this search state
  status: SearchStateStatus;

  // What caused this version (for audit trail)
  creationReason: string;

  // Previous version (null for v1)
  previousVersion: number | null;

  // What changed from previous version (for UI diff)
  changesFromPrevious?: StateChange[];
}

export type SearchStateStatus =
  | 'pending'              // Not yet started
  | 'interpreting'         // AI is interpreting the request
  | 'planning'             // Building search plan
  | 'discovering'          // Discovering candidates
  | 'filtering'            // Running admissibility
  | 'deduplicating'        // Deduplicating
  | 'ranking'              // Ranking
  | 'awaiting_clarification' // Paused for user clarification
  | 'awaiting_expansion_decision' // Paused for expansion approval
  | 'complete'             // Results available
  | 'empty'                // No results found
  | 'error';               // Error occurred

export interface StateChange {
  field: string;
  description: string;
  previousValue?: unknown;
  newValue?: unknown;
}

// ============================================================================
// SEARCH SESSION
// ============================================================================

/**
 * A search session = one user intent (possibly refined over multiple rounds).
 *
 * Multiple states: user may modify, expand, restrict → new state created each time.
 * The session holds ALL states (history) and a pointer to the active one.
 *
 * INVARIANT: Sessions are never deleted during a conversation.
 * INVARIANT: activeStateVersion always points to an existing state.
 */
export interface SearchSession {
  id: string;
  conversationId: string;
  createdAt: Date;
  updatedAt: Date;

  // The initial request that created this session
  initialRequest: string;

  // All state versions (indexed by version number, starting at 1)
  states: Map<number, SearchState>;

  // Currently active state version
  activeStateVersion: number;

  // All messages in this session (conversation turns)
  messages: SessionMessage[];

  // Metadata
  metadata: {
    /** User's locale at session start */
    locale: string;
    /** Currency at session start */
    currency: string;
    /** Any geographic constraints at session start */
    countries: string[];
  };
}

// ============================================================================
// CONVERSATION
// ============================================================================

/**
 * The top-level entity representing an ongoing interaction between user and Capucine.
 *
 * A conversation can span multiple searches (e.g., user starts a new search without
 * ending the conversation).
 *
 * INVARIANT: Sessions are never deleted.
 * INVARIANT: Profile changes during a conversation don't retroactively affect past sessions.
 */
export interface Conversation {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;

  // All search sessions in this conversation
  sessions: SearchSession[];

  // Currently active session (null if no active session)
  activeSessionId: string | null;

  // Conversation-level messages (greetings, navigation, etc.)
  conversationMessages: SessionMessage[];

  // Current status
  status: 'active' | 'idle' | 'closed';
}

// ============================================================================
// CONVERSATION MANAGER
// ============================================================================

/**
 * Manages conversation state — creating sessions, applying modifications,
 * updating state versions.
 *
 * INVARIANT: Never silently modifies past states.
 * INVARIANT: Every modification creates a new version (append-only).
 */
export class ConversationManager {

  /**
   * Create a new conversation.
   */
  createConversation(userId: string): Conversation {
    const id = `conv-${userId}-${Date.now()}`;
    return {
      id,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      sessions: [],
      activeSessionId: null,
      conversationMessages: [],
      status: 'active',
    };
  }

  /**
   * Start a new search session within a conversation.
   */
  startSession(
    conversation: Conversation,
    initialRequest: string,
    profileSnapshot: ProfileSnapshot,
    locale = 'fr',
    currency = 'EUR',
    countries = ['FR']
  ): { updatedConversation: Conversation; session: SearchSession } {

    const sessionId = `sess-${conversation.id}-${Date.now()}`;

    const initialState: SearchState = {
      sessionId,
      version: 1,
      createdAt: new Date(),
      originalRequest: initialRequest,
      interpretedRequest: null,
      aiInterpretation: null,
      profileSnapshot,
      overrides: [],
      searchPlan: null,
      rawCandidates: [],
      admissibilityResult: null,
      deduplicationResult: null,
      rankedResults: [],
      status: 'pending',
      creationReason: 'Initial search request',
      previousVersion: null,
    };

    const session: SearchSession = {
      id: sessionId,
      conversationId: conversation.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      initialRequest,
      states: new Map([[1, initialState]]),
      activeStateVersion: 1,
      messages: [],
      metadata: { locale, currency, countries },
    };

    const updatedConversation: Conversation = {
      ...conversation,
      sessions: [...conversation.sessions, session],
      activeSessionId: sessionId,
      updatedAt: new Date(),
    };

    return { updatedConversation, session };
  }

  /**
   * Update the active search state (e.g., after AI interpretation completes).
   * Returns the updated session with a new state version if the update is substantive.
   *
   * For IN-PROGRESS updates (partial state changes like "now interpreting"),
   * mutates the current state version rather than creating a new one.
   */
  updateState(
    session: SearchSession,
    updates: Partial<SearchState>,
    createNewVersion = false,
    reason?: string
  ): SearchSession {
    const current = session.states.get(session.activeStateVersion);
    if (!current) throw new Error(`State version ${session.activeStateVersion} not found`);

    if (createNewVersion) {
      // Create a new version
      const newVersion = session.activeStateVersion + 1;
      const changes = this.computeChanges(current, updates);

      const newState: SearchState = {
        ...current,
        ...updates,
        version: newVersion,
        createdAt: new Date(),
        previousVersion: session.activeStateVersion,
        creationReason: reason || 'Search modification',
        changesFromPrevious: changes,
      };

      const updatedStates = new Map(session.states);
      updatedStates.set(newVersion, newState);

      return {
        ...session,
        states: updatedStates,
        activeStateVersion: newVersion,
        updatedAt: new Date(),
      };
    } else {
      // Mutate current version (in-progress update)
      const updatedState: SearchState = {
        ...current,
        ...updates,
      };

      const updatedStates = new Map(session.states);
      updatedStates.set(session.activeStateVersion, updatedState);

      return {
        ...session,
        states: updatedStates,
        updatedAt: new Date(),
      };
    }
  }

  /**
   * Apply a user modification (creates a new state version).
   *
   * INVARIANT: Previous state is preserved unchanged.
   * INVARIANT: Only explicit user-requested changes propagate.
   */
  applyModification(
    session: SearchSession,
    modification: SearchModification
  ): SearchSession {
    const current = session.states.get(session.activeStateVersion);
    if (!current) throw new Error(`State version ${session.activeStateVersion} not found`);

    // Build updated state based on modification type
    let stateUpdates: Partial<SearchState> = {};

    switch (modification.type) {
      case 'add_constraint':
      case 'change_constraint':
      case 'remove_constraint':
        // These require re-interpreting with new criteria
        stateUpdates = {
          interpretedRequest: modification.updatedRequest ?? current.interpretedRequest,
          overrides: modification.updatedOverrides ?? current.overrides,
          // Reset pipeline results
          searchPlan: null,
          rawCandidates: [],
          admissibilityResult: null,
          deduplicationResult: null,
          rankedResults: [],
          status: 'pending',
        };
        break;

      case 'expand_search':
        stateUpdates = {
          searchPlan: modification.updatedPlan ?? current.searchPlan,
          rawCandidates: [],
          admissibilityResult: null,
          deduplicationResult: null,
          rankedResults: [],
          status: 'pending',
        };
        break;

      case 'change_budget':
        // Change budget only — other criteria remain
        stateUpdates = {
          interpretedRequest: modification.updatedRequest ?? current.interpretedRequest,
          rawCandidates: [],
          admissibilityResult: null,
          deduplicationResult: null,
          rankedResults: [],
          status: 'pending',
        };
        break;
    }

    return this.updateState(session, stateUpdates, true, modification.reason);
  }

  /**
   * Add a message to a session.
   */
  addMessage(session: SearchSession, msg: Omit<SessionMessage, 'sessionId'>): SearchSession {
    const message: SessionMessage = { ...msg, sessionId: session.id };
    return {
      ...session,
      messages: [...session.messages, message],
      updatedAt: new Date(),
    };
  }

  /**
   * Get the active state for a session.
   */
  getActiveState(session: SearchSession): SearchState | null {
    return session.states.get(session.activeStateVersion) || null;
  }

  /**
   * Get the full history of states for a session.
   */
  getStateHistory(session: SearchSession): SearchState[] {
    return Array.from(session.states.values()).sort((a, b) => a.version - b.version);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private computeChanges(
    current: SearchState,
    updates: Partial<SearchState>
  ): StateChange[] {
    const changes: StateChange[] = [];
    for (const [key, newVal] of Object.entries(updates)) {
      const oldVal = (current as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({
          field: key,
          description: `${key} updated`,
          previousValue: oldVal,
          newValue: newVal,
        });
      }
    }
    return changes;
  }
}

// ============================================================================
// SEARCH MODIFICATION
// ============================================================================

export type SearchModificationType =
  | 'add_constraint'
  | 'change_constraint'
  | 'remove_constraint'
  | 'change_budget'
  | 'expand_search'
  | 'restrict_search';

export interface SearchModification {
  type: SearchModificationType;
  reason: string;
  updatedRequest?: CurrentSearchRequirements;
  updatedOverrides?: ProfileOverride[];
  updatedPlan?: SearchPlan;
}
