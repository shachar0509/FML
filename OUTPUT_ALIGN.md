# Output alignment: Hebrew, math and text on one board

How Shalav turns Claude's Markdown into a card where:
- Hebrew reads right to left;
- formulas read left to right;
- a derivation's lines line up at their relation.

All of it is in `src/core/render/`:

| File | What it holds |
|---|---|
| `Markdown.tsx` | the source rewrite, the HTML pass and fitting |
| `Rows.tsx` | the board-rows layout |
| `src/index.css` and `src/cards/cards.css` | `.board-rows`, `.board-note`, `.ltr-token`, `.nobr` |

## Main rules

1. **A formula is always left to right.** Every `.katex` and `.katex-display` gets `dir="ltr"`, and nothing after that touches its inside.
2. **A block's direction comes from its words, never from its formulas.** A `p`, `li`, `h1`–`h6`, `td` or `th` with Hebrew words is `rtl`. One with Latin words is `ltr`. One with formulas only takes the card's direction. A sentence like "$a<b$ גוררים …" is Hebrew, while `dir="auto"` would call it left to right.
3. **Hebrew never sits inside KaTeX as a sentence.** KaTeX lays everything out left to right, so Hebrew words are moved out into text and the math pieces stay formulas.
4. **Never show raw TeX.** Every rewrite must leave valid KaTeX input. A KaTeX error shows its source in red, and that is the worst output.

## Pipeline

`<Markdown>` runs four stages, in this order:

1. **`fixMath(md)`** rewrites the Markdown source. It skips fenced code blocks.
2. **remark-gfm** and **remark-math** parse it, then **rehype-katex** renders the formulas (`KATEX` options, with `mhchem` for `\ce{…}`).
3. **`rehypeBoxes`** walks the HTML: boxes, directions, bidi islands and line breaks.
4. **`useFitFormulas`** shrinks whatever is still too wide, after layout.

A ```` ```rows ```` code block renders with `<Rows>`, which renders each cell through `<Markdown>` again.

### 1. Source rewrite: `fixMath`

The steps run in this order, and the order matters:

1. **`fenceDisplays`** puts a multi-line display's `$$` fences on lines of their own, keeping the `> ` blockquote prefix.
   - **Why:** remark-math reads `$$` like a code fence. Text after an opening `$$` is dropped, like a fence's language name. A block closes only on a line that is just `$$`.
   - **The bug it fixes:** `$$\begin{aligned} … \end{aligned}$$` lost its `\begin` and ran on past `\end{aligned}$$`, so KaTeX failed and printed the raw source in red.
   - Punctuation after the closing `$$` moves inside the formula. Other text moves to the next line.
   - **It runs first** because the two passes after it work one line at a time. On a line like `\end{cases}$$ היא … $|x|$`, they would pair the display's closing `$$` with the next `$`.
2. **`escapeCurrency`** decides when a `$` is a price ("מ-$100 ל-$120", "($)") and not a formula. It uses Pandoc's rule:
   - an opening `$` is not followed by a space or `)]},.;:!?`;
   - a closing `$` is not preceded by a space or `([{`, and not followed by a digit;
   - a `$` that never closes this way becomes `\$`;
   - table rows are checked per cell, so a `$` never pairs across `|`, and inline code is left alone.
3. **`balanceDollars`** pairs delimiters left to right on each line and fixes mismatches: a `$…$$` pair becomes `$…$`.
4. **Display formulas with Hebrew or written reasons** become a ```` ```rows ```` block (`displayToRows`). The regex finds a `$$…$$` that starts its line, blockquote prefixes included.
   - It accepts `aligned`, `align*`, `split`, `gathered`, `gather*` and `eqnarray*`, and a trailing `.,;:` after `\end{…}`.
   - The block stays KaTeX when it has a nested `\begin`, or Hebrew deep inside a structure (`\underbrace{…}_{\text{…}}`; checked by `deepHebrew`).
   - Without Hebrew, it converts only when every line that has `\text` is a written reason (`REASON`: `&& \text{`, `\quad (\text{`).
   - Lines are split at top-level `\\` only (`texLines`), so `\substack{a \\ b}` stays one line.
5. **Other display formulas with Hebrew** stay KaTeX, but bare Hebrew letters are wrapped in `\text{…}` (`wrapHebrew`). A wrapped phrase stays one run and reads correctly.
6. **Inline `$…$`:**
   - **With Hebrew,** the Hebrew comes out of the math (`hebrewOutOfMath` = `mathPieces` + `joinPieces`). A formula with `&`, `\\` or `\begin` stays whole, with its Hebrew wrapped.
   - **Without Hebrew, inside a Hebrew sentence,** the formula's logical arrows turn around (`rtlArrows`, below).
7. **`joinHyphenatedMath`:** `$\varepsilon$-$N$` becomes one formula, `$\varepsilon\text{-}N$`. Two formulas around a hyphen would swap places in a right-to-left line.
8. **`glueArrows`:** a no-break space after an arrow formula, so an arrow never ends a line away from what it points to.

#### Words and math in a formula: `mathPieces` and `joinPieces`

`mathPieces(tex)` cuts a formula into `{words, s}` pieces, in order:
- **Words:**
  - `\text{…}` with a Hebrew or Latin letter;
  - a run of bare Hebrew;
  - pieces that are only punctuation;
  - `\text{…}` holding only brackets or punctuation (`\text{(}`, `\text{)}`), when the formula has Hebrew. So in `\text{(הנחה: } a+c=0 \text{)}` the parentheses are text and follow the Hebrew. Without Hebrew, `f\text{(}x\text{)}` stays one formula.
- **Words only at brace depth 0** (`braceDepth`). In `|H|_{\text{dB}}` the `\text` belongs to the subscript.
- **Latin `\text`** counts as words only when it is a phrase: it has a space inside, or ends with `:`. A unit (`\text{ dB}`, `\text{kN·m}`) stays in the formula.

`joinPieces(pieces, rtl)` writes the pieces back as Markdown:
- words as text, math as `$…$`;
- in a Hebrew sentence, math goes through `rtlArrows`;
- no space after a trailing `-` ("מ-x") or `(`;
- no space before `,.:;)]`.

#### Arrows in a Hebrew sentence: `rtlArrows`

A Hebrew sentence reads right to left, so "$a<b$ וגם $b<c$ ⇒ $a<c$" must point left.
- `rtlArrows` splits a formula at its top-level logical arrows and reverses the arrows using `MIRROR`: `\Rightarrow`↔`\Leftarrow`, `\implies`↔`\impliedby`, and the Long variants. `\iff` and `\Leftrightarrow` stay as they are.
- Each statement becomes its own formula, so the sentence orders them.
- The reversed arrow is written as `\mathrel{\Leftarrow}`, so a second pass recognizes it and leaves it alone.
- Arrows typed as characters (`→ ⇒ ⟶ …`) in text are reversed in the HTML pass (`rtlTextArrows`). That happens only when the nearest strong letter on either side is Hebrew, so "ATP → ADP" keeps its arrow.

### 2. HTML pass: `rehypeBoxes`

The pass walks the tree with the current direction:
1. **Boxes.** `> [!proof] title` becomes `data-box` and `data-title`. A proof gets ∎. The kinds are listed in `BOXES`.
2. **Directions.** Each formula is set to `ltr` and the walk stops there; each block takes its direction from its words (main rule 2).
3. **Text arrows** are reversed in right-to-left blocks (`rtlTextArrows`).
4. **Edge tokens.** A number or Latin word with a neutral sign at its edge becomes a `span.ltr-token` with `dir="ltr"` and `nowrap`. Examples: `−1,000`, `~26–28`, `$5`, `×2`, `NAD⁺`, `25°C`, `5'`. In a right-to-left line, the line's direction would carry the sign to the wrong side. This applies in every direction; in a left-to-right line it changes nothing.
5. **Colour macros** written outside math (`\blue{…}`) colour the words.
6. **A colon before a list of symbols.** "…: $a$, $b$" puts a `<br>` after the colon. The exception is an open parenthesis: "(הנחה: $a+c=0$)" stays on one line.
7. **Punctuation after a formula** (`. , : ; ! ? ) ] ״ " ׳ '`) is wrapped with the formula in `span.nobr`, so it never starts a line alone. A parenthesis outside the formula follows the sentence's direction.
8. **Short words before a formula.** A word of up to 4 characters right before inline math ("אם", "של") is joined to it with a no-break space.

### 3. The board-rows layout: `Rows.tsx`

A ```` ```rows ```` block holds one line per row: `name | formula`. It comes from Claude directly, or from `displayToRows`.

**Each line is parsed into** `{label, pre, lead, parts, mixed, note}`:
- **`splitLabel`:** the text before the first `|`.
  - It is a name when it is Hebrew or plain words.
  - It is also a name when it is short math (`r = 5\%`) and the right side has a relation; the name is then rendered as `$…$`.
  - `|x| < R` (a bar at the very start, without a following space) and `f(x) = |x|` are formulas, not names.
- **`splitReason`:** a top-level `&&` always starts the note. So does a `\quad`, `\qquad` or `\hspace` followed by Hebrew or `\text{`.
- **`parseLine`:** remaining `&&` becomes `\qquad` and a single `&` is removed. Then:
  - no words: `parts = splitRel(formula)`, the formula split at its first top-level relation into left side, relation and right side;
  - words, then one formula: `pre`, or `lead` when the words end with `:` (a lead gets its own row);
  - one formula, then words: the words become the note;
  - words woven through the formula: `mixed`, one right-to-left line made with `hebrewOutOfMath`.
- **`parse`:** an arrow that ends the formula, in front of a Hebrew note, moves into the note, reversed ("⇐ הטור מתכנס").

**Layout:**
- The block is a CSS grid. Each row is `display: contents`, and its cells sit at `grid-row: calc(var(--row) * 3 - 1)`.
- Columns are `label · pre · lhs · rel · rhs · note`, plus a slack `1fr` column.
- `data-dir="rtl"` (any Hebrew label, pre, lead, mixed or note) reverses the columns. The name is on the right and the note on the left, while each formula cell stays left to right, lined up at the relation.
- Notes are muted and handwritten ("Gveret Levin" on the board), and `nowrap`.
- **Stacking is measured, not guessed.** When `clientWidth` is smaller than the width needed side by side, `data-stack` moves names and notes onto their own lines. Name rows sit at `3r−2` and note rows at `3r`, on the reading side.
- What stacking can't fix shrinks (`fitWidth`).
- The proof's ∎ sits after the last row, at `grid-row: calc(var(--rows) * 3 + 1)`.

### 4. Fitting: `fitWidth` and `useFitFormulas`

- **`fitWidth(el)`** lowers the font size in up to 4 rounds, to no less than `0.6em`, until `scrollWidth ≤ clientWidth`. KaTeX's fixed 2 px struts are why one round is not enough.
- **`useFitFormulas`:**
  - fits each `.katex-display` that is not inside a rows block;
  - fits each inline `.katex` that is wider than its closest `p`, `li`, `td`, `th`, `figcaption` or `div`.
- **Re-fitting.** It measures again on `ResizeObserver`, on `document.fonts` `loadingdone` (KaTeX fonts load lazily) and on `fonts.ready`.
- **Figures.** An svg figure keeps `dir="ltr"`, so its coordinates and `text-anchor` don't flip in a Hebrew card.

### 5. Slides with beats (M78)

A `teach_step` with `beats` renders the intro and then each beat as its own `<Markdown>`, so each beat goes through the whole pipeline above.
- A beat not reached yet is `visibility: hidden` (`.beat-later`). It keeps its room and its formulas, and `useFitFormulas` fits it once, at mount.
- A rows block lines up at its relation within one beat. Two beats are two grids.
- `\blue{word}` in plain text becomes a coloured span (HTML pass, step 5), the same colour as an SVG part with `class="m-blue"`.
- The figure keeps `dir="ltr"`. Hebrew SVG labels are centred (`text-anchor="middle"`), so they stay where the author put them.
- Server-drawn figures (M79: `tikz`, `bio`) come back as SVG and follow the same rules. TikZ labels are math and Latin only (no Hebrew TeX font), so the Hebrew stays in the beat text. A `% @n` line marker becomes a `data-beat` group.

## Checks

- **Unit tests:** `src/core/render/Markdown.test.tsx`. It covers currency, tables, edge tokens, arrows, `\ce`, units, labels, display fences and parentheses in notes.
- **Browser tests:** `e2e/tests/render.spec.ts` renders sample slides from `src/cards/test-advanced.ts` in light and dark. For each slide it checks that there is:
  - no `.katex-error`;
  - no raw TeX or stray `$` in text;
  - no sideways overflow.
- **Screenshots** (not committed; written by each run):
  - `e2e/tests_output/render-infi2-electrical/`: אינפי 2 and electrical engineering;
  - `e2e/tests_output/render-law-bio-chem-finance-arch/`: law, biology, chemistry, finance, architecture;
  - `e2e/tests_output/render-display-fences/`: the `$$\begin` / `\end$$` case (`fences-he-*.png`).
- **Slides:** `e2e/tests/slides.spec.ts` steps through the beat samples (`beats*` in `test-advanced.ts`) and writes screenshots to `e2e/tests_output/slides/`.
- **Adding a case:** add a sample to `ADVANCED` and its name to a list in `e2e/tests/render.spec.ts`.
