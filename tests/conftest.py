import pytest


@pytest.fixture(autouse=True)
def no_mcp_keepalive(monkeypatch):
    monkeypatch.setenv("METAROUTER_MCP_KEEP", "0")
