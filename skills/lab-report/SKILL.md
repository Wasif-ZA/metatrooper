---
name: lab-report
description: Turn engineering lab data into a report with measurement uncertainty carried through to the result, plots with units and error bars, and a discussion that compares against theory. Use for university lab reports, test results, experiment write-ups and any time measured data needs an uncertainty or a figure.
---

# lab-report

A lab result without an uncertainty cannot be compared with anything. Work out the uncertainty
first, then write.

## 1. Data

- Load raw data as it was recorded. Never edit the raw file; clean into a new one.
- Record each instrument's resolution or stated accuracy, with its source (datasheet, manual,
  "half the smallest division").

## 2. Uncertainty

- **Repeated readings**: mean, standard deviation, standard error `s / sqrt(n)`.
- **Single readings**: use the instrument uncertainty.
- **Propagate** to the derived result. Use the `uncertainties` Python package, which does
  first-order propagation for you:
  ```python
  from uncertainties import ufloat
  d = ufloat(0.02500, 0.00001)   # m, micrometer
  F = ufloat(1200, 5)            # N, load cell
  sigma = F / (3.14159 * d**2 / 4)
  print(f"{sigma:.2uP} Pa")
  ```
- When the function is strongly non-linear, check with Monte Carlo (sample inputs, compute,
  take the spread).
- Quote the result as `value +/- uncertainty unit`, uncertainty to 1 or 2 significant figures,
  value rounded to the same decimal place.
- Say which input contributes most to the uncertainty. That is the useful sentence in the
  discussion.

## 3. Figures

matplotlib, one idea per figure:

- Axis labels with units: `Strain (mm/mm)`, `Stress (MPa)`.
- Measured points as markers with error bars; theory or fit as a line. Legend says which is which.
- Fit with `numpy.polyfit` or `scipy.optimize.curve_fit` and report the fitted parameters with
  their uncertainty and R^2.
- Save as vector (`.pdf` or `.svg`) for LaTeX or Word, 300 dpi `.png` otherwise.
- Caption says what the figure shows and the conditions, not "Graph of results".

## 4. Report

Usual order unless the course template says otherwise:

1. Aim (one or two sentences).
2. Theory (equations used, with symbols defined).
3. Method (equipment, procedure, enough to repeat it).
4. Results (tables and figures, each referred to in the text).
5. Uncertainty (sources, how propagated, the budget).
6. Discussion: does the result agree with theory within uncertainty? If not, give the most likely
   cause, backed by the uncertainty budget, not a guess like "human error".
7. Conclusion (the numbers, with uncertainty, answering the aim).

## Rules

- Follow the course template and marking rubric over this order.
- Never invent, smooth or drop data points. An outlier is discussed, or excluded with a stated
  reason.
- For graded work, the student writes the discussion; help with structure, checks and wording.
