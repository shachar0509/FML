import type { StepData } from "./types";

/**
 * Test-host samples (?view=step&sample=…): advanced Hebrew lesson steps, as the tutor writes them, from אינפי 2 and
 * electrical engineering courses: mixed Hebrew and math, heavy notation, graphs and drawn pictures.
 */
type Sample = Pick<StepData, "titleMd" | "bodyMd" | "sideMd" | "figure" | "progress"> & Partial<Pick<StepData, "beats">>;

const plot = (o: object) => JSON.stringify(o);
const fence = (tag: string, body: string) => "```" + tag + "\n" + body + "\n```";

/** A series RLC circuit driven by a voltage source (a schematic, as the tutor draws one in svg). */
const RLC = `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg" font-family="serif" font-size="15" fill="none" stroke="currentColor" stroke-width="2">
<circle cx="40" cy="85" r="20"/><text x="35" y="80" fill="currentColor" stroke="none" font-size="13">+</text><text x="36" y="100" fill="currentColor" stroke="none" font-size="13">−</text>
<text x="0" y="128" fill="currentColor" stroke="none">v(t)</text>
<path d="M 40 65 V 25 H 80"/>
<path d="M 80 25 l 6 -9 l 12 18 l 12 -18 l 12 18 l 12 -18 l 6 9"/>
<text x="104" y="55" fill="currentColor" stroke="none">R</text>
<path d="M 140 25 H 160"/>
<path d="M 160 25 a 9 9 0 0 1 18 0 a 9 9 0 0 1 18 0 a 9 9 0 0 1 18 0 a 9 9 0 0 1 18 0"/>
<text x="190" y="50" fill="currentColor" stroke="none">L</text>
<path d="M 232 25 H 280 V 72"/>
<path d="M 262 72 H 298 M 262 98 H 298"/>
<text x="304" y="90" fill="currentColor" stroke="none">C</text>
<path d="M 280 98 V 145 H 40 V 105"/>
<path d="M 110 145 l 10 -5 v 10 z" fill="currentColor" stroke="none"/>
<text x="128" y="165" fill="currentColor" stroke="none">i(t)</text>
</svg>`;

/** The region between two circles in the plane (polar coordinates), shaded. */
const ANNULUS = `<svg viewBox="-120 -120 240 240" xmlns="http://www.w3.org/2000/svg" font-family="serif" font-size="14" fill="none" stroke="currentColor">
<path d="M -110 0 H 110 M 0 110 V -110" stroke-width="1"/>
<path fill="#1c7ed6" fill-opacity="0.22" stroke="#1c7ed6" stroke-width="2" fill-rule="evenodd" d="M 80 0 A 80 80 0 1 0 -80 0 A 80 80 0 1 0 80 0 Z M 40 0 A 40 40 0 1 1 -40 0 A 40 40 0 1 1 40 0 Z"/>
<path d="M 0 0 L 56.6 -56.6" stroke-width="2"/><text x="22" y="-34" fill="currentColor" stroke="none">r</text>
<path d="M 18 0 A 18 18 0 0 0 12.7 -12.7" stroke-width="1.5"/><text x="22" y="-4" fill="currentColor" stroke="none">θ</text>
<text x="34" y="16" fill="currentColor" stroke="none">1</text><text x="74" y="16" fill="currentColor" stroke="none">2</text>
<text x="-100" y="-90" fill="#1c7ed6" stroke="none">D</text>
</svg>`;

/** A closed curve C bounding a region D, oriented counter-clockwise. */
const GREEN = `<svg viewBox="0 0 260 180" xmlns="http://www.w3.org/2000/svg" font-family="serif" font-size="15" fill="none" stroke="currentColor">
<path d="M 40 100 C 30 40 120 10 170 30 C 230 55 240 120 190 150 C 140 175 55 160 40 100 Z" fill="#2f9e44" fill-opacity="0.18" stroke-width="2.5"/>
<path d="M 100 20 l -14 4 l 12 8" stroke-width="2.5"/><path d="M 150 165 l 14 -2 l -11 -9" stroke-width="2.5"/>
<text x="125" y="100" fill="currentColor" stroke="none">D</text>
<text x="215" y="45" fill="currentColor" stroke="none">C</text>
</svg>`;

/** A contract-formation timeline with Hebrew labels (Hebrew text inside an svg picture). */
const TIMELINE = `<svg viewBox="0 0 320 120" xmlns="http://www.w3.org/2000/svg" font-family="Rubik, sans-serif" font-size="13" fill="none" stroke="currentColor">
<path d="M 20 60 H 300" stroke-width="2"/><path d="M 300 60 l -10 -6 v 12 z" fill="currentColor" stroke="none"/>
<g fill="currentColor" stroke="none" text-anchor="middle">
<circle cx="45" cy="60" r="6"/><text x="45" y="40">משא ומתן</text><text x="45" y="88">סעיף 12</text>
<circle cx="125" cy="60" r="6"/><text x="125" y="40">הצעה</text><text x="125" y="88">סעיף 2</text>
<circle cx="200" cy="60" r="6"/><text x="200" y="40">קיבול</text><text x="200" y="88">סעיף 5</text>
<circle cx="270" cy="60" r="6"/><text x="270" y="40">חוזה</text><text x="270" y="88">כריתה</text>
</g>
<text x="160" y="112" fill="currentColor" stroke="none" text-anchor="middle" font-size="11">time →</text>
</svg>`;

/** Glycolysis to the Krebs cycle: compartments and arrows, Hebrew and Latin labels. */
const PATHWAY = `<svg viewBox="0 0 320 150" xmlns="http://www.w3.org/2000/svg" font-family="Rubik, sans-serif" font-size="13" fill="none" stroke="currentColor">
<rect x="6" y="20" width="140" height="110" rx="14" stroke-dasharray="5 4"/><text x="76" y="14" fill="currentColor" stroke="none" text-anchor="middle">ציטופלזמה</text>
<rect x="176" y="20" width="138" height="110" rx="40" stroke-width="2"/><text x="245" y="14" fill="currentColor" stroke="none" text-anchor="middle">מיטוכונדריה</text>
<g fill="currentColor" stroke="none" text-anchor="middle">
<text x="76" y="50">Glucose</text><text x="76" y="112">2 Pyruvate</text>
<text x="245" y="60">Acetyl-CoA</text><text x="245" y="105">Krebs</text>
</g>
<path d="M 76 58 V 95" stroke-width="2"/><path d="M 76 98 l -5 -9 h 10 z" fill="currentColor" stroke="none"/>
<text x="84" y="82" fill="#2f9e44" stroke="none" font-size="11">+2 ATP</text>
<path d="M 120 108 C 170 108 180 70 205 64" stroke-width="2"/><path d="M 207 63 l -10 -2 l 5 8 z" fill="currentColor" stroke="none"/>
<path d="M 245 68 V 90" stroke-width="2"/><path d="M 245 93 l -5 -9 h 10 z" fill="currentColor" stroke="none"/>
</svg>`;

/** Benzene: a hexagon with alternating double bonds. */
const BENZENE = `<svg viewBox="-80 -80 160 160" xmlns="http://www.w3.org/2000/svg" font-family="serif" font-size="14" fill="none" stroke="currentColor" stroke-width="2.5">
<path d="M 0 -60 L 52 -30 L 52 30 L 0 60 L -52 30 L -52 -30 Z"/>
<path d="M 8 -48 L 42 -28 M 42 24 L 8 44 M -42 24 L -42 -24"/>
<g fill="currentColor" stroke="none" text-anchor="middle"><text x="0" y="-66">H</text><text x="62" y="-34">H</text><text x="62" y="42">H</text><text x="0" y="78">H</text><text x="-62" y="42">H</text><text x="-62" y="-34">H</text></g>
</svg>`;

/** A floor plan at 1:100 with room names (Hebrew), dimensions and a door swing. */
const FLOORPLAN = `<svg viewBox="0 0 320 210" xmlns="http://www.w3.org/2000/svg" font-family="Rubik, sans-serif" font-size="12" fill="none" stroke="currentColor">
<rect x="20" y="20" width="280" height="150" stroke-width="5"/>
<path d="M 170 20 V 110 M 170 140 V 170 M 20 100 H 120 M 145 100 H 170" stroke-width="3"/>
<path d="M 120 100 A 25 25 0 0 1 145 75" stroke-width="1" stroke-dasharray="3 3"/>
<g fill="currentColor" stroke="none" text-anchor="middle">
<text x="95" y="62">סלון</text><text x="95" y="78" font-size="11">20.2 מ"ר</text>
<text x="95" y="140">מטבח</text><text x="235" y="98">חדר שינה</text><text x="235" y="114" font-size="11">14.4 מ"ר</text>
</g>
<path d="M 20 190 H 170 M 20 185 V 195 M 170 185 V 195" stroke-width="1"/><text x="95" y="205" fill="currentColor" stroke="none" text-anchor="middle">4.80</text>
<path d="M 310 20 V 170 M 305 20 H 315 M 305 170 H 315" stroke-width="1"/><text x="300" y="98" fill="currentColor" stroke="none" text-anchor="end">3.60</text>
<text x="300" y="14" fill="currentColor" stroke="none" text-anchor="end" font-size="11">1:100</text>
</svg>`;

/** M78 interactive slides: the figure's parts carry the beat that brings them in. */
const PARALLEL = `<svg viewBox="0 0 360 220" xmlns="http://www.w3.org/2000/svg" font-family="serif" font-size="14" fill="none" stroke="currentColor" stroke-width="2">
<circle cx="40" cy="110" r="20"/><text x="35" y="105" fill="currentColor" stroke="none" font-size="13">+</text><text x="36" y="124" fill="currentColor" stroke="none" font-size="13">−</text>
<text x="4" y="150" fill="currentColor" stroke="none">12V</text>
<path d="M 40 90 V 30 H 280 V 80 M 180 30 V 80 M 180 140 V 190 M 280 140 V 190 M 40 130 V 190 H 280"/>
<g class="m-blue" data-focus="1"><path d="M 180 80 l 9 5 l -18 10 l 18 10 l -18 10 l 18 10 l -18 10 l 9 5"/><text x="196" y="104" fill="currentColor" stroke="none">R₁=4Ω</text></g>
<g class="m-green" data-focus="1"><path d="M 280 80 l 9 5 l -18 10 l 18 10 l -18 10 l 18 10 l -18 10 l 9 5"/><text x="296" y="104" fill="currentColor" stroke="none">R₂=12Ω</text></g>
<g data-beat="1" fill="currentColor" stroke="none" font-size="13"><text x="196" y="124">12V</text><text x="296" y="124">12V</text></g>
<g data-beat="2" data-focus="2"><path class="flow" d="M 40 90 V 30 H 180"/><text x="70" y="22" fill="currentColor" stroke="none">I=4A</text></g>
<g data-beat="3" class="m-blue"><path class="flow" d="M 180 30 V 80"/><text x="186" y="62" fill="currentColor" stroke="none" font-size="13">I₁=3A</text></g>
<g data-beat="3" class="m-green"><path class="flow" d="M 180 30 H 280 V 80"/><text x="286" y="62" fill="currentColor" stroke="none" font-size="13">I₂=1A</text></g>
</svg>`;

const PHOTO = `<svg viewBox="0 0 360 230" xmlns="http://www.w3.org/2000/svg" font-family="serif" font-size="15" fill="none" stroke="currentColor" stroke-width="2">
<rect x="110" y="50" width="140" height="120" rx="24"/>
<g class="m-green"><ellipse cx="180" cy="110" rx="42" ry="22" fill="currentColor" fill-opacity="0.2"/><path d="M 150 110 h 60 M 158 102 h 44 M 158 118 h 44" stroke-width="1.5"/></g>
<g data-beat="1" class="m-orange"><path class="pulse" d="M 150 4 l 12 34 M 180 2 v 36 M 210 4 l -12 34"/><text x="225" y="22" fill="currentColor" stroke="none">hν</text></g>
<g data-beat="2" data-until="3" class="m-blue"><g class="drift" style="--dx:95;--dy:0"><text x="10" y="100" fill="currentColor" stroke="none">CO₂</text></g><path d="M 50 120 h 48 l -8 -5 m 8 5 l -8 5"/></g>
<g data-beat="3" data-until="3"><g class="drift" style="--dx:0;--dy:-48"><text x="164" y="222" fill="currentColor" stroke="none">H₂O</text></g></g>
<g data-beat="5" class="m-pink"><g class="drift" style="--dx:80;--dy:0"><text x="262" y="100" fill="currentColor" stroke="none">O₂</text></g><path d="M 262 120 h 48 l -8 -5 m 8 5 l -8 5"/></g>
<g data-beat="4"><text x="180" y="155" fill="currentColor" stroke="none" font-size="12" text-anchor="middle">C₆H₁₂O₆</text></g>
</svg>`;

const CELL = `<svg viewBox="0 0 360 230" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="14" fill="none" stroke="currentColor" stroke-width="2">
<ellipse cx="160" cy="115" rx="140" ry="95"/><text x="320" y="30" fill="currentColor" stroke="none" text-anchor="middle">קרום</text><path d="M 300 38 L 272 58" stroke-width="1"/>
<g data-beat="1" data-focus="1" class="m-blue"><circle cx="150" cy="110" r="34" fill="currentColor" fill-opacity="0.22"/><circle cx="158" cy="104" r="9" fill="currentColor" fill-opacity="0.5"/><text x="150" y="160" fill="currentColor" stroke="none" text-anchor="middle">גרעין</text></g>
<g data-beat="2" data-focus="2" class="m-green"><g fill="currentColor" fill-opacity="0.2"><ellipse cx="240" cy="80" rx="26" ry="12" transform="rotate(-20 240 80)"/><ellipse cx="235" cy="150" rx="26" ry="12" transform="rotate(15 235 150)"/><ellipse cx="75" cy="150" rx="22" ry="10" transform="rotate(25 75 150)"/></g><path d="M 220 84 q 6 -10 12 0 t 12 0 t 12 0 M 216 148 q 6 -10 12 0 t 12 0 t 12 0" stroke-width="1.5"/><text x="240" y="122" fill="currentColor" stroke="none" text-anchor="middle">מיטוכונדריה</text></g>
<g data-beat="3" data-focus="3" class="m-pink" fill="currentColor" stroke="none"><circle cx="95" cy="70" r="3"/><circle cx="108" cy="62" r="3"/><circle cx="85" cy="85" r="3"/><circle cx="205" cy="190" r="3"/><circle cx="190" cy="180" r="3"/><circle cx="220" cy="183" r="3"/><text x="88" y="52" text-anchor="middle">ריבוזומים</text></g>
</svg>`;

export const ADVANCED: Record<string, Sample> = {
  // אינפי 2 — Taylor: the polynomial and its remainder, approximations on a graph
  taylor: {
    titleMd: "טור טיילור ושארית לגרנז'",
    bodyMd: String.raw`> [!theorem] טיילור עם שארית לגרנז'
> אם $f$ גזירה $n+1$ פעמים בסביבה של $x_0$, אז לכל $x$ בסביבה קיימת $c$ בין $x_0$ ל-$x$ כך ש:
> $$
> f(x) = \sum_{k=0}^{n} \frac{f^{(k)}(x_0)}{k!}(x-x_0)^{k} + \frac{f^{(n+1)}(c)}{(n+1)!}(x-x_0)^{n+1}
> $$

טורי מקלורן שכדאי לזכור:

` + fence("rows", String.raw`אקספוננט | e^{x} = \sum_{k=0}^{\infty} \frac{x^{k}}{k!}
סינוס | \sin x = \sum_{k=0}^{\infty} \frac{(-1)^{k} x^{2k+1}}{(2k+1)!}
לוגריתם | \ln(1+x) = \sum_{k=1}^{\infty} \frac{(-1)^{k+1}}{k} x^{k} \quad (\text{עבור } -1 < x \le 1)`) + String.raw`

הערכת השגיאה: $|\sin x - T_3(x)| \le \frac{|x|^{5}}{5!}$, ולכן עבור $|x| \le 0.5$ השגיאה קטנה מ-$3 \cdot 10^{-4}$.`,
    sideMd: String.raw`$T_n$ מתלכד עם $f$ עד הנגזרת ה-$n$ ב-$x_0$.`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [-4, 4], yDomain: [-2, 2], grid: true, data: [{ fn: "sin(x)", label: "sin x" }, { fn: "x", label: "T1" }, { fn: "x - x^3/6", label: "T3" }, { fn: "x - x^3/6 + x^5/120", label: "T5" }] }),
      captionMd: "$T_1, T_3, T_5$ מתקרבים ל-$\\sin x$ ככל ש-$n$ גדל",
    },
    progress: { n: 1, of: 9 },
  },
  // אינפי 2 — power series: radius of convergence, the cases as rows, a worked example with reasons
  series: {
    titleMd: "טורי חזקות ורדיוס התכנסות",
    bodyMd: String.raw`לטור $\sum_{n=0}^{\infty} a_n (x-x_0)^{n}$ יש רדיוס התכנסות $R \in [0, \infty]$:

$$
\frac{1}{R} = \limsup_{n \to \infty} \sqrt[n]{|a_n|} \qquad (\text{קושי–הדמר})
$$

` + fence("rows", String.raw`בתוך הקטע | |x - x_0| < R \Rightarrow \text{הטור מתכנס בהחלט}
מחוץ לקטע | |x - x_0| > R \Rightarrow \text{הטור מתבדר}
בקצוות | |x - x_0| = R \quad \text{בודקים בנפרד}`) + String.raw`

> [!example] $\sum \frac{x^{n}}{n \, 2^{n}}$
> $$
> \begin{aligned}
> \lim_{n\to\infty} \left| \frac{a_{n+1}}{a_n} \right| &= \lim_{n\to\infty} \frac{n \, 2^{n}}{(n+1) \, 2^{n+1}} && \text{מבחן המנה} \\
> &= \frac{1}{2} && \text{כי } \frac{n}{n+1} \to 1
> \end{aligned}
> $$
> לכן $R = 2$. ב-$x = 2$ מתקבל הטור ההרמוני (מתבדר), וב-$x=-2$ טור לייבניץ (מתכנס): תחום ההתכנסות $[-2, 2)$.`,
    sideMd: String.raw`**מבחן M של ויירשטראס:** אם $|f_n(x)| \le M_n$ ו-$\sum M_n < \infty$ אז $\sum f_n$ מתכנס במידה שווה.`,
    figure: null,
    progress: { n: 2, of: 9 },
  },
  // אינפי 2 — several variables: gradient, directional derivative, Hessian (a matrix), classifying critical points
  gradient: {
    titleMd: "גרדיאנט, הסיאן ונקודות קיצון",
    bodyMd: String.raw`לפונקציה $f: \R^{2} \to \R$ הגרדיאנט הוא $\nabla f = \left( \frac{\partial f}{\partial x}, \frac{\partial f}{\partial y} \right)$, והנגזרת הכיוונית בכיוון וקטור יחידה $\hat{u}$ היא $D_{\hat{u}} f = \nabla f \cdot \hat{u}$.

מטריצת ההסיאן:
$$
H_f(x,y) = \begin{pmatrix} f_{xx} & f_{xy} \\ f_{yx} & f_{yy} \end{pmatrix}, \qquad \det H = f_{xx} f_{yy} - f_{xy}^{2}
$$

בנקודה קריטית ($\nabla f = \vec{0}$):

` + fence("rows", String.raw`מינימום מקומי | \det H > 0 \;\wedge\; f_{xx} > 0
מקסימום מקומי | \det H > 0 \;\wedge\; f_{xx} < 0
נקודת אוכף | \det H < 0
לא ניתן להכריע | \det H = 0`) + String.raw`

דוגמה: $f = x^{2} - y^{2}$ ב-$(0,0)$: $\det H = -4 < 0 \Rightarrow$ נקודת אוכף.`,
    sideMd: String.raw`$\nabla f$ מצביע לכיוון העלייה המהירה ביותר, ו-$|\nabla f|$ הוא קצב העלייה.`,
    figure: {
      kind: "geometry",
      source: plot({
        boundingBox: [-3, 3, 3, -3], axis: true, grid: false,
        elements: [
          { type: "point", id: "O", x: 0, y: 0 },
          { type: "circle", center: "O", radius: 1 }, { type: "circle", center: "O", radius: 2 }, { type: "circle", center: "O", radius: 2.8, dashed: true },
          { type: "point", id: "P", x: 1.41, y: 1.41, label: "P" },
          { type: "arrow", from: "P", to: [2.4, 2.4], label: "∇f" },
        ],
      }),
      captionMd: "קווי גובה של $f = x^{2} + y^{2}$; הגרדיאנט ניצב להם",
    },
    progress: { n: 3, of: 9 },
  },
  // אינפי 2 — double integrals: polar coordinates, the Jacobian (a determinant), Fubini, a drawn region
  double: {
    titleMd: "אינטגרל כפול בקואורדינטות קוטביות",
    bodyMd: String.raw`נחשב $\iint_D (x^{2}+y^{2})\,dA$ כאשר $D = \{ (x,y) : 1 \le x^{2}+y^{2} \le 4 \}$:

` + fence("svg", ANNULUS) + String.raw`

החלפת משתנים $x = r\cos\theta$, $y = r\sin\theta$ עם היעקוביאן
$$
\left| \frac{\partial(x,y)}{\partial(r,\theta)} \right| = \left| \det \begin{pmatrix} \cos\theta & -r\sin\theta \\ \sin\theta & r\cos\theta \end{pmatrix} \right| = r
$$

$$
\begin{aligned}
\iint_D (x^{2}+y^{2})\,dA &= \int_{0}^{2\pi} \int_{1}^{2} r^{2} \cdot r \, dr \, d\theta && \text{החלפת משתנים} \\
&= 2\pi \left[ \frac{r^{4}}{4} \right]_{1}^{2} && \text{פוביני} \\
&= \frac{15\pi}{2}
\end{aligned}
$$`,
    sideMd: String.raw`לא לשכוח את $r$ ב-$dA = r\,dr\,d\theta$!`,
    figure: null,
    progress: { n: 4, of: 9 },
  },
  // אינפי 2 — line integrals and Green's theorem: ∮, ∬, a curve picture, a worked example
  green: {
    titleMd: "משפט גרין",
    bodyMd: String.raw`> [!theorem] גרין
> אם $C$ עקומה סגורה פשוטה וחלקה למקוטעין, בכיוון החיובי (נגד כיוון השעון), החוסמת תחום $D$, ו-$P, Q$ בעלות נגזרות חלקיות רציפות, אז
> $$
> \oint_{C} P\,dx + Q\,dy = \iint_{D} \left( \frac{\partial Q}{\partial x} - \frac{\partial P}{\partial y} \right) dA
> $$

` + fence("svg", GREEN) + String.raw`

מסקנה — שטח בעזרת אינטגרל קווי: $\text{Area}(D) = \frac{1}{2} \oint_{C} x\,dy - y\,dx$.

לדוגמה, עבור האליפסה $x = a\cos t$, $y = b\sin t$, $t \in [0, 2\pi]$ מקבלים $\text{Area} = \frac{1}{2}\int_{0}^{2\pi} ab\,dt = \pi a b$.`,
    sideMd: String.raw`אם $\frac{\partial Q}{\partial x} = \frac{\partial P}{\partial y}$ בתחום פשוט קשר, השדה **משמר** והאינטגרל לא תלוי במסלול.`,
    figure: null,
    progress: { n: 5, of: 9 },
  },
  // EE — circuits: a schematic, KVL as an integro-differential equation, damping cases, the step response
  rlc: {
    titleMd: "מעגל RLC טורי",
    bodyMd: fence("svg", RLC) + String.raw`

לפי חוק המתחים של קירכהוף (KVL), סכום המתחים בלולאה הוא אפס:
$$
L\frac{di}{dt} + R\,i + \frac{1}{C}\int_{-\infty}^{t} i(\tau)\,d\tau = v(t)
$$

גוזרים ומחלקים ב-$L$; המשוואה האופיינית היא $s^{2} + \frac{R}{L}s + \frac{1}{LC} = 0$, עם
$$
\alpha = \frac{R}{2L}, \qquad \omega_0 = \frac{1}{\sqrt{LC}}
$$

` + fence("rows", String.raw`ריסון יתר | \alpha > \omega_0 \Rightarrow s_{1,2} \in \R
ריסון קריטי | \alpha = \omega_0 \Rightarrow s_1 = s_2 = -\alpha
תת-ריסון | \alpha < \omega_0 \Rightarrow s_{1,2} = -\alpha \pm j\omega_d`) + String.raw`

כאשר $\omega_d = \sqrt{\omega_0^{2} - \alpha^{2}}$: במצב תת-ריסון הזרם מתנדנד ודועך כמו $e^{-\alpha t}\cos(\omega_d t)$.`,
    sideMd: String.raw`$Q = \frac{\omega_0}{2\alpha} = \frac{1}{R}\sqrt{\frac{L}{C}}$ — מקדם האיכות.`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [0, 10], yDomain: [-0.2, 1.8], grid: true, data: [{ fn: "1 - exp(-0.4*x)*cos(2*x)", label: "תת-ריסון" }, { fn: "1 - (1 + x)*exp(-x)", label: "ריסון קריטי" }] }),
      captionMd: "תגובת המדרגה של המתח על הקבל",
    },
    progress: { n: 6, of: 9 },
  },
  // EE — signals: the Fourier transform pair, its properties as rows, a transform pair with a graph (sinc)
  fourier: {
    titleMd: "התמרת פורייה",
    bodyMd: String.raw`$$
X(j\omega) = \int_{-\infty}^{\infty} x(t)\, e^{-j\omega t}\, dt, \qquad x(t) = \frac{1}{2\pi}\int_{-\infty}^{\infty} X(j\omega)\, e^{j\omega t}\, d\omega
$$

תכונות עיקריות (עבור $x(t) \leftrightarrow X(j\omega)$):

` + fence("rows", String.raw`הזזה בזמן | x(t - t_0) \leftrightarrow e^{-j\omega t_0} X(j\omega)
גזירה | \frac{dx}{dt} \leftrightarrow j\omega\, X(j\omega)
קונבולוציה | (x * h)(t) \leftrightarrow X(j\omega)\, H(j\omega)
פרסבל | \int_{-\infty}^{\infty} |x(t)|^{2} dt = \frac{1}{2\pi}\int_{-\infty}^{\infty} |X(j\omega)|^{2} d\omega`) + String.raw`

> [!example] פולס מלבני
> $x(t) = \operatorname{rect}\left(\frac{t}{T}\right) \leftrightarrow X(j\omega) = T \operatorname{sinc}\left(\frac{\omega T}{2\pi}\right)$: ככל שהפולס **צר** יותר בזמן, הספקטרום **רחב** יותר.`,
    sideMd: String.raw`מערכת LTI: $y = x * h \;\Rightarrow\; Y = X \cdot H$`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [-15, 15], yDomain: [-0.4, 1.2], grid: true, data: [{ fn: "sin(x)/x", label: "sinc" }] }),
      captionMd: "הספקטרום של פולס מלבני ($T = 2$)",
    },
    progress: { n: 7, of: 9 },
  },
  // EE — control: a transfer function, its pole, a Bode magnitude plot with its asymptote
  bode: {
    titleMd: "דיאגרמת בודה של מסנן מעביר נמוכים",
    bodyMd: String.raw`למסנן RC מסדר ראשון פונקציית התמסורת היא
$$
H(s) = \frac{1}{1 + s/\omega_c}, \qquad \omega_c = \frac{1}{RC}
$$

ב-$s = j\omega$: $|H(j\omega)|_{\text{dB}} = 20\log_{10}|H(j\omega)| = -10 \log_{10}\left(1 + \left(\frac{\omega}{\omega_c}\right)^{2}\right)$

` + fence("rows", String.raw`תדרים נמוכים | \omega \ll \omega_c \Rightarrow |H|_{\text{dB}} \approx 0
תדר הברך | \omega = \omega_c \Rightarrow |H|_{\text{dB}} = -3 \text{ dB}, \quad \angle H = -45^{\circ}
תדרים גבוהים | \omega \gg \omega_c \Rightarrow \text{שיפוע } -20 \text{ dB/decade}`) + String.raw`

הקוטב היחיד $s = -\omega_c$ נמצא בחצי המישור השמאלי $\Rightarrow$ המערכת יציבה.`,
    sideMd: String.raw`עשור = פי $10$ בתדר; ב-$-20$ dB/decade ההגבר קטן פי $10$ בכל עשור.`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [-2, 2], yDomain: [-45, 5], grid: true, data: [{ fn: "-10*log(1 + 10^(2*x))/log(10)", label: "|H| dB" }, { fn: "-20*x", label: "אסימפטוטה", range: [0, 2] }], annotations: [{ x: 0, text: "ωc" }, { y: -3, text: "−3 dB" }] }),
      captionMd: "ציר $x$: $\\log_{10}(\\omega/\\omega_c)$",
    },
    progress: { n: 8, of: 9 },
  },
  // EE — electromagnetics: Maxwell's equations (∇·, ∇×, ∂/∂t) as named rows, the integral form, the wave equation
  maxwell: {
    titleMd: "משוואות מקסוול",
    bodyMd: String.raw`בצורה הדיפרנציאלית, בתווך עם צפיפות מטען $\rho$ וצפיפות זרם $\vec{J}$:

` + fence("rows", String.raw`חוק גאוס | \nabla \cdot \vec{E} = \frac{\rho}{\varepsilon_0}
גאוס למגנטיות | \nabla \cdot \vec{B} = 0
חוק פאראדיי | \nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}
אמפר–מקסוול | \nabla \times \vec{B} = \mu_0 \vec{J} + \mu_0 \varepsilon_0 \frac{\partial \vec{E}}{\partial t}`) + String.raw`

בצורה האינטגרלית, למשל חוק פאראדיי: $\oint_{\partial S} \vec{E} \cdot d\vec{\ell} = -\frac{d}{dt} \iint_{S} \vec{B} \cdot d\vec{S}$ (שטף משתנה $\Rightarrow$ כא"מ מושרה).

> [!proof] משוואת הגלים בריק
> $$
> \begin{aligned}
> \nabla \times (\nabla \times \vec{E}) &= -\frac{\partial}{\partial t}(\nabla \times \vec{B}) && \text{פאראדיי} \\
> \nabla(\nabla \cdot \vec{E}) - \nabla^{2}\vec{E} &= -\mu_0\varepsilon_0 \frac{\partial^{2} \vec{E}}{\partial t^{2}} && \text{אמפר–מקסוול, } \vec{J} = 0 \\
> \nabla^{2}\vec{E} &= \frac{1}{c^{2}} \frac{\partial^{2} \vec{E}}{\partial t^{2}} && \text{גאוס, } \rho = 0
> \end{aligned}
> $$`,
    sideMd: String.raw`$c = \frac{1}{\sqrt{\mu_0 \varepsilon_0}} \approx 3 \cdot 10^{8} \ \text{m/s}$ — האור הוא גל אלקטרומגנטי.`,
    figure: null,
    progress: { n: 9, of: 9 },
  },
  // Law — statute quotes, nested citations, English case names, §, percentages, a table, text arrows, a Hebrew-labelled picture
  // "$$" on the same line as \begin / \end (e2e/shots/display alignment problems/image.png showed KaTeX's raw-source error)
  fences: {
    titleMd: "יחידות האיבר הנגדי",
    bodyMd: String.raw`נניח $a + b = 0$ וגם $a + c = 0$. נראה ש-$b = c$.

> [!proof]
> $$\begin{aligned}
> b &= b + 0 && \text{(איבר האפס)} \\
> &= b + (a + c) && \text{(הנחה: } a + c = 0\text{)} \\
> &= (b + a) + c && \text{(קיבוץ)} \\
> &= 0 + c && \text{(הנחה: } a + b = 0\text{)} \\
> &= c && \text{(איבר האפס וחילוף)}
> \end{aligned}$$.

$$\begin{cases}
-x & \text{אם } x < 0 \\
x & \text{אחרת}
\end{cases}$$ היא ההגדרה של $|x|$, ובלי עברית:

$$\begin{aligned}
(a+b)^{2} &= (a+b)(a+b) \\
&= a^{2} + 2ab + b^{2}
\end{aligned}$$`,
    sideMd: null,
    figure: null,
    progress: { n: 1, of: 9 },
  },
  law: {
    titleMd: "תום לב במשא ומתן — סעיף 12 לחוק החוזים",
    bodyMd: String.raw`> [!definition] סעיף 12(א) לחוק החוזים (חלק כללי), התשל"ג–1973
> "במשא ומתן לקראת כריתתו של חוזה חייב אדם לנהוג בדרך מקובלת ובתום לב."

` + fence("svg", TIMELINE) + String.raw`

שלבי הכריתה: משא ומתן → הצעה → קיבול → חוזה מחייב. החובה לפי סעיף 12 חלה **לפני** הכריתה, ולכן התרופה היא פיצויי הסתמכות (סעיף 12(ב)), ולא פיצויי קיום.

1. **הלכת פנידר** — ע"א 230/80 *פנידר נ' קסטרו*, פ"ד לה(2) 713 (1981): ניהול משא ומתן מקביל בהסתרה מפר את חובת תום הלב.
2. במשפט האנגלי, לעומת זאת, *Walford v Miles* [1992] 2 AC 128 (HL) קבע שאין חובה כללית לנהל משא ומתן בתום לב.
   - (א) הסכם "lock-out" תקף רק לתקופה מוגדרת;
   - (ב) ראו גם UCC § 1-304 בארה"ב.

| שיטה | מקור החובה | תרופה עיקרית |
|---|---|---|
| ישראל | סעיפים 12 ו-39 | פיצויי הסתמכות (לעיתים קיום) |
| אנגליה | אין חובה כללית | אין, למעט מצג שווא |
| ארה"ב | UCC § 1-304 | לפי המדינה |

בפסיקה נפסקו פיצויים של עד 50% מהנזק הנטען (ראו: ע"א 6370/00 *קל בניין*, פ"ד נו(3) 289).`,
    sideMd: String.raw`סעיף 39: חיוב הנובע **מחוזה** יש לקיים בדרך מקובלת ובתום לב — גם **אחרי** הכריתה.`,
    figure: null,
    progress: { n: 1, of: 5 },
  },
  // Biology — pathway arrows in Hebrew, \ce, sequences, Greek letters, Michaelis–Menten with a graph, a yield table
  biology: {
    titleMd: "נשימה תאית: גליקוליזה ומעגל קרבס",
    bodyMd: String.raw`` + fence("svg", PATHWAY) + String.raw`

המסלול: גלוקוז → פירובט → אצטיל-CoA → מעגל קרבס → שרשרת העברת אלקטרונים. בתנאים אנאירוביים: פירובט → לקטט (NADH → NAD⁺).

המשוואה הכוללת:
$$
\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}, \qquad \Delta G^{\circ\prime} = -2870 \ \text{kJ/mol}
$$

קצב האנזים הקובע (הקסוקינאז) לפי מיכאליס–מנטן: $v = \dfrac{V_{\max}[S]}{K_M + [S]}$, ו-$[S] = K_M \Rightarrow v = \frac{1}{2}V_{\max}$.

| שלב | מיקום | ATP נטו | NADH |
|---|---|---|---|
| גליקוליזה | ציטופלזמה | 2 | 2 |
| מעגל קרבס (×2) | מטריקס | 2 | 6 |
| זרחון חמצוני | ממברנה פנימית | ~26–28 | — |

הגן *HK1* מקודד את האנזים; רצף ההתחלה הוא ` + "`5'-ATG-3'`" + String.raw`, ומבנה ה-α-helix שבו מייצב את האתר הפעיל.`,
    sideMd: String.raw`$K_M$ קטן $\Rightarrow$ זיקה **גבוהה** לסובסטרט.`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [0, 10], yDomain: [0, 1.1], grid: true, data: [{ fn: "x/(1+x)", label: "v/Vmax" }], annotations: [{ x: 1, text: "K_M" }, { y: 0.5, text: "½ Vmax" }] }),
      captionMd: "קצב התגובה כפונקציה של $[S]$",
    },
    progress: { n: 2, of: 5 },
  },
  // Chemistry — \ce equilibria with charges and states, K and pH, Hess's law as a derivation, an ICE table, a molecule
  chemistry: {
    titleMd: "שיווי משקל כימי ועקרון לה-שטלייה",
    bodyMd: String.raw`תהליך הבר: $\ce{N2(g) + 3H2(g) <=> 2NH3(g)}$, $\Delta H^{\circ} = -92 \ \text{kJ/mol}$.

$$
K_c = \frac{[\ce{NH3}]^{2}}{[\ce{N2}]\,[\ce{H2}]^{3}}
$$

לפי עקרון לה-שטלייה:

` + fence("rows", String.raw`הגדלת לחץ | \text{שיווי המשקל זז ימינה} \quad (4 \to 2 \text{ מול})
העלאת טמפרטורה | K_c \downarrow \quad \text{(תגובה אקסותרמית)}
הוספת זרז | \text{אין שינוי ב-} K_c`) + String.raw`

> [!example] חוק הס
> $$
> \begin{aligned}
> \ce{C(s) + O2(g) &-> CO2(g)} && \Delta H_1 = -393.5 \\
> \ce{CO(g) + 1/2 O2(g) &-> CO2(g)} && \Delta H_2 = -283.0 \\
> \Delta H_{\ce{C -> CO}} &= \Delta H_1 - \Delta H_2 = -110.5 \ \text{kJ} && \text{חיסור המשוואות}
> \end{aligned}
> $$

חומצה חלשה: $\ce{CH3COOH <=> CH3COO- + H+}$, $K_a = 1.8 \cdot 10^{-5}$, ו-$\text{pH} = -\log_{10}[\ce{H+}]$; ב-25°C מים טהורים: $\text{pH} = 7$.

| | $\ce{N2}$ | $\ce{H2}$ | $\ce{NH3}$ |
|---|---|---|---|
| התחלה (M) | 1.0 | 3.0 | 0 |
| שינוי | $-x$ | $-3x$ | $+2x$ |
| שיווי משקל | $1-x$ | $3-3x$ | $2x$ |

` + fence("svg", BENZENE),
    sideMd: String.raw`יונים: $\ce{SO4^2-}$, $\ce{Fe^3+}$, $\ce{[Cu(NH3)4]^2+}$`,
    figure: null,
    progress: { n: 3, of: 5 },
  },
  // Finance — $ and ₪ amounts next to formulas, percentages, Σ, NPV/IRR, Black-Scholes, a cash-flow table, a graph
  finance: {
    titleMd: "ערך נוכחי נקי (NPV) ושיעור תשואה פנימי",
    bodyMd: String.raw`פרויקט דורש השקעה של $1,000 היום ומניב $400 בכל שנה במשך 3 שנים. בשער של 3.7 ₪ לדולר, ההשקעה היא 3,700 ₪.

$$
NPV = -C_0 + \sum_{t=1}^{T} \frac{CF_t}{(1+r)^{t}}
$$

` + fence("rows", String.raw`r = 5\% | NPV = -1000 + \frac{400}{1.05} + \frac{400}{1.05^{2}} + \frac{400}{1.05^{3}} \approx 89.3
r = 10\% | NPV \approx -5.3 \quad \text{(שלילי: לדחות)}
IRR | NPV(r^{*}) = 0 \Rightarrow r^{*} \approx 9.7\%`) + String.raw`

| שנה | תזרים ($) | מקדם היוון ב-5% | ערך נוכחי ($) |
|---|---|---|---|
| 0 | −1,000 | 1.000 | −1,000.0 |
| 1 | 400 | 0.952 | 380.9 |
| 2 | 400 | 0.907 | 362.8 |
| 3 | 400 | 0.864 | 345.5 |

אם המחיר יורד מ-$120 ל-$100, התשואה היא −16.7%. מודל בלק–שולס לאופציית רכש:
$$
C = S_0 N(d_1) - K e^{-rT} N(d_2), \qquad d_{1,2} = \frac{\ln(S_0/K) + (r \pm \sigma^{2}/2)T}{\sigma\sqrt{T}}
$$`,
    sideMd: String.raw`$NPV > 0 \Rightarrow$ הפרויקט מגדיל את ערך החברה. מינוף 1:10 מגדיל גם את הסיכון פי 10.`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [0, 0.2], yDomain: [-250, 250], grid: true, data: [{ fn: "-1000 + 400/(1+x) + 400/(1+x)^2 + 400/(1+x)^3", label: "NPV" }], annotations: [{ x: 0.097, text: "IRR" }, { y: 0 }] }),
      captionMd: "$NPV$ כפונקציה של שער ההיוון $r$",
    },
    progress: { n: 4, of: 5 },
  },
  // Architecture — a floor plan (Hebrew rooms, dimensions, scale), areas, ×, a beam formula, a moment graph, materials table
  architecture: {
    titleMd: "תוכנית קומה וחישוב קורה",
    bodyMd: String.raw`` + fence("svg", FLOORPLAN) + String.raw`

התוכנית בקנה מידה 1:100; הדירה 4.80 × 3.60 מ' (שטח 17.3 מ"ר ברוטו לכל מפלס). פתח הדלת 0.90 מ', נפתח ב-90°.

קורת בטון בטווח $L = 4.8 \ \text{m}$ תחת עומס אחיד $w = 12 \ \text{kN/m}$:

` + fence("rows", String.raw`מומנט מרבי | M_{\max} = \frac{w L^{2}}{8} = \frac{12 \cdot 4.8^{2}}{8} = 34.6 \ \text{kN}\cdot\text{m}
כוח גזירה | V_{\max} = \frac{wL}{2} = 28.8 \ \text{kN}
שקיעה | \delta_{\max} = \frac{5 w L^{4}}{384 E I} \le \frac{L}{250}`) + String.raw`

| חומר | חוזק (MPa) | צפיפות (kg/m³) | הערה |
|---|---|---|---|
| בטון B30 | 30 | 2,400 | ת"י 466 |
| פלדה S355 | 355 | 7,850 | זיון ראשי Ø16 |
| עץ GL24h | 24 | 420 | קורות למינציה |

כיוון הבניין: חזית ראשית לצפון (N), חלונות דרומיים → הצללה בקיץ.`,
    sideMd: String.raw`בדיקת שקיעה: $\frac{L}{250} = \frac{4800}{250} = 19.2 \ \text{mm}$.`,
    figure: {
      kind: "plot",
      source: plot({ xDomain: [0, 4.8], yDomain: [0, 40], grid: true, data: [{ fn: "12*x*(4.8-x)/2", label: "M(x)" }], annotations: [{ x: 2.4, text: "L/2" }] }),
      captionMd: "דיאגרמת מומנטים: $M(x) = \\frac{w x (L-x)}{2}$",
    },
    progress: { n: 5, of: 5 },
  },
  // M78 interactive slides (beats): a function investigation built on a graph, step by step
  beatsFn: {
    titleMd: String.raw`חקירת $f(x) = x^2 - 2x + 1$`,
    bodyMd: "נמצא את נקודת הקיצון, את כיוון הפתיחה ואת הסימטריה.",
    beats: [
      { md: String.raw`**נגזרת:** $f'(x) = 2x - 2$` },
      { md: String.raw`נשווה לאפס: $2x - 2 = 0 \;\Rightarrow\; x = 1$` },
      { md: String.raw`נציב: $f(1) = 1 - 2 + 1 = 0$, לכן נקודת הקיצון היא $\blue{(1,0)}$.` },
      { md: String.raw`**נגזרת שנייה:**
` + fence("rows", String.raw`נגזרת שנייה | f''(x) = 2 > 0`) },
      { md: String.raw`לכן הפרבולה **פתוחה כלפי מעלה**, ו-$(1,0)$ היא **מינימום**.`, sideMd: String.raw`$a = 1 > 0$ — אותה מסקנה ישר מהמקדם.` },
      { md: String.raw`**חיתוך עם ציר $y$:** $f(0) = 1$` },
      { md: String.raw`הגרף סימטרי סביב $x = 1$, לכן גם $f(2) = 1$:
$$
f(x) = (x-1)^2 \ge 0
$$` },
    ],
    sideMd: null,
    figure: {
      kind: "geometry",
      source: plot({ boundingBox: [-1.5, 4.5, 3.5, -1], axis: true, elements: [
        { type: "point", id: "V", x: 1, y: 0, label: "(1,0)", beat: 3, color: "blue" },
        { type: "curve", fn: "x^2-2*x+1", domain: [-1, 3], beat: 5 },
        { type: "point", id: "P", x: 0, y: 1, label: "(0,1)", beat: 6 },
        { type: "point", id: "Q", x: 2, y: 1, label: "(2,1)", beat: 7 },
        { type: "segment", from: "P", to: "Q", dashed: true, beat: 7, color: "orange" },
      ] }),
      captionMd: "",
    },
    progress: { n: 3, of: 6 },
  },
  // a parallel circuit: the same voltage on both branches, then the equivalent resistance, then the split of the current
  beatsCircuit: {
    titleMd: "מעגל מקבילי: מתח וזרם בכל ענף",
    bodyMd: String.raw`מקור של $12\,\text{V}$ ושני נגדים במקביל: $\blue{R_1} = 4\,\Omega$, $\green{R_2} = 12\,\Omega$.`,
    beats: [
      { md: String.raw`**מתח:** הנגדים מחוברים במקביל, ולכן על כל אחד מהם אותו מתח:
$$
V_1 = V_2 = V = 12\,\text{V}
$$` },
      { md: String.raw`**התנגדות שקולה:**
$$
\frac{1}{R_{eq}} = \frac{1}{\blue{R_1}} + \frac{1}{\green{R_2}} = \frac{1}{4} + \frac{1}{12} = \frac{1}{3}
$$
לכן $R_{eq} = 3\,\Omega$ והזרם הכולל $I = \frac{V}{R_{eq}} = 4\,\text{A}$.` },
      { md: String.raw`**פיצול הזרם:**
` + fence("rows", String.raw`ענף 1 | \blue{I_1} = \frac{V}{R_1} = \frac{12}{4} = 3\,\text{A}
ענף 2 | \green{I_2} = \frac{V}{R_2} = \frac{12}{12} = 1\,\text{A}`) + String.raw`
בדיקה: $I_1 + I_2 = 4\,\text{A} = I$.`, sideMd: "חוק הצמתים של קירכהוף: מה שנכנס לצומת יוצא ממנו." },
    ],
    sideMd: null,
    figure: { kind: "svg", source: PARALLEL, captionMd: "" },
    progress: null,
  },
  // photosynthesis: light, CO₂ and water in, O₂ out
  beatsPhoto: {
    titleMd: "פוטוסינתזה",
    bodyMd: String.raw`בתא העלה, בתוך ה\green{כלורופלסט}:`,
    beats: [
      { md: String.raw`**אור** נקלט בכלורופיל ומספק את האנרגיה לתהליך.` },
      { md: String.raw`\blue{CO₂} נכנס מהאוויר דרך הפיוניות.` },
      { md: String.raw`מים ($\ce{H2O}$) מגיעים מהשורשים.` },
      { md: String.raw`ה-$\ce{CO2}$ והמים מגיבים ונוצר סוכר:
$$
\ce{6CO2 + 6H2O ->[h\nu] C6H12O6 + 6O2}
$$` },
      { md: String.raw`ה\pink{חמצן} שנוצר יוצא מהתא.` },
    ],
    sideMd: null,
    figure: { kind: "svg", source: PHOTO, captionMd: "" },
    progress: null,
  },
  // the parts of a cell: each part is drawn and coloured with its word
  beatsCell: {
    titleMd: "מבנה התא",
    bodyMd: "התא מוקף בקרום. בפנים:",
    beats: [
      { md: String.raw`ה\blue{גרעין} מכיל את ה-DNA ושולט בפעילות התא.` },
      { md: String.raw`ה\green{מיטוכונדריה} מייצרת אנרגיה (ATP) בנשימה התאית.` },
      { md: String.raw`ה\pink{ריבוזומים} מייצרים חלבונים לפי ה-mRNA.` },
    ],
    sideMd: null,
    figure: { kind: "svg", source: CELL, captionMd: "" },
    progress: null,
  },
};
