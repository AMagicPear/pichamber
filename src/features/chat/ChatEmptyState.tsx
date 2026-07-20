import { ArrowUpRight } from "lucide-react";
import { BrandLogo } from "../../components/BrandLogo";

interface Props {
  projectName?: string;
  onSuggestion(text: string): void;
}

const SUGGESTIONS = [
  { title: "Survey the codebase", body: "Map the project structure, main modules, and conventions used here." },
  { title: "Write a focused test", body: "Pick a tricky function and add a test that catches real regressions." },
  { title: "Refactor for clarity", body: "Find a module with mixed responsibilities and propose a cleaner split." },
];

export function ChatEmptyState({ projectName, onSuggestion }: Props) {
  return (
    <div className="empty-chat">
      <div className="empty-stack">
        <div className="empty-logo">
          <BrandLogo size={56} animated />
        </div>
        <div className="empty-headline">
          <h1>{projectName ? `Working in ${projectName}` : "Ready when you are"}</h1>
          <p>
            Ask Pi to plan a change, write code, or explore the repo. It runs locally
            and streams back into this window — no cloud round-trips.
          </p>
        </div>
        <div className="prompt-suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion.title} onClick={() => onSuggestion(suggestion.body)}>
              <div className="suggestion-body">
                <strong>{suggestion.title}</strong>
                <span>{suggestion.body}</span>
              </div>
              <ArrowUpRight size={14} className="suggestion-arrow" />
            </button>
          ))}
        </div>
        <div className="empty-hints">
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a newline · <kbd>⌘</kbd>+<kbd>K</kbd> for the command palette · <kbd>⌘</kbd>+<kbd>B</kbd> to toggle sidebar
        </div>
      </div>
    </div>
  );
}