# Applied Mathematics — Problem Set 4, Model Solutions (Part B)

## Question 1 (15 points)
Find the value of $\tan\dfrac{\pi}{12}$.

**Solution.** Write $\frac{\pi}{12} = \frac{\pi}{3} - \frac{\pi}{4}$ and use the subtraction formula $\tan(\alpha - \beta) = \dfrac{\tan\alpha - \tan\beta}{1 + \tan\alpha\tan\beta}$ with $\tan\frac\pi3 = \sqrt3$ and $\tan\frac\pi4 = 1$:
$$\tan\frac{\pi}{12} = \frac{\sqrt3 - 1}{1 + \sqrt3}.$$
Multiplying numerator and denominator by $\sqrt3 - 1$ to rationalise the denominator gives $\dfrac{(\sqrt3-1)^2}{3 - 1} = \dfrac{4 - 2\sqrt3}{2} = 2 - \sqrt3$.

## Question 2 (15 points)
A metal sample is weighed and found to have a mass of 27.3 g; by water displacement its volume is found to be 10.1 cm³. What is the density of the metal?

**Solution.** Density is mass per unit volume, so
$$\rho = \frac{m}{V} = \frac{27.3\ \text{g}}{10.1\ \text{cm}^3} = 2.70\ \text{g/cm}^3.$$
This is close to the tabulated density of aluminium, which suggests the sample is aluminium.

---page---

## Question 3 (15 points)
Find exactly the value of $x$ for which $3^x = 7$.

**Solution.** Take the logarithm of both sides, using a base in which we can evaluate both sides: $\ln 3^x = \ln 7$. By the power rule $x \ln 3 = \ln 7$, so
$$x = \frac{\ln 7}{\ln 3} = \log_3 7.$$
The solution is unique because $3^x$ is strictly increasing.

## Question 4 (15 points)
A pendulum is timed in the lab: 20 full oscillations take 36.4 s. Find the period of the pendulum.

**Solution.** The period is the time of one oscillation, so it is the total time divided by the number of oscillations:
$$T = \frac{36.4\ \text{s}}{20} = 1.82\ \text{s}.$$
Timing many oscillations rather than one reduces the relative error of the stopwatch reading.

## Question 5 (10 points)
Estimate, to two decimal places, the positive root of $x^2 + x - 3 = 0$.

**Solution.** By the quadratic formula the roots are $\frac{-1 \pm \sqrt{1 + 12}}{2} = \frac{-1 \pm \sqrt{13}}{2}$, and the positive one is $\frac{-1 + \sqrt{13}}{2}$. Since $\sqrt{13} \approx 3.6056$,
$$x \approx \frac{-1 + 3.6056}{2} \approx 1.30.$$
Check: $1.30^2 + 1.30 - 3 = 1.69 + 1.30 - 3 = -0.01$, close to $0$.
