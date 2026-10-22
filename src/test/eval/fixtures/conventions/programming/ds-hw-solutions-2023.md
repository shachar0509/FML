# Data Structures and Algorithms — Homework 4, Model Solutions (2023)
Recursion and backtracking. Solutions published by the course staff. All code is Python 3.

## Question 1 (15 points)
Write a backtracking function `solve(n)` that places n queens on an n×n board so that no two attack each other (same column or same diagonal; one queen per row). Show the execution of `solve(4)` up to the first solution.

**Solution.**

```python
def solve(n):
    cols = []                       # cols[r] = column of the queen in row r
    def ok(r, c):
        return all(c != cc and abs(c - cc) != r - rr for rr, cc in enumerate(cols))
    def place(r):
        if r == n:
            return True
        for c in range(n):
            if ok(r, c):
                cols.append(c)
                if place(r + 1):
                    return True
                cols.pop()          # undo and try the next column
        return False
    return cols if place(0) else None
```

Each call `place(r)` tries the columns of row r from left to right and recurses only on a safe one. Execution of `solve(4)`, one line per decision:

| step | row | column tried | safe? | reason / action |
|---|---|---|---|---|
| 1 | 0 | 0 | yes | place, go to row 1 |
| 2 | 1 | 0 | no | same column as row 0 |
| 3 | 1 | 1 | no | diagonal with (0,0) |
| 4 | 1 | 2 | yes | place, go to row 2 |
| 5 | 2 | 0 | no | same column as row 0 |
| 6 | 2 | 1 | no | diagonal with (1,2) |
| 7 | 2 | 2 | no | same column as row 1 |
| 8 | 2 | 3 | no | diagonal with (1,2) |
| 9 | 2 | - | dead end | return False, pop (1,2) |
| 10 | 1 | 3 | yes | place (1,3), go to row 2 |
| 11 | 2 | 0, 1 | 0 no, 1 yes | column 0 is taken by row 0; place (2,1), go to row 3 |
| 12 | 3 | 0, 1, 2, 3 | no | 0, 1 and 3 are taken columns, 2 is diagonal with (2,1) |
| 13 | 3 | - | dead end | return False, pop (2,1) |
| 14 | 2 | 2, 3 | no | 2 diagonal with (1,3), 3 same column; dead end, pop (1,3) |
| 15 | 1 | - | dead end | no column left in row 1, pop (0,0) |
| 16 | 0 | 1 | yes | place (0,1) |
| 17 | 1 | 3 | yes | columns 0, 1, 2 are unsafe; place (1,3) |
| 18 | 2 | 0 | yes | place (2,0) |
| 19 | 3 | 2 | yes | place (3,2), `r == n`, return True |

The result is `cols = [1, 3, 0, 2]`. The algorithm made 19 decisions; the whole subtree under the queen at (0,0) was explored and abandoned before the first solution was found.

## Question 2 (10 points)
What does `subsets("ab")` print, and in what order?

```python
def subsets(s, i=0, cur=""):
    if i == len(s):
        print("{" + cur + "}")
        return
    subsets(s, i + 1, cur)           # skip s[i]
    subsets(s, i + 1, cur + s[i])    # take s[i]
```

**Base case:** `i == len(s)`, where the current choice is printed and the call returns. Otherwise each call makes two recursive calls, first without and then with the character `s[i]`. Calls in the order they start (indentation is the recursion depth):

| call | i | cur | what happens |
|---|---|---|---|
| subsets("ab", 0, "") | 0 | "" | two calls follow |
| . subsets("ab", 1, "") | 1 | "" | two calls follow |
| . . subsets("ab", 2, "") | 2 | "" | base case, prints `{}` |
| . . subsets("ab", 2, "b") | 2 | "b" | base case, prints `{b}` |
| . subsets("ab", 1, "a") | 1 | "a" | two calls follow |
| . . subsets("ab", 2, "a") | 2 | "a" | base case, prints `{a}` |
| . . subsets("ab", 2, "ab") | 2 | "ab" | base case, prints `{ab}` |

Output in order: `{}`, `{b}`, `{a}`, `{ab}`. Note that the "skip" branch comes first, so the empty set is printed first and the full set last.

---page---

## Question 3 (10 points)
What is the time complexity of the naive recursive `fib(n)`? Justify.

```python
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

Let T(n) be the number of operations. Every call does a constant amount of work besides its two recursive calls, so T(n) = T(n-1) + T(n-2) + c with T(0) = T(1) = c'. Since T(n-1) ≥ T(n-2), we get T(n) ≥ 2·T(n-2), so T(n) ≥ 2^(n/2) · c'. On the other side T(n-2) ≤ T(n-1) gives T(n) ≤ 2·T(n-1), hence T(n) ≤ 2^n · c''. The exact growth is Θ(φ^n) where φ = (1+√5)/2 ≈ 1.618, because the recurrence is the Fibonacci recurrence itself. In particular the time is exponential. The space is O(n): the deepest chain of pending calls is fib(n), fib(n-1), …, fib(1).

## Question 4 (15 points)
Write `permute(a, k)` that prints all permutations of the list `a` by swapping, and show its execution on `a = [1, 2, 3]`.

```python
def permute(a, k=0):
    if k == len(a):
        print(a)
        return
    for i in range(k, len(a)):
        a[k], a[i] = a[i], a[k]
        permute(a, k + 1)
        a[k], a[i] = a[i], a[k]      # restore before the next choice
```

Position k is fixed by swapping each of the elements `a[k..]` into it in turn. The calls (depth = k):

| call | loop i | array after the swap | action |
|---|---|---|---|
| permute(a, 0) | 0 | [1,2,3] | call permute(a, 1) |
| permute(a, 1) | 1 | [1,2,3] | call permute(a, 2) |
| permute(a, 2) | 2 | [1,2,3] | call permute(a, 3), which prints [1,2,3] |
| permute(a, 1) | 2 | [1,3,2] | call permute(a, 2) |
| permute(a, 2) | 2 | [1,3,2] | call permute(a, 3), which prints [1,3,2] |
| permute(a, 0) | 1 | [2,1,3] | call permute(a, 1) |
| permute(a, 1) | 1 | [2,1,3] | prints [2,1,3] after a deeper call |
| permute(a, 1) | 2 | [2,3,1] | prints [2,3,1] after a deeper call |
| permute(a, 0) | 2 | [3,2,1] | call permute(a, 1) |
| permute(a, 1) | 1 | [3,2,1] | prints [3,2,1] after a deeper call |
| permute(a, 1) | 2 | [3,1,2] | prints [3,1,2] after a deeper call |

Six permutations are printed, each exactly once: 3! = 6 leaves. Without the restoring swap the array would be left shuffled between iterations and some permutations would repeat while others would be missed.

## Question 5 (10 points)
What are the time and space complexity of `subsets(s)` from Question 2 for a string of length n (count the work of building `cur`)?

There are 2^n leaves, one per subset, and the recursion tree has depth n, so 2^(n+1) - 1 calls in total. A call at depth i builds `cur + s[i]`, a string of length up to i, which costs O(n) in the worst case. The printing at the leaves costs O(n) as well. Hence the time is O(n · 2^n), and this is tight because half of the leaves have length at least n/2. The space is O(n): only one root-to-leaf path of calls is alive at any moment, and each call holds a string of length at most n (O(n²) if you count every `cur` on the path, which is the more careful bound).
