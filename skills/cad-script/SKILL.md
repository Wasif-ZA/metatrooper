---
name: cad-script
description: Build parametric 3D parts in Python with build123d (or CadQuery), export STEP and STL, and check the result by rendering it before calling it done. Use when asked to model a part, bracket, enclosure, gear, fixture or mount, or to make a CAD model scriptable or parametric.
---

# cad-script

Code CAD is easy to get almost right. A model that runs is not a model that is correct, so
measure and look at it every time.

## Setup

- Prefer `build123d` (Apache-2.0); use `CadQuery` if the project already does.
- Install into a virtual environment: `pip install build123d`. Python 3.10 to 3.13.

## Method

1. **Write the requirements as numbers** before code: overall size, hole sizes and positions,
   wall thickness, fillet radii, material, how it is made (3D print, laser, mill). Ask for any
   that are missing; never guess a mating dimension.
2. **Put every dimension in named parameters** at the top of the file, in mm:
   ```python
   from build123d import *

   length, width, thick = 60, 30, 5
   hole_d, hole_inset = 6.5, 8

   with BuildPart() as bracket:
       Box(length, width, thick)
       fillet(bracket.edges().filter_by(Axis.Z), radius=3)
       with Locations((length / 2 - hole_inset, 0, 0), (-length / 2 + hole_inset, 0, 0)):
           Hole(hole_d / 2)

   export_step(bracket.part, "bracket.step")
   export_stl(bracket.part, "bracket.stl")
   ```
3. **Measure it in code**: print the bounding box, volume and mass (volume times density) and
   compare with the requirements. Check `part.is_valid()`.
4. **Look at it**: render the STL to PNG from three views and an isometric (for example with
   `trimesh` plus `matplotlib`, or the OCP CAD Viewer in VS Code). Open the image and check the
   features are where the requirements say.
5. **Manufacturing check**: minimum wall for the process (about 1.2 mm for FDM), hole clearance
   for the fastener (M6 clearance is 6.4 to 6.6 mm), overhangs for printing, tool access for
   machining.

## Rules

- STEP is the exchange file for other CAD tools; STL is for printing only.
- Keep the script the source of truth; never hand-edit an exported file.
- If the part carries load, hand the stress question to the `eng-calc` or `fea-sanity` skill
  rather than guessing a thickness.
