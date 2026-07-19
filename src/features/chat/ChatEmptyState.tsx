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
      <div className="empty-logo">
        <BrandLogo size={64} animated />
      </div>
      <h1>{projectName ? `Working in ${projectName}` : "Start a Pi session"}</h1>
      <p>
        Pichamber drives the Pi Coding Agent through a local RPC process.
        Open or create a session in the sidebar to get going.
      </p>
      <div className="prompt-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion.title} onClick={() => onSuggestion(suggestion.body)}>
            <strong>{suggestion.title}</strong>
            {suggestion.body}
          </button>
        ))}
      </div>
    </div>
  );
}