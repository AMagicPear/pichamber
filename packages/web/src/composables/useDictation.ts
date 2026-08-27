import { onBeforeUnmount, ref } from "vue";

type DictationResult = {
  isFinal: boolean;
  [index: number]: { transcript: string } | undefined;
};

type DictationEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: DictationResult | undefined };
};

type DictationRecognition = {
  continuous: boolean;
  interimResults: boolean;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: DictationEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type DictationConstructor = new () => DictationRecognition;

type DictationWindow = Window & {
  SpeechRecognition?: DictationConstructor;
  webkitSpeechRecognition?: DictationConstructor;
};

/** Thin wrapper around Chromium's built-in Web Speech dictation API.
 * The API is vendor-prefixed in current Chromium builds, so it stays behind
 * this browser capability check instead of becoming part of app-wide types. */
export const useDictation = (
  onTranscript: (text: string) => void,
  onError: (code: string) => void,
) => {
  const Recognition = typeof window === "undefined"
    ? undefined
    : (window as DictationWindow).SpeechRecognition ?? (window as DictationWindow).webkitSpeechRecognition;
  const supported = Boolean(Recognition);
  const listening = ref(false);
  const interimText = ref("");
  let recognition: DictationRecognition | undefined;
  const interimSegments = new Map<number, string>();

  const updateInterimText = () => {
    interimText.value = [...interimSegments.values()].join(" ");
  };

  const stop = () => {
    recognition?.stop();
  };

  const start = () => {
    if (!Recognition) return;
    if (!recognition) {
      recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript.trim() ?? "";
          if (result?.isFinal) {
            interimSegments.delete(index);
            if (transcript) onTranscript(transcript);
          } else if (transcript) interimSegments.set(index, transcript);
        }
        updateInterimText();
      };
      recognition.onerror = (event) => {
        if (event.error === "aborted" || event.error === "no-speech") return;
        onError(event.error);
      };
      recognition.onend = () => {
        listening.value = false;
        interimSegments.clear();
        updateInterimText();
      };
    }
    try {
      recognition.start();
      listening.value = true;
    } catch {
      onError("start-failed");
    }
  };

  const toggle = () => {
    if (listening.value) stop();
    else start();
  };

  onBeforeUnmount(() => recognition?.abort());

  return { interimText, listening, supported, stop, toggle };
};
