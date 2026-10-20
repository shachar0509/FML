/** Cards build: no Shiki (vite.cards.config.ts aliases ./CodeBlock here). */
export const CodeBlock = ({ code }: { code: string; lang: string }) => (
  <pre dir="ltr" className="my-2 overflow-x-auto rounded-lg bg-border/40 p-3 text-sm">{code}</pre>
);
