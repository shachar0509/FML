# Data Structures and Algorithms — Final Exam, Moed A (2024) — Model Solutions

---page---

## Question 1 (20 points)
What does `h(4)` return? Explain how you got it.

```python
def h(n):
    if n <= 1:
        return n
    return h(n - 1) + 2 * h(n - 2)
```

**Base case:** `n <= 1`, which returns n itself (so `h(0) = 0` and `h(1) = 1`). For larger n the function adds `h(n-1)` and twice `h(n-2)`. Expanding the calls from the outside in, in the order they run:

| call | needs | returns |
|---|---|---|
| h(4) | h(3), h(2) | 3 + 2·1 = 5 |
| h(3) | h(2), h(1) | 1 + 2·1 = 3 |
| h(2) | h(1), h(0) | 1 + 2·0 = 1 |
| h(1) | base case | 1 |
| h(0) | base case | 0 |
| h(1) (from h(3)) | base case | 1 |
| h(2) (second time, from h(4)) | h(1), h(0) | 1 |

`h(2)` is evaluated twice, both times with value 1. Reading the table from the bottom, `h(3) = 1 + 2·1 = 3` and then `h(4) = 3 + 2·1 = 5`. The function returns 5.

## Question 2 (15 points)
What is the time complexity, in terms of n, of the following function? Justify.

```python
def p(n):
    if n <= 1:
        return
    for i in range(n):
        pass                      # constant work
    p(n // 2)
    p(n // 2)
```

Each call runs a loop of n iterations and then makes two calls on n/2, so T(n) = 2·T(n/2) + n with T(1) = O(1). At each level of the recursion tree the sizes add up to n (2^j calls on n/2^j), so every level costs n, and there are log₂ n levels. Hence T(n) = Θ(n log n). This is case 2 of the Master theorem with a = b = 2 and f(n) = n = Θ(n^(log_b a)).

---page---

## Question 3 (25 points)
Write a backtracking function that returns all the ways to pay the amount `target` using unlimited coins from a list `coins`, where combinations that differ only in order count once. What does `ways([2, 3], 5)` return?

```python
def ways(coins, target, start=0, chosen=()):
    if target == 0:
        return [list(chosen)]
    result = []
    for j in range(start, len(coins)):
        if coins[j] <= target:
            result += ways(coins, target - coins[j], j, chosen + (coins[j],))
    return result
```

Passing `j` as the new `start` allows reusing the same coin but forbids going back to an earlier one, which is what removes the duplicates `[2,3]` and `[3,2]`. The calls of `ways([2, 3], 5)` in the order they start:

| call (target, start, chosen) | loop j | what happens |
|---|---|---|
| (5, 0, ()) | 0 | coin 2 fits, recurse |
| (3, 0, (2)) | 0 | coin 2 fits, recurse |
| (1, 0, (2,2)) | - | no coin fits, returns [] |
| (3, 0, (2)) | 1 | coin 3 fits, recurse |
| (0, 1, (2,3)) | - | target == 0, returns [[2,3]] |
| (5, 0, ()) | 1 | coin 3 fits, recurse |
| (2, 1, (3)) | - | coin 3 > 2, nothing fits, returns [] |

The only combination is `[[2, 3]]`. Notice that (1, 0, (2,2)) is a dead end, which is why `[2,2,...]` never completes.

## Question 4 (15 points)
Give the time complexity of printing all permutations of n distinct elements by the swapping algorithm (each permutation is printed as a list of length n).

There are n! permutations and each is printed once at a leaf of the recursion tree, which costs O(n) for the printing. The internal nodes: at depth k there are n·(n-1)·…·(n-k+1) calls, and their total is n! · (1 + 1/1! + 1/2! + …) ≤ e · n!, which is O(n!). The swaps cost O(1) each. So the total time is dominated by the output: Θ(n · n!). The space is O(n) for the recursion stack, apart from the output itself.
