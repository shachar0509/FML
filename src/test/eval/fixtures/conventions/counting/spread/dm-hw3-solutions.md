# Discrete Mathematics — Homework 3, Model Solutions

## Question 1 (20 points)
Give the definition of a tree, and state how many edges a tree on $n$ vertices has.

**Solution.** A tree is a connected graph with no cycles.

<u>A tree is a connected acyclic graph; a tree on $n$ vertices has exactly $n - 1$ edges.</u>

For the second part: a connected graph on $n$ vertices has at least $n-1$ edges, since each edge added to a set of $n$ isolated vertices can reduce the number of components by at most one, and an acyclic graph has at most $n - 1$ edges since an extra edge would close a cycle. A tree is both, so it has exactly $n - 1$ edges.

## Question 2 (25 points)
Prove that for every integer $n$, if $n^2$ is even then $n$ is even.

**Solution.** We prove the contrapositive: if $n$ is odd then $n^2$ is odd. Let $n$ be odd, so $n = 2k + 1$ for some integer $k$. Then
$$n^2 = (2k+1)^2 = 4k^2 + 4k + 1 = 2(2k^2 + 2k) + 1,$$
which has the form $2m + 1$ with $m = 2k^2 + 2k$ an integer. So $n^2$ is odd.

<u>The contrapositive is proved, so if $n^2$ is even, then $n$ is even. ∎</u>

---page---

## Question 3 (15 points)
How many binary strings of length 8 contain exactly three 1's?

**Solution.** A string is determined by choosing which 3 of the 8 positions carry a 1; the other positions carry 0. The number of ways is $\binom{8}{3} = \dfrac{8\cdot 7\cdot 6}{3\cdot 2\cdot 1} = 56$.

## Question 4 (15 points)
Prove that every tree with at least 2 vertices has at least two leaves (vertices of degree 1).

**Solution.** Let $T$ be a tree with $n \ge 2$ vertices and consider a longest path $P = v_0 v_1 \dots v_k$ in $T$. Since $T$ is connected and has an edge, $k \ge 1$, so $v_0 \ne v_k$. Suppose $v_0$ had a neighbour $w$ other than $v_1$. If $w$ lies on $P$, say $w = v_j$ with $j \ge 2$, then $v_0 v_1 \dots v_j v_0$ is a cycle, which a tree does not have. If $w$ is not on $P$, then $w v_0 v_1 \dots v_k$ is a path longer than $P$, contradicting the choice of $P$. Hence $\deg(v_0) = 1$, and by the same argument applied to the other end, $\deg(v_k) = 1$. So $v_0$ and $v_k$ are two distinct leaves of $T$. ∎
