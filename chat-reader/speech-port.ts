/** The subset of the browser synthesizer used by NarrationController. */
export interface SpeechSynthesisLike {
  readonly speaking: boolean;
  readonly paused: boolean;
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export interface OwnedSpeechPort extends SpeechSynthesisLike {
  readonly ownsSpeech: boolean;
}

/**
 * Avoid touching the page's shared synthesis queue while this reader is idle.
 * This is an ownership guard, not a separate audio queue: concurrent native
 * speech can still share the browser's synthesizer while our speech is active.
 */
export function createOwnedSpeechPort(synthesis: SpeechSynthesisLike): OwnedSpeechPort {
  let active: {utterance: SpeechSynthesisUtterance} | null = null;
  // cancel() does not consistently clear the synthesizer's paused state.
  // Remember only pauses initiated here; never resume external speech at idle.
  let pausedByReader = false;

  return {
    get ownsSpeech() {return active !== null;},
    get speaking() {return active !== null && synthesis.speaking;},
    get paused() {return active !== null && synthesis.paused;},

    speak(utterance) {
      // A distinct session also protects a reused utterance from late callbacks.
      const session = {utterance};
      const previousEnd = utterance.onend;
      const previousError = utterance.onerror;
      active = session;
      utterance.onend = function(event) {
        if (active === session) active = null;
        previousEnd?.call(this, event);
      };
      utterance.onerror = function(event) {
        if (active === session) active = null;
        previousError?.call(this, event);
      };
      try {
        synthesis.speak(utterance);
      } catch (error) {
        if (active === session) active = null;
        throw error;
      }
      if (active === session && pausedByReader) {
        if (synthesis.paused) synthesis.resume();
        pausedByReader = synthesis.paused;
      }
    },

    cancel() {
      if (!active) return;
      // cancel() may synchronously dispatch end/error. Release first so its
      // handler cannot recursively cancel or claim a newer speech session.
      active = null;
      synthesis.cancel();
      if (!synthesis.paused) pausedByReader = false;
    },

    pause() {
      // A just-queued utterance may not report speaking yet; it can still pause.
      if (active && !synthesis.paused) {
        pausedByReader = true;
        synthesis.pause();
      }
    },

    resume() {
      if (active && synthesis.paused) {
        synthesis.resume();
        pausedByReader = synthesis.paused;
      }
    },
  };
}
