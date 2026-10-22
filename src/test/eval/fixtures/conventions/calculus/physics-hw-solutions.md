# Physics 1 (Mechanics) — Homework 6, Model Solutions
Use $g = 9.81\ \text{m/s}^2$ unless the question says otherwise.

## Problem 1
A ball is dropped from rest from a tower of height 20 m. Ignore air resistance.
(a) How long does it take to reach the ground?
(b) What is its speed just before it hits the ground?

**Solution.**

(a) With the origin at the release point and the downward direction positive, $h = \frac12 g t^2$, so $t = \sqrt{\dfrac{2h}{g}} = \sqrt{\dfrac{2\cdot 20}{9.81}} = 2.02\ \text{s}$.

(b) The velocity of a body falling from rest is $v = g t$, hence $v = 9.81 \cdot 2.0194 = 19.81\ \text{m/s}$. As a check, $v = \sqrt{2gh} = \sqrt{2\cdot 9.81\cdot 20} = 19.81\ \text{m/s}$, the same value from the energy equation.

## Problem 2
A car drives along a straight road and covers 150 m in 10 s, with a smooth, continuously varying speed. Show that at some moment its instantaneous speed was exactly equal to its average speed, and give that speed.

**Solution.** Let $s(t)$ be the position of the car for $0 \le t \le 10$. The motion is smooth, so $s$ is continuous on $[0, 10]$ and differentiable on $(0, 10)$, which are the conditions of the Mean Value Theorem. The theorem gives a time $t_0 \in (0, 10)$ with
$$s'(t_0) = \frac{s(10) - s(0)}{10 - 0} = \frac{150}{10} = 15.00\ \text{m/s}.$$
Since $s'(t_0)$ is the instantaneous speed at $t_0$, at that moment the car's speed equals its average speed, $15.00\ \text{m/s}$.

## Problem 3
A body of mass $m$ falls in a viscous fluid. The drag force is $-b v$, so Newton's second law gives $m\dot v = mg - bv$ with $v(0) = 0$, whose solution is
$$v(t) = v_T\left(1 - e^{-t/\tau}\right), \quad v_T = \frac{mg}{b}, \quad \tau = \frac{m}{b}.$$
(a) Sketch $v(t)$ for $t \ge 0$.
(b) Show that the acceleration is $g\,e^{-t/\tau}$ and that it tends to zero.
(c) For $m = 2.0$ kg and $b = 0.5$ kg/s, find $v_T$ and the speed at $t = \tau$.

**Solution.**

(a) $v(0) = 0$, the function is increasing because $\dot v = \frac{v_T}{\tau}e^{-t/\tau} > 0$, and $v \to v_T$ as $t \to \infty$, so the line $v = v_T$ is a horizontal asymptote. The slope at the origin is $v_T/\tau = g$ and decreases monotonically; the graph is concave down.

[Figure for (a): horizontal axis labelled "t (s)", vertical axis labelled "v (m/s)". Dashed horizontal line marked "v = v_T" (asymptote). Curve from the origin, initial tangent drawn with slope g, flattening toward the dashed line. The point t = τ marked on the t-axis with the curve at 0.63 v_T.]

(b) Differentiating, $a(t) = \dot v = v_T \cdot \frac{1}{\tau}e^{-t/\tau}$, by the chain rule. Since $\frac{v_T}{\tau} = \frac{mg/b}{m/b} = g$, we get $a(t) = g\,e^{-t/\tau}$. As $t \to \infty$ the exponent tends to $-\infty$, so $a \to 0$: the body stops accelerating and moves at constant speed $v_T$.

(c) $v_T = \dfrac{mg}{b} = \dfrac{2.0\cdot 9.81}{0.5} = 39.24\ \text{m/s}$. Also $\tau = \dfrac{m}{b} = 4.00\ \text{s}$. At $t = \tau$: $v = v_T(1 - e^{-1}) = 39.24 \cdot 0.6321 = 24.80\ \text{m/s}$.

---page---

## Problem 4
Which of the following is a unit of work (energy)?
(A) N  (B) J  (C) W  (D) N·s

**Solution.** (B). One joule is one newton-metre, force times distance.

## Problem 5
Derive the period of a simple pendulum of length $L$ for small oscillations.

**Solution.** For a pendulum of length $L$ and angle $\theta$ from the vertical, the tangential component of gravity gives $mL\ddot\theta = -mg\sin\theta$ (Newton's second law along the arc). For small angles $\sin\theta \approx \theta$, so $\ddot\theta = -\dfrac{g}{L}\theta$, which is the equation of simple harmonic motion with $\omega^2 = \dfrac gL$ (the standard solution $\theta = \theta_0\cos\omega t$). The period is $T = \dfrac{2\pi}{\omega}$, since one oscillation is one full cycle of the cosine. Substituting $\omega$:
$$T = 2\pi\sqrt{\frac{L}{g}}.$$

## Problem 6
True or false: if the velocity of a body is zero at some instant, its acceleration at that instant is also zero.

**Solution.** False. A ball thrown upward has $v = 0$ at the top of its path, but its acceleration is still $g$ downward.

## Problem 7
A spring of constant $k = 200\ \text{N/m}$ is compressed by 0.15 m from its natural length. How much elastic energy is stored in it?

**Solution.** The elastic energy of a spring is $U = \frac12 k x^2$ (the work done against the force $kx$ while compressing from $0$ to $x$). Substituting, $U = \frac12 \cdot 200 \cdot (0.15)^2 = 2.25\ \text{J}$.
