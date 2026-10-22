# Applied Mathematics — Problem Set 3, Model Solutions (Part A)

## Question 1 (15 points)
Solve the equation $x^2 - 5x + 1 = 0$ over the real numbers.

**Solution.** The equation is a quadratic with $a = 1$, $b = -5$, $c = 1$. Its discriminant is $\Delta = b^2 - 4ac = 25 - 4 = 21 > 0$, so there are two real roots, given by the quadratic formula:
$$x_{1,2} = \frac{-b \pm \sqrt{\Delta}}{2a} = \frac{5 \pm \sqrt{21}}{2}.$$
Check by Vieta's formulas: the sum of the roots is $\frac{5+\sqrt{21}}{2} + \frac{5-\sqrt{21}}{2} = 5 = -b/a$ and the product is $\frac{25 - 21}{4} = 1 = c/a$, as required.

## Question 2 (15 points)
In a lab session the distance travelled by a cart on a track is measured: 2.35 m in 1.8 s. What is the cart's average speed?

**Solution.** The average speed is the distance divided by the elapsed time:
$$\bar v = \frac{d}{t} = \frac{2.35\ \text{m}}{1.8\ \text{s}} = 1.31\ \text{m/s}.$$
The distance was read off the ruler along the track and the time from the stopwatch.

---page---

## Question 3 (15 points)
Compute exactly the length of an arc of a circle of radius $3$ whose central angle is $\pi/3$ radians.

**Solution.** For a central angle $\theta$ measured in radians the arc length is $s = r\theta$, since the whole circumference $2\pi r$ corresponds to the angle $2\pi$. Substituting,
$$s = 3 \cdot \frac{\pi}{3} = \pi.$$
The arc has length $\pi$ (in the same unit as the radius).

## Question 4 (15 points)
In a circuit a voltmeter reads 4.7 V across a resistor while an ammeter reads 0.32 A through it. Find the resistance.

**Solution.** By Ohm's law $R = V / I$. Substituting the readings,
$$R = \frac{4.7\ \text{V}}{0.32\ \text{A}} = 14.69\ \Omega.$$
Note that the instrument readings are the data of the problem; the resistance is computed from them directly, with no further assumption about the circuit.
