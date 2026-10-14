---
name: eng-calc
description: Do engineering calculations with units carried through every step, a dimension check on each result, and the working shown with numbers substituted. Use for statics, dynamics, stress, thermodynamics, fluids, heat transfer, machine design or any hand calculation, homework or lab sum, and when checking someone else's numbers.
---

# eng-calc

Most wrong answers in engineering are unit errors, not physics errors. Carry units the whole way
and show every step so a marker, or the student, can find the slip.

## Method

1. **List the givens** with units and source: `F = 2.5 kN (problem statement)`.
   Convert nothing yet.
2. **State the model and its assumptions** in one line each: "simply supported beam, small
   deflection, linear elastic, self-weight ignored".
3. **Write the equation symbolically**, then substitute numbers with units, then the result:
   ```
   sigma = M*c / I
         = (3.75 kN*m)(0.05 m) / (8.33e-6 m^4)
         = 22.5 MPa
   ```
4. **Check dimensions** of every result. If the units do not reduce to what the quantity should
   be, stop and find the error before going on.
5. **Sanity-check the size**: compare with a known value (yield strength of mild steel is about
   250 MPa, water density 1000 kg/m^3, g = 9.81 m/s^2). Say whether the answer is plausible.
6. **Round at the end only**, to the significant figures the data supports (usually 3).
   Keep full precision in intermediate steps.

## Computing it

Prefer Python with `pint` so the units are checked by code, not by eye:

```python
import pint
u = pint.UnitRegistry()
M = 3.75 * u.kN * u.m
c = 0.05 * u.m
I = 8.33e-6 * u.m**4
sigma = (M * c / I).to(u.MPa)
print(f"{sigma:.3g~P}")
```

- `pint` raises `DimensionalityError` when units do not match; treat that as a found bug.
- For symbolic rearranging use `sympy`; for tables of properties (steam, refrigerants) use
  `CoolProp` and cite it.
- If the course uses MATLAB or Octave, write the same steps there, with units in variable
  names (`L_m`, `F_N`) and a comment line giving each input's unit.

## Rules

- Never drop a unit to make an equation balance.
- Every property value (E, yield, k, cp, viscosity) gets a source: textbook table, datasheet or
  library. Never state one from memory without saying it is approximate.
- Flag where an assumption carries the result (thin-wall, incompressible, steady state).
- For graded work, explain the method so the student can redo it unaided; do not just hand over
  the number.
