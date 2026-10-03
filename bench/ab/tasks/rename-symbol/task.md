The function `get_usr` is used across 4 Python files in the `pkg` package.
Rename `get_usr` to `get_user` across all 4 files:
- `pkg/__init__.py`
- `pkg/core.py`
- `pkg/service.py`
- `pkg/client.py`

Update definitions, imports, calls, and `__all__`.
Ensure that no occurrence of `get_usr` remains and that `pkg` can be imported cleanly.
