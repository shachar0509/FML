# Calculus 1 — Final Exam, Moed A (2023) — Model Solutions

## Question 1 (30 points)
Let $f(x) = \dfrac{x^2}{x-1}$.
(a) Sketch the graph of $f$.
(b) Prove that $f$ has a local minimum at $x = 2$.
(c) Compute $\displaystyle\int_2^3 f(x)\,dx$.

**Solution.**

(a) Domain: $x \ne 1$. Since $f(x) = x + 1 + \dfrac{1}{x-1}$, the line $y = x+1$ is an oblique asymptote at $\pm\infty$ and $x = 1$ is a vertical asymptote ($f \to +\infty$ as $x \to 1^+$ and $f \to -\infty$ as $x \to 1^-$). Intercept: $f(0) = 0$. Critical points are found in (b): a local max at $(0,0)$ and a local min at $(2,4)$.

[Figure for (a): x-axis labelled "x", y-axis labelled "y = f(x)". Dashed lines drawn and marked: vertical asymptote "x = 1", oblique asymptote "y = x + 1". Points marked: (0,0) local maximum, (2,4) local minimum. Left branch below the oblique line through (0,0), right branch above it through (2,4).]

(b) $f'(x) = \dfrac{2x(x-1) - x^2}{(x-1)^2} = \dfrac{x^2 - 2x}{(x-1)^2} = \dfrac{x(x-2)}{(x-1)^2}$, by the quotient rule. The denominator is positive for $x \ne 1$, so the sign of $f'$ is the sign of $x(x-2)$. For $1 < x < 2$ we have $x > 0$ and $x - 2 < 0$, so $f' < 0$ and $f$ is decreasing. For $x > 2$ both factors are positive, so $f' > 0$ and $f$ is increasing. The derivative changes sign from negative to positive at $x = 2$ (and $f'(2) = 0$), hence $x = 2$ is a local minimum by the first-derivative test.

(c) Using the division from (a): $\displaystyle\int_2^3 \left(x + 1 + \frac{1}{x-1}\right)dx$. An antiderivative is $\frac{x^2}{2} + x + \ln|x-1|$. Evaluating, $\left(\frac92 + 3 + \ln 2\right) - \left(2 + 2 + \ln 1\right) = \frac72 + \ln 2$.

**Answer: $\dfrac72 + \ln 2$.**

## Question 2 (15 points)
Prove that for all real $a < b$ we have $|\sin b - \sin a| \le b - a$.

**Solution.** Let $g(x) = \sin x$. The function $g$ is continuous on $[a, b]$ and differentiable on $(a, b)$, since sine is differentiable everywhere. Therefore the Mean Value Theorem applies: there is $c \in (a, b)$ with $\sin b - \sin a = g'(c)(b - a) = \cos c\,(b - a)$. Taking absolute values, $|\sin b - \sin a| = |\cos c|\,(b - a)$, because $b - a > 0$. As $|\cos c| \le 1$ for every real $c$, we conclude $|\sin b - \sin a| \le b - a$. $\blacksquare$

## Question 3 (5 points)
$\displaystyle\lim_{x \to 0} \frac{\sin 3x}{x}$ equals:
(A) $0$  (B) $1$  (C) $3$  (D) does not exist

**Solution.** (C). Writing $\frac{\sin 3x}{x} = 3\cdot\frac{\sin 3x}{3x}$ and using $\frac{\sin t}{t} \to 1$.

## Question 4 (5 points)
True or false: if $f$ is continuous at $x_0$, then $f$ is differentiable at $x_0$.

**Solution.** False. $f(x) = |x|$ is continuous at $0$ but has no derivative there.

---page---

## Question 5 (15 points)
Compute $\displaystyle\lim_{x \to \infty} \left(1 + \frac{2}{x}\right)^x$.

**Solution.** The expression has the form $1^\infty$, so we rewrite it with the exponential: $\left(1 + \frac2x\right)^x = e^{x \ln(1 + 2/x)}$, since $a^b = e^{b \ln a}$ for $a > 0$. By continuity of $e^t$ it is enough to find the limit of the exponent. Put $t = 2/x$; as $x \to \infty$, $t \to 0^+$, and $x \ln(1 + 2/x) = 2\cdot\frac{\ln(1+t)}{t}$. Now $\frac{\ln(1+t)}{t} \to 1$ as $t \to 0$, because this is the derivative of $\ln(1+t)$ at $t = 0$, which equals $\frac{1}{1+0} = 1$. So the exponent tends to $2$ and the limit is $e^2$.

**Answer: $e^2$.**

## Question 6 (10 points)
Sketch the graph of $y = \tan x$ on the interval $\left(-\frac\pi2, \frac\pi2\right)$.

**Solution.** The function is odd, increasing (its derivative $\frac{1}{\cos^2 x}$ is positive) and passes through the origin. As $x \to \frac\pi2^-$, $\tan x \to +\infty$, and as $x \to -\frac\pi2^+$, $\tan x \to -\infty$, so the lines $x = \pm\frac\pi2$ are vertical asymptotes. The second derivative is $\frac{2\sin x}{\cos^3 x}$, which is negative for $x < 0$ and positive for $x > 0$; hence the graph is concave down on the left and concave up on the right with an inflection point at the origin.

[Figure: x-axis labelled "x" with ticks at $-\pi/2$, $0$, $\pi/2$; y-axis labelled "y = tan x". Vertical dashed lines at $x = -\pi/2$ and $x = \pi/2$, each marked "asymptote". Curve through (0,0) rising steeply toward each dashed line.]

## Question 7 (20 points)
(a) Find the derivative of $F(x) = \int_0^{x^2} e^{-t^2}\,dt$.
(b) Find the smallest value of $F$ on $[0, \infty)$.

**Solution.**

(a) Write $F(x) = G(x^2)$ where $G(u) = \int_0^u e^{-t^2}dt$. By the fundamental theorem of calculus (the integrand is continuous), $G'(u) = e^{-u^2}$. By the chain rule $F'(x) = G'(x^2) \cdot 2x = 2x\,e^{-x^4}$.

(b) For $x \ge 0$ we have $F'(x) = 2x\,e^{-x^4} \ge 0$, because $x \ge 0$ and the exponential is positive. So $F$ is non-decreasing on $[0, \infty)$, and its smallest value is at $x = 0$: $F(0) = \int_0^0 e^{-t^2}dt = 0$.
