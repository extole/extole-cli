#!/usr/bin/env python3
"""
Syncs the extole-cli README.md to the Extole CLI page in ReadMe.com.

Triggered by GitHub Actions on any push to master that touches README.md.
Requires:
  README_API_KEY  — ReadMe API key (store as a GitHub Actions secret)
  README_BRANCH   — ReadMe branch/version slug (e.g. 4.0.0_extole-ai-docs or stable)
  README_SLUG     — ReadMe page slug (extole-cli)
"""

import os
import re
import sys
import requests

README_API_KEY = os.environ["README_API_KEY"]
BRANCH = os.environ.get("README_BRANCH", "stable")
SLUG = os.environ.get("README_SLUG", "extole-cli")

PATCH_URL = f"https://api.readme.com/v2/branches/{BRANCH}/guides/{SLUG}"


def load_readme(path="README.md") -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def transform(content: str) -> str:
    # Drop the top-level H1 — ReadMe uses the page title field for that
    content = re.sub(r"^#\s+.+\n\n?", "", content, count=1)

    # Drop the Table of Contents section (everything from the ToC heading
    # up to — but not including — the next ## heading)
    content = re.sub(
        r"(?m)^##\s+Table of Contents\s*\n.*?(?=\n##\s)",
        "",
        content,
        flags=re.DOTALL,
    )

    # Replace em-dashes (—) with double-hyphens to avoid ReadMe API 500s
    content = content.replace("—", "--")

    return content.strip()


def patch_readme(body: str) -> None:
    resp = requests.patch(
        PATCH_URL,
        json={"content": {"body": body}},
        headers={
            "Authorization": f"Bearer {README_API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )

    if not resp.ok:
        print(f"ERROR {resp.status_code}: {resp.text}", file=sys.stderr)
        sys.exit(1)

    updated_at = resp.json()["data"]["updated_at"]
    print(f"Updated ReadMe page '{SLUG}' on branch '{BRANCH}' at {updated_at}")


def main():
    raw = load_readme()
    body = transform(raw)
    patch_readme(body)


if __name__ == "__main__":
    main()
