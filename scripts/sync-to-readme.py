#!/usr/bin/env python3
"""
Syncs docs/extole-cli.md to the Extole CLI page in ReadMe.com.

Triggered by GitHub Actions on any push to main that touches docs/extole-cli.md.
The source file is the curated user-facing overview; the full README.md is the
developer reference and is NOT synced automatically.

To update the docs page, edit docs/extole-cli.md and push to main.

Requires:
  README_API_KEY  -- ReadMe API key (store as a GitHub Actions secret)
  README_BRANCH   -- ReadMe branch/version slug (e.g. stable or 4.0.0)
  README_SLUG     -- ReadMe page slug (extole-cli)
  SOURCE_FILE     -- Path to the markdown source file (docs/extole-cli.md)
"""

import os
import sys
import requests

README_API_KEY = os.environ["README_API_KEY"]
BRANCH = os.environ.get("README_BRANCH", "stable")
SLUG = os.environ.get("README_SLUG", "extole-cli")
SOURCE_FILE = os.environ.get("SOURCE_FILE", "docs/extole-cli.md")

PATCH_URL = f"https://api.readme.com/v2/branches/{BRANCH}/guides/{SLUG}"


def load_source(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


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
    body = load_source(SOURCE_FILE)
    patch_readme(body)


if __name__ == "__main__":
    main()
