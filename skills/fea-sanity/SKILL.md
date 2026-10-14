---
name: fea-sanity
description: Set up and check finite element (FEA) or CFD simulations so the result can be trusted, with a hand calculation to compare against, a mesh convergence study and a boundary condition review. Use with ANSYS, Abaqus, SolidWorks Simulation, Fusion, CalculiX, FEniCS or OpenFOAM, and whenever a simulation result needs checking.
---

# fea-sanity

A simulation always gives a colourful answer. This skill is about whether the answer is right.
It is about method, not one solver's buttons.

## Before solving

1. **Hand calculation first.** Find the nearest textbook case (beam bending, thick cylinder,
   plate with a hole and its stress concentration factor, pipe flow with Moody chart) and work it
   with the `eng-calc` skill. Write down the number you expect and its order of magnitude.
2. **Units.** Pick one consistent system (mm, N, MPa, tonne, s is common) and say it. Most
   solvers have no units; a wrong density or modulus is silent.
3. **Material.** E, Poisson's ratio, density, yield, each with a source. Linear elastic unless
   there is a reason not to be.
4. **Boundary conditions.** For each: what it is, where, and what real thing it models. Check for:
   - rigid-body motion (the model must be fully constrained, but not over-constrained);
   - point loads or point supports, which give infinite stress at that node;
   - symmetry planes applied correctly.

## After solving

1. **Reactions balance the loads.** Sum of reaction forces equals applied load. If not, stop.
2. **Deformed shape makes sense.** Look at it, scaled. It should bend the way intuition says.
3. **Compare with the hand calculation.** Within about 10 to 20 percent away from stress
   raisers is normal. A factor of 10 or 1000 is a units error.
4. **Mesh convergence.** Solve at three mesh sizes, each about half the last. Plot the quantity of
   interest against element count. Report the value once it changes by less than about 5 percent.
   A peak stress that keeps rising as the mesh refines is a singularity (sharp corner, point
   load), not a real stress.
5. **Read stress in the right place.** Use the stress measure that fits the failure mode (von
   Mises for ductile yield, max principal for brittle), away from singularities.

## CFD additions

- Check y+ for the wall treatment the turbulence model expects.
- Watch residuals and a monitored quantity (drag, pressure drop) until both settle.
- Check mass in equals mass out.

## Rules

- Report the result with the mesh study and the hand-calc comparison, not a contour plot alone.
- Never present a singularity peak as a design stress.
- For graded work, explain each check so the student can run it themselves.
