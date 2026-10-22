# Data Structures and Algorithms — Homework 5, Model Solutions (2024)
Prepared by the teaching assistant. Python 3.

---page---

## Question 1 (12 points)
How many calls does `fib(5)` make in total (counting the first call)? Show your reasoning.

```python
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

In short: the call tree of `fib(5)` has 15 nodes, of which 8 are leaves, and the value computed is 5. Counting the calls is the same as counting the nodes of the tree, and each node splits into the calls for n-1 and n-2 until n < 2.

Let C(n) be the number of calls made by `fib(n)`. The calls, from the base cases up:

| call | returns | calls made inside it (including itself) |
|---|---|---|
| fib(1) | 1 | 1 |
| fib(0) | 0 | 1 |
| fib(2) | 1 | 1 + 1 + 1 = 3 |
| fib(3) | 2 | 1 + C(2) + C(1) = 1 + 3 + 1 = 5 |
| fib(4) | 3 | 1 + C(3) + C(2) = 1 + 5 + 3 = 9 |
| fib(5) | 5 | 1 + C(4) + C(3) = 1 + 9 + 5 = 15 |

So `fib(5)` makes 15 calls. Note that `fib(3)` is computed twice and `fib(2)` three times: that repetition is what memoization removes.

## Question 2 (13 points)
Write a backtracking function `subset_sum(nums, target)` that prints every subset of `nums` (positive integers) whose sum is `target`, pruning branches whose sum already exceeds the target. What is printed for `nums = [3, 5, 7, 2]`, `target = 10`?

In short: the function decides for each number in turn whether to take it, abandons a branch once the running sum passes the target, and for this input prints `[3, 5, 2]` and `[3, 7]`.

```python
def subset_sum(nums, target, i=0, chosen=(), total=0):
    if total == target:
        print(list(chosen))
        return
    if i == len(nums) or total > target:
        return
    subset_sum(nums, target, i + 1, chosen + (nums[i],), total + nums[i])
    subset_sum(nums, target, i + 1, chosen, total)
```

The calls, in the order they start (depth = i):

| call (i, chosen) | total | what happens |
|---|---|---|
| (0, ()) | 0 | take 3 |
| (1, (3)) | 3 | take 5 |
| (2, (3,5)) | 8 | take 7 |
| (3, (3,5,7)) | 15 | total > target, pruned |
| (3, (3,5)) | 8 | take 2 |
| (4, (3,5,2)) | 10 | total == target, prints [3, 5, 2] |
| (4, (3,5)) | 8 | i == len, returns |
| (2, (3)) | 3 | take 7 |
| (3, (3,7)) | 10 | total == target, prints [3, 7] |
| (3, (3)) | 3 | take 2, then skip: totals 5 and 3, no match |
| (1, ()) | 0 | take 5, then 7: total 12, pruned; 5+2 = 7 and 5 alone: no match |
| (2, ()) | 0 | take 7 then 2: total 9; 7 alone, 2 alone, none: no match |

Two subsets are printed. Note that the check `total == target` comes before the check `i == len(nums)`, otherwise a subset that uses the last element would never be printed.

---page---

## Question 3 (10 points)
Solve the recurrence T(n) = 2·T(n/2) + n² and give the asymptotic time complexity of the divide-and-conquer algorithm it describes.

In short: the answer is Θ(n²), because the work at the root dominates the work in all the levels below.

The recursion tree has log₂ n levels. At level j there are 2^j subproblems of size n/2^j, each costing (n/2^j)², so the level costs 2^j · n²/4^j = n² / 2^j. The total is n² · (1 + 1/2 + 1/4 + …) < 2n². The root alone costs n², so T(n) = Θ(n²). The same follows from case 3 of the Master theorem: a = 2, b = 2, f(n) = n² = Ω(n^(1+ε)) with ε = 1, and the regularity condition 2·(n/2)² = n²/2 ≤ (1/2)·n² holds.

## Question 4 (10 points)
What is the time complexity of this recursive binary search on a sorted array of n elements, and what is its recursion depth?

```python
def bsearch(a, x, lo, hi):
    if lo > hi:
        return -1
    mid = (lo + hi) // 2
    if a[mid] == x:
        return mid
    return bsearch(a, x, lo, mid - 1) if x < a[mid] else bsearch(a, x, mid + 1, hi)
```

In short: O(log n) time, and also O(log n) stack depth.

Each call does constant work and makes at most one recursive call on a range at most half as long: the range length goes n, n/2, n/4, …, and the recursion stops when it reaches 0. This takes at most ⌊log₂ n⌋ + 1 calls, so T(n) = T(n/2) + O(1) = O(log n). In the best case the element is found at the first probe, O(1). Since every call is pending until the one below it returns, the stack depth is also O(log n); an iterative version would need O(1) space.
