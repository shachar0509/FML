# Discrete Mathematics — Homework 1, Model Solutions

## Question 1 (25 points)
Prove that the sum of the first n odd numbers is $n^2$, that is, $1 + 3 + \dots + (2n-1) = n^2$ for every $n \ge 1$.

**Solution.** By induction on n.

Base case: for $n = 1$ the left side is $1$ and the right side is $1^2 = 1$.

Inductive step: assume the claim holds for some $n \ge 1$, that is $1 + 3 + \dots + (2n-1) = n^2$. For $n+1$ the sum has one more term, $2(n+1) - 1 = 2n + 1$. By the induction hypothesis,
$$1 + 3 + \dots + (2n-1) + (2n+1) = n^2 + 2n + 1 = (n+1)^2.$$
So the claim holds for $n+1$ as well.

<u>By the principle of induction, the sum of the first n odd numbers equals $n^2$ for every $n \ge 1$. ∎</u>

## Question 2 (20 points)
A committee of 3 people is chosen from a group of 7 people. In how many ways can this be done if the order of choosing does not matter?

**Solution.** The committee is an unordered selection of 3 of the 7 people, so we count 3-element subsets of a 7-element set: $\binom{7}{3} = \dfrac{7!}{3!\,4!} = \dfrac{7\cdot 6\cdot 5}{3\cdot 2\cdot 1} = \dfrac{210}{6} = 35$.

__Answer:__ 35 committees.

---page---

## Question 3 (15 points)
Explain the difference between a relation that is symmetric and one that is antisymmetric, and give an example of a relation on $\{1,2,3\}$ that is both.

**Solution.** A relation $R$ is symmetric if $(a,b) \in R$ always implies $(b,a) \in R$: every arrow can be reversed. It is antisymmetric if $(a,b) \in R$ and $(b,a) \in R$ together force $a = b$: no two different elements point to each other. These are not opposites. The relation $R = \{(1,1), (2,2)\}$ on $\{1,2,3\}$ is symmetric, because each pair is its own reverse, and antisymmetric, because the only pairs whose reverse also belongs to $R$ have equal entries. The empty relation and the identity relation $\{(1,1),(2,2),(3,3)\}$ are further examples.

## Question 4 (15 points)
How many different words (not necessarily meaningful) can be made by rearranging all the letters of the word LEVEL?

**Solution.** The word has 5 letters, with $L$ appearing twice and $E$ appearing twice, and $V$ once. If all the letters were different there would be $5!$ arrangements. Swapping the two $L$'s, or the two $E$'s, does not produce a new word, so we divide by $2!$ for each repeated letter: $\dfrac{5!}{2!\,2!\,1!} = \dfrac{120}{4} = 30$ distinct words.
