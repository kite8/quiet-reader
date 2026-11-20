#!/usr/bin/env python3
"""Build the installable userscript and the small update manifest. No packages needed."""

from pathlib import Path
import argparse
import re
import sys

ROOT = Path(__file__).resolve().parent
REPOSITORY = "kite8/quiet-reader"
BRANCH = "main"


def render():
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("VERSION must contain a release number such as 2.1.0")
    raw = f"https://raw.githubusercontent.com/{REPOSITORY}/{BRANCH}/dist"
    homepage = f"https://github.com/{REPOSITORY}"
    header = f"""// ==UserScript==
// @name         Quiet Reader · 阅读控制台
// @namespace    {homepage}
// @version      {version}
// @description  弹窗阅读、独立功能开关与可暂停的连续浏览。
// @author       Fashion; kite8
// @license      MIT
// @match        https://linux.do/*
// @homepageURL  {homepage}
// @supportURL   {homepage}/issues
// @downloadURL  {raw}/quiet-reader.user.js
// @updateURL    {raw}/quiet-reader.meta.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==
"""
    reader = (ROOT / "src/reader.js").read_text(encoding="utf-8")
    reader = re.sub(r"\A// ==UserScript==.*?// ==/UserScript==\s*", "", reader, count=1, flags=re.S)
    panel = (ROOT / "src/settings-panel.js").read_text(encoding="utf-8")
    panel = panel.replace("__QUIET_READER_VERSION__", version)
    automation = (ROOT / "src/automation.js").read_text(encoding="utf-8")
    anchor = "  'use strict';"
    if reader.count(anchor) != 1 or not reader.rstrip().endswith("})();"):
        raise ValueError("Reader wrapper changed; review module insertion points")
    reader = reader.replace(anchor, anchor + "\n\n" + panel.rstrip() + "\n", 1)
    end = reader.rfind("})();")
    reader = reader[:end] + automation.rstrip() + "\n\n  LDR.ui.init();\n  LDR.automation.init();\n" + reader[end:]
    license_text = (ROOT / "LICENSE").read_text(encoding="utf-8").strip()
    provenance = "Reader foundation: Fashion, MIT. Source and revision are recorded in NOTICE."
    code = header + "\n/*\n" + provenance + "\n\n" + license_text + "\n*/\n\n" + reader.rstrip() + "\n"
    if "__QUIET_READER_VERSION__" in code:
        raise ValueError("Unresolved release marker")
    return {"quiet-reader.user.js": code, "quiet-reader.meta.js": header}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if committed release files are stale")
    args = parser.parse_args()
    outputs = render()
    folder = ROOT / "dist"
    if args.check:
        stale = [name for name, content in outputs.items()
                 if not (folder / name).is_file() or (folder / name).read_text(encoding="utf-8") != content]
        if stale:
            print("Rebuild required: " + ", ".join(stale), file=sys.stderr)
            return 1
        print("Release files match source and VERSION.")
    else:
        folder.mkdir(exist_ok=True)
        for name, content in outputs.items():
            (folder / name).write_text(content, encoding="utf-8")
            print(f"Built dist/{name} ({len(content.encode('utf-8')):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
