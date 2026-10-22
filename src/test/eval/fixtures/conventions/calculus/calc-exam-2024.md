# Calculus 1 — Final Exam, Moed A (2024) — Model Solutions

## Question 1 (30 points)
Let $g(x) = x\,e^{-x}$ for $x \ge 0$.
(a) Sketch the graph of $g$.
(b) Prove that $g(x) \le \dfrac1e$ for all $x \ge 0$.
(c) Compute $\displaystyle\int_0^1 g(x)\,dx$.

**Solution.**

(a) $g(0) = 0$ and $g \ge 0$ on the domain. Since $x e^{-x} = \frac{x}{e^x}$ and the exponential outgrows any power of $x$, we get $\lim_{x\to\infty} g(x) = 0$, so the $x$-axis ($y = 0$) is a horizontal asymptote on the right. The derivative $g'(x) = (1 - x)e^{-x}$ is positive on $(0,1)$ and negative on $(1, \infty)$, so $g$ rises to the maximum $g(1) = 1/e$ and then decays toward $0$. The second derivative $(x - 2)e^{-x}$ changes sign at $x = 2$: an inflection point at $(2, 2/e^2)$.

[Figure for (a): x-axis labelled "x", y-axis labelled "y = g(x)". Dashed horizontal line "y = 0" marked as the asymptote to the right. Points marked: (0,0), maximum (1, 1/e), inflection (2, 2/e²). Curve rises from the origin, peaks at x = 1 and decays toward the axis.]

(b) From the sign analysis of $g'(x) = (1-x)e^{-x}$: $g'$ is positive for $0 < x < 1$ because $1 - x > 0$ and $e^{-x} > 0$, and negative for $x > 1$. So $g$ is increasing up to $x = 1$ and decreasing after it, and therefore $g(x) \le g(1) = e^{-1}$ for every $x \ge 0$. $\blacksquare$

(c) Integrating by parts with $u = x$, $dv = e^{-x}dx$ (so $du = dx$, $v = -e^{-x}$): $\int_0^1 x e^{-x}dx = \left[-x e^{-x}\right]_0^1 + \int_0^1 e^{-x}dx = -e^{-1} + \left[-e^{-x}\right]_0^1 = -e^{-1} + (1 - e^{-1})$.

**Answer: $1 - \dfrac{2}{e}$.**

## Question 2 (15 points)
Prove that the equation $x^3 + x - 1 = 0$ has a solution in the interval $(0, 1)$.

**Solution.** Let $p(x) = x^3 + x - 1$. A polynomial is continuous everywhere, in particular on $[0, 1]$. At the endpoints $p(0) = -1 < 0$ and $p(1) = 1 > 0$, so $0$ lies strictly between $p(0)$ and $p(1)$. The conditions of the Intermediate Value Theorem hold, hence there is $c \in (0, 1)$ with $p(c) = 0$. $\blacksquare$

## Question 3 (5 points)
$\displaystyle\int_0^\pi \sin x\,dx$ equals:
(A) $0$  (B) $1$  (C) $2$  (D) $\pi$

**Solution.** (C). The antiderivative is $-\cos x$, which gives $-\cos\pi + \cos 0 = 2$.

## Question 4 (5 points)
True or false: every bounded sequence of real numbers converges.

**Solution.** False. The sequence $a_n = (-1)^n$ is bounded by $1$ but alternates between $1$ and $-1$.

---page---

## Question 5 (25 points)
A ladder of length 5 m leans against a vertical wall. The bottom of the ladder slides away from the wall at a constant 0.4 m/s. Let $x$ be the distance of the bottom from the wall and $y$ the height of the top.
(a) Write the relation between $x$ and $y$.
(b) Find the speed at which the top slides down when $x = 3$ m.
(c) Find the same when $x = 4$ m.

**Solution.**

(a) The ladder, the wall and the floor form a right triangle with hypotenuse 5 m, so $x^2 + y^2 = 25$.

(b) Differentiating the relation with respect to time $t$, $2x\,\dot x + 2y\,\dot y = 0$, so $\dot y = -\frac{x}{y}\dot x$. When $x = 3$ m we get $y = \sqrt{25 - 9} = 4$ m, so $\dot y = -\frac34 \cdot 0.4 = -0.30$ m/s. The top slides down at **0.30 m/s**.

(c) When $x = 4$ m, $y = \sqrt{25 - 16} = 3$ m, and $\dot y = -\frac43 \cdot 0.4 = -0.53$ m/s, so the top slides down at **0.53 m/s**.

## Question 6 (15 points)
Prove that the derivative of $f(x) = x^3 - 4x^2 + 3x$ vanishes at some point of the interval $(0, 3)$.

**Solution.** The function $f$ is a polynomial, so it is continuous on the closed interval $[0, 3]$ and differentiable on the open interval $(0, 3)$. At the endpoints $f(0) = 0$ and $f(3) = 27 - 36 + 9 = 0$, so $f(0) = f(3)$. All the conditions of Rolle's Theorem hold, hence there is $c \in (0, 3)$ with $f'(c) = 0$. $\blacksquare$

## Question 7 (5 points)
Find $\dfrac{d}{dx}\left(x^2 \ln x\right)$ for $x > 0$.

**Solution.** By the product rule: $\frac{d}{dx}(x^2 \ln x) = 2x \ln x + x^2\cdot\frac1x = 2x\ln x + x$.
