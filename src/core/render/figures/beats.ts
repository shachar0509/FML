/** M79: a source line ending with `@n` or `@n-m` in a comment (`% @2`, `%% @2`, `# @2-3`, `// @4`) is shown from beat n (until beat m). Shared by the server kinds and Mermaid in the card. */
export const BEAT_MARK = /(?:%%?|#|\/\/)\s*@(\d+)(?:-(\d+))?\s*$/;
export const beatAttrs = (b: string, u?: string) => `data-beat="${Number(b)}"${u ? ` data-until="${Number(u)}"` : ""}`;

/** The theme colours by name in a source (`color="m-blue"`, `"color": "m-green"`) as exact marker values; `themeColors` turns them back into the card's --m-* colours. */
export const MARK = { blue: "1f5fbe", green: "1e7b3d", pink: "c42b2c", orange: "a24d01" } as const;
export const markColors = (src: string) => src.replace(/"?\bm-(blue|green|pink|orange)\b"?/g, (_, n: keyof typeof MARK) => `"#${MARK[n]}"`);
