import io
import json
import sys
from pathlib import Path
from PIL import Image
import pytest
from callrouter import hook


@pytest.fixture(autouse=True)
def mock_cache(tmp_path, monkeypatch):
    cache_dir = tmp_path / "cache"
    monkeypatch.setattr(hook, "CACHE", cache_dir)
    return cache_dir


def test_decide_large_png(tmp_path):
    img_path = tmp_path / "large.png"
    Image.new("RGB", (1600, 1000), color="blue").save(img_path)
    res = hook.decide({"file_path": str(img_path), "keep_me": "yes"})
    assert res is not None
    assert res["keep_me"] == "yes"
    assert res["file_path"] != str(img_path)
    with Image.open(res["file_path"]) as im:
        assert max(im.size) <= 784
        assert max(im.size) == 784


def test_decide_small_png(tmp_path):
    img_path = tmp_path / "small.png"
    Image.new("RGB", (200, 150), color="red").save(img_path)
    assert hook.decide({"file_path": str(img_path)}) is None


def test_decide_unchanged_image_reuses_cache(tmp_path):
    img_path = tmp_path / "large.png"
    Image.new("RGB", (1600, 1000), color="green").save(img_path)
    res1 = hook.decide({"file_path": str(img_path)})
    cached_file = Path(res1["file_path"])
    mtime = cached_file.stat().st_mtime_ns
    res2 = hook.decide({"file_path": str(img_path)})
    assert res2 == res1
    assert cached_file.stat().st_mtime_ns == mtime


def test_decide_large_text_file(tmp_path):
    txt_path = tmp_path / "large.txt"
    txt_path.write_text("a" * 15000)
    res = hook.decide({"file_path": str(txt_path), "extra": "val"})
    assert res == {"file_path": str(txt_path), "extra": "val", "limit": 300}


def test_decide_large_text_file_with_limit_or_offset(tmp_path):
    txt_path = tmp_path / "large.txt"
    txt_path.write_text("a" * 15000)
    assert hook.decide({"file_path": str(txt_path), "limit": 100}) is None
    assert hook.decide({"file_path": str(txt_path), "offset": 50}) is None
    assert hook.decide({"file_path": str(txt_path), "limit": 100, "offset": 50}) is None


def test_decide_small_text_file(tmp_path):
    txt_path = tmp_path / "small.txt"
    txt_path.write_text("a" * 11999)
    assert hook.decide({"file_path": str(txt_path)}) is None


def test_decide_skip_extensions(tmp_path):
    pdf = tmp_path / "doc.pdf"
    pdf.write_bytes(b"x" * 15000)
    assert hook.decide({"file_path": str(pdf)}) is None

    ipynb = tmp_path / "notebook.ipynb"
    ipynb.write_bytes(b"x" * 15000)
    assert hook.decide({"file_path": str(ipynb)}) is None


def test_decide_missing_file_and_missing_path(tmp_path):
    assert hook.decide({"file_path": str(tmp_path / "missing.txt")}) is None
    assert hook.decide({}) is None
    assert hook.decide({"other": "value"}) is None


def test_main_non_read_tool(monkeypatch, capsys):
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": "ls"}})
    monkeypatch.setattr(sys, "stdin", io.StringIO(payload))
    hook.main()
    out, err = capsys.readouterr()
    assert out == ""
    assert err == ""


def test_main_invalid_json(monkeypatch, capsys):
    monkeypatch.setattr(sys, "stdin", io.StringIO("{invalid json"))
    hook.main()
    out, err = capsys.readouterr()
    assert out == ""
    assert err == ""


def test_main_read_large_text_file(tmp_path, monkeypatch, capsys):
    txt_path = tmp_path / "large.txt"
    txt_path.write_text("x" * 15000)
    payload = json.dumps({
        "tool_name": "Read",
        "tool_input": {"file_path": str(txt_path), "other": "keep"},
    })
    monkeypatch.setattr(sys, "stdin", io.StringIO(payload))
    hook.main()
    out, err = capsys.readouterr()
    assert err == ""
    data = json.loads(out)
    assert data["hookSpecificOutput"]["hookEventName"] == "PreToolUse"
    assert data["hookSpecificOutput"]["permissionDecision"] == "allow"
    assert data["hookSpecificOutput"]["updatedInput"]["limit"] == 300
    assert data["hookSpecificOutput"]["updatedInput"]["file_path"] == str(txt_path)
    assert data["hookSpecificOutput"]["updatedInput"]["other"] == "keep"


def test_main_corrupt_png(tmp_path, monkeypatch, capsys):
    corrupt = tmp_path / "corrupt.png"
    corrupt.write_bytes(b"\x00\x01\x02\x03\xff\xfe\xca\xfe")
    payload = json.dumps({
        "tool_name": "Read",
        "tool_input": {"file_path": str(corrupt)},
    })
    monkeypatch.setattr(sys, "stdin", io.StringIO(payload))
    hook.main()
    out, err = capsys.readouterr()
    assert out == ""
    assert err == ""
