# Discrete Mathematics — Homework 2, Model Solutions

## Question 1 (20 points)
How many integers between 1 and 100 (inclusive) are divisible by 3 or by 5?

**Solution.** Let $A$ be the set of multiples of 3 in the range and $B$ the multiples of 5. Then $|A| = \lfloor 100/3 \rfloor = 33$ and $|B| = \lfloor 100/5 \rfloor = 20$. The numbers divisible by both 3 and 5 are the multiples of 15, so $|A \cap B| = \lfloor 100/15 \rfloor = 6$. By inclusion-exclusion, $|A \cup B| = 33 + 20 - 6 = 47$.

__Answer:__ 47 integers.

## Question 2 (20 points)
Define what it means for a function $f: A \to B$ to be injective, and decide whether $f(x) = x^2$ from $\mathbb{R}$ to $\mathbb{R}$ is injective.

**Solution.** A function $f: A \to B$ is injective (one-to-one) if different elements of $A$ always have different images: for all $a_1, a_2 \in A$, $f(a_1) = f(a_2)$ implies $a_1 = a_2$.

<u>A function is injective exactly when no two distinct elements of its domain are mapped to the same element of the codomain.</u>

The function $f(x) = x^2$ on $\mathbb{R}$ is not injective: $f(2) = 4 = f(-2)$ while $2 \ne -2$. (Restricted to $[0,\infty)$ it is injective.)

---page---

## Question 3 (20 points)
A fair die is rolled twice. What is the probability that the sum of the two results is 8?

**Solution.** The sample space has $6 \cdot 6 = 36$ equally likely ordered outcomes. The outcomes with sum $8$ are $(2,6), (3,5), (4,4), (5,3), (6,2)$, which are 5 outcomes. The probability is therefore the ratio of favourable to all outcomes, $\frac{5}{36} \approx 0.139$.

## Question 4 (15 points)
Why does the graph on the right (a triangle $a$-$b$-$c$ with one extra vertex $d$ attached to $a$) have no Eulerian circuit?

**Solution.** A connected graph has an Eulerian circuit exactly when all its vertices have even degree (Euler's theorem). Here $\deg(a) = 3$, $\deg(b) = \deg(c) = 2$ and $\deg(d) = 1$. Both $a$ and $d$ have odd degree, so the condition fails. Intuitively, a circuit that enters $d$ along the single edge $a$-$d$ cannot leave it by a different edge.
