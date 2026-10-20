/** What the server puts in `structuredContent`; `view` picks the card view (plan v2 §8). */
export type HomeData = {
  view: "home";
  language: "he" | "en";
  theme: "system" | "light" | "dark";
  courses: { number: string; name: string; credits: number; pct: number; stage: string | null }[];
};
export type CardData = HomeData;

export type Host = {
  callTool(name: string, args?: Record<string, unknown>): Promise<{ structuredContent?: unknown; isError?: boolean }>;
  /** Puts a short user line into the chat (how card buttons ask the model for AI work). */
  say(text: string): Promise<void>;
  context(): { theme?: string; locale?: string };
  /** Replays the latest result to a new subscriber. */
  subscribe(onData: (d: unknown) => void, onContext: () => void): () => void;
};
