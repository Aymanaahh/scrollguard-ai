"""
ScrollGuard AI – Quick Manual Test

Sends the scam_dataset.json URLs to the /scan_links endpoint
and prints a compact summary of each result.

Usage:
    python test_scan.py
"""

import json
import os
import sys

import requests

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FILE = os.path.join(_SCRIPT_DIR, "scam_dataset.json")
API_URL = "http://127.0.0.1:8000/scan_links"


def main():
    with open(DATASET_FILE, "r", encoding="utf-8") as f:
        dataset = json.load(f)

    urls = [item["url"] for item in dataset]

    try:
        response = requests.post(API_URL, json={"urls": urls}, timeout=120)
    except requests.ConnectionError:
        print("ERROR: Could not connect to the backend.")
        print("       Make sure Uvicorn is running on port 8000.")
        sys.exit(1)

    if response.status_code != 200:
        print(f"ERROR: HTTP {response.status_code}")
        print(response.text)
        return

    results = response.json()
    for result in results:
        print(f"{result['url']} → {result['status']} (Score {result.get('score', '?')}/100)")
        print(f"  Explanation: {result.get('explanation', '')}")
        reasons = result.get("reasons", [])
        if reasons:
            print(f"  Reasons: {', '.join(reasons)}")
        print("-" * 50)


if __name__ == "__main__":
    main()
