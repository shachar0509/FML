import type { StepData } from "./types";

/** Test-host samples (?view=step&sample=…): advanced Hebrew lesson steps with mixed math, figures and pictures. */
type Sample = Pick<StepData, "titleMd" | "bodyMd" | "sideMd" | "figure" | "progress">;

const plot = (o: object) => JSON.stringify(o);

/** A unit circle with an angle θ, its sine and cosine (an svg picture, as the tutor draws one). */
const UNIT_CIRCLE = `<svg viewBox="-130 -135 300 265" xmlns="http://www.w3.org/2000/svg" font-family="serif" font-size="15" fill="none" stroke="currentColor">
<line x1="-120" y1="0" x2="120" y2="0" stroke-width="1"/><line x1="0" y1="-120" x2="0" y2="120" stroke-width="1"/>
<circle cx="0" cy="0" r="100" stroke-width="2"/>
<line x1="0" y1="0" x2="70.7" y2="-70.7" stroke-width="2.5"/>
<line x1="70.7" y1="-70.7" x2="70.7" y2="0" stroke-width="2" stroke-dasharray="5 4" stroke="#d6336c"/>
<line x1="0" y1="0" x2="70.7" y2="0" stroke-width="3" stroke="#1c7ed6"/>
<path d="M 28 0 A 28 28 0 0 0 19.8 -19.8" stroke-width="1.5"/>
<circle cx="70.7" cy="-70.7" r="4" fill="currentColor"/>
<text x="34" y="-8" fill="currentColor" stroke="none">θ</text>
<text x="80" y="-30" fill="#d6336c" stroke="none">sin θ</text>
<text x="18" y="18" fill="#1c7ed6" stroke="none">cos θ</text>
<text x="78" y="-84" fill="currentColor" stroke="none">(cos θ, sin θ)</text>
<text x="104" y="16" fill="currentColor" stroke="none">1</text>
</svg>`;

/** The area under a curve split into Riemann rectangles. */
const RIEMANN = `<svg viewBox="0 0 300 190" xmlns="http://www.w3.org/2000/svg" font-family="serif" font-size="14" fill="none" stroke="currentColor">
<line x1="20" y1="165" x2="290" y2="165" stroke-width="1"/><line x1="30" y1="175" x2="30" y2="10" stroke-width="1"/>
<g fill="#1c7ed6" fill-opacity="0.22" stroke="#1c7ed6" stroke-width="1">
<rect x="60" y="120" width="35" height="45"/><rect x="95" y="95" width="35" height="70"/><rect x="130" y="72" width="35" height="93"/>
<rect x="165" y="55" width="35" height="110"/><rect x="200" y="45" width="35" height="120"/>
</g>
<path d="M 40 150 Q 120 70 270 38" stroke-width="2.5"/>
<line x1="60" y1="165" x2="60" y2="170"/><line x1="235" y1="165" x2="235" y2="170"/>
<text x="56" y="184" fill="currentColor" stroke="none">a</text><text x="231" y="184" fill="currentColor" stroke="none">b</text>
<text x="250" y="30" fill="currentColor" stroke="none">y = f(x)</text>
<text x="105" y="160" fill="currentColor" stroke="none">Δx</text>
</svg>`;

export const ADVANCED: Record<string, Sample> = {
  // 1. logarithms: a definition box, laws as rows with Hebrew names, words before a formula, a graph
  log: {
    titleMd: "הלוגריתם הטבעי $\\ln x$",
    bodyMd: String.raw`> [!definition] לוגריתם
> לכל $x>0$: $\ln x$ הוא המספר $y$ שעבורו $e^{y} = x$, כלומר $\ln$ היא הפונקציה ההפוכה של $e^{x}$.

חוקי הלוגריתם, לכל $a, b > 0$ ולכל $r \in \R$:

` + "```rows\n" + String.raw`לוג של מכפלה | \ln(ab) = \ln a + \ln b
לוג של מנה | \ln\left(\frac{a}{b}\right) = \ln a - \ln b
לוג של חזקה | \ln\left(a^{r}\right) = r \ln a
החלפת בסיס | \log_{b} a = \frac{\ln a}{\ln b}
מונוטוניות | \text{לכל } 0<a<b: \ln a < \ln b
` + "```" + String.raw`

מהמונוטוניות נובע: $\ln x < 0 \iff 0 < x < 1$, ו-$x \to 0^{+} \Rightarrow \ln x \to -\infty$.`,
    sideMd: String.raw`$\ln 1 = 0$, $\ln e = 1$

שימו לב: $\ln(a+b) \neq \ln a + \ln b$!`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [-1, 5], yDomain: [-3, 5], grid: true, data: [{ fn: "log(x)", label: "ln x", range: [0.01, 5] }, { fn: "exp(x)", label: "e^x" }, { fn: "x", label: "y = x" }] }),
      captionMd: "$\\ln x$ ו-$e^{x}$ הן שיקוף זו של זו סביב הישר $y=x$",
    },
    progress: { n: 1, of: 5 },
  },
  // 2. trigonometry: a picture (unit circle) in the body, identities as rows, a plot of sin/cos beside
  trig: {
    titleMd: "סינוס וקוסינוס על מעגל היחידה",
    bodyMd: String.raw`נקודה על מעגל היחידה בזווית $\theta$ היא $(\cos\theta, \sin\theta)$:

` + "```svg\n" + UNIT_CIRCLE + "\n```" + String.raw`

` + "```rows\n" + String.raw`זהות פיתגורס | \sin^{2}\theta + \cos^{2}\theta = 1
זוגיות | \cos(-\theta) = \cos\theta, \quad \sin(-\theta) = -\sin\theta
זווית כפולה | \sin 2\theta = 2 \sin\theta \cos\theta
מחזוריות | \sin(\theta + 2\pi) = \sin\theta
` + "```" + String.raw`

אם $\sin\theta = 0$ וגם $0 \le \theta < 2\pi \Rightarrow \theta \in \{0, \pi\}$.`,
    sideMd: String.raw`רדיאנים: $\pi \text{ rad} = 180^{\circ}$`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [-6.3, 6.3], yDomain: [-1.6, 1.6], grid: true, data: [{ fn: "sin(x)", label: "sin x" }, { fn: "cos(x)", label: "cos x" }], annotations: [{ x: 3.14159, text: "π" }, { x: -3.14159, text: "−π" }] }),
      captionMd: "$\\sin$ ו-$\\cos$ מחזוריות עם מחזור $2\\pi$",
    },
    progress: { n: 2, of: 5 },
  },
  // 3. tan: a derivation with Hebrew reasons (some with math inside), asymptotes on the graph, a boxed result
  tan: {
    titleMd: "הנגזרת של $\\tan x$",
    bodyMd: String.raw`נגדיר $\tan x = \dfrac{\sin x}{\cos x}$ לכל $x \neq \frac{\pi}{2} + k\pi$, $k \in \Z$.

> [!proof]
> $$
> \begin{aligned}
> (\tan x)' &= \left(\frac{\sin x}{\cos x}\right)' && \text{הגדרה} \\
> &= \frac{\cos x \cdot \cos x - \sin x \cdot (-\sin x)}{\cos^{2} x} && \text{כלל המנה} \\
> &= \frac{\cos^{2} x + \sin^{2} x}{\cos^{2} x} && \text{פישוט} \\
> &= \frac{1}{\cos^{2} x} && \text{מ-} \sin^{2} x + \cos^{2} x = 1
> \end{aligned}
> $$

$$
\boxed{(\tan x)' = \frac{1}{\cos^{2} x} = 1 + \tan^{2} x}
$$

הנגזרת חיובית בכל תחום ההגדרה $\Rightarrow$ $\tan$ עולה בכל קטע $\left(-\frac{\pi}{2}, \frac{\pi}{2}\right)$.`,
    sideMd: String.raw`$\lim\limits_{x \to \frac{\pi}{2}^{-}} \tan x = +\infty$

לכן $x = \frac{\pi}{2}$ היא **אסימפטוטה אנכית**.`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [-4.5, 4.5], yDomain: [-5, 5], grid: true, data: [{ fn: "tan(x)", label: "tan x" }], annotations: [{ x: 1.5708, text: "π/2" }, { x: -1.5708, text: "−π/2" }] }),
      captionMd: "אסימפטוטות ב-$x = \\pm\\frac{\\pi}{2}$",
    },
    progress: { n: 3, of: 5 },
  },
  // 4. the definite integral: Riemann sums (a picture), the fundamental theorem, a sum and a limit, cases
  integral: {
    titleMd: "האינטגרל המסוים",
    bodyMd: String.raw`השטח מתחת ל-$f$ בקטע $[a,b]$ הוא גבול סכומי רימן:

` + "```svg\n" + RIEMANN + "\n```" + String.raw`

$$
\int_{a}^{b} f(x)\,dx = \lim_{n \to \infty} \sum_{i=1}^{n} f\left(x_{i}^{*}\right) \Delta x, \qquad \Delta x = \frac{b-a}{n}
$$

> [!theorem] המשפט היסודי של החשבון האינטגרלי
> אם $f$ רציפה ב-$[a,b]$ ו-$F' = f$, אז $\displaystyle\int_{a}^{b} f(x)\,dx = F(b) - F(a)$.

לדוגמה: $|x|$ אינה גזירה ב-$0$, אבל $\int_{-1}^{1} |x|\,dx = 1$ כי
$$
|x| = \begin{cases} x & x \ge 0 \\ -x & x < 0 \end{cases}
$$`,
    sideMd: String.raw`$\frac{d}{dx} \int_{a}^{x} f(t)\,dt = f(x)$

האינטגרל "מבטל" את הגזירה.`,
    figure: null,
    progress: { n: 4, of: 5 },
  },
  // 5. integration by parts with logs: a derivation, an underbrace note, implications in a Hebrew sentence, a graph
  parts: {
    titleMd: "אינטגרציה בחלקים: $\\int \\ln x\\,dx$",
    bodyMd: String.raw`הנוסחה: $\int u\,dv = uv - \int v\,du$. נבחר $u = \ln x$ ו-$dv = dx$:

` + "```rows\n" + String.raw`| u = \ln x \quad \text{ולכן } du = \frac{dx}{x}
| dv = dx \quad \text{ולכן } v = x
` + "```" + String.raw`

$$
\begin{aligned}
\int \ln x\,dx &= x \ln x - \int x \cdot \frac{1}{x}\,dx && \text{אינטגרציה בחלקים} \\
&= x \ln x - \int 1\,dx && \text{צמצום} \\
&= x \ln x - x + C && \text{אינטגרל של קבוע}
\end{aligned}
$$

$$
\int_{1}^{e} \ln x\,dx = \underbrace{\left[x \ln x - x\right]_{1}^{e}}_{\text{הצבת הגבולות}} = (e - e) - (0 - 1) = 1
$$

בדיקה: $\left(x\ln x - x\right)' = \ln x + 1 - 1 = \ln x$ $\Rightarrow$ התוצאה נכונה, ו-$\ln x > 0 \Rightarrow x > 1$.`,
    sideMd: String.raw`כלל **LIATE** לבחירת $u$:
לוגריתם, הפוכות, אלגבריות, טריגו', מעריכיות.`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [0, 3.2], yDomain: [-1.5, 1.5], grid: true, data: [{ fn: "log(x)", label: "ln x", range: [0.05, 3.2] }], annotations: [{ x: 1, text: "1" }, { x: 2.71828, text: "e" }] }),
      captionMd: "השטח מתחת ל-$\\ln x$ בין $1$ ל-$e$ שווה ל-$1$",
    },
    progress: { n: 5, of: 5 },
  },
};
