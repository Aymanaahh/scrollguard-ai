"""
ScrollGuard AI – Automated Evaluation Script

Sends the scam_dataset.json URLs to the /scan_links endpoint,
compares predicted labels against expected labels, and prints
a classification report + confusion matrix.

Usage:
    python evaluate_engine.py
"""

import json
import os
import sys

import requests
from sklearn.metrics import classification_report, confusion_matrix

# Resolve dataset path relative to this script
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_FILE = os.path.join(_SCRIPT_DIR, "scam_dataset.json")
API_URL = "http://127.0.0.1:8000/scan_links"


def load_dataset():
    with open(DATASET_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def evaluate_engine():
    dataset = load_dataset()
    urls = [item["url"] for item in dataset]
    expected = [item["expected_status"] for item in dataset]

    # Batch request to backend
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
    predicted = [r["status"] for r in results]

    # Per-URL comparison
    print("\n--- Individual Results ---")
    for item, result in zip(dataset, results):
        print(f"Platform: {item['platform']}")
        print(f"Text:     {item['text']}")
        print(f"URL:      {item['url']}")
        print(
            f"Expected: {item['expected_status']:12s} | "
            f"Predicted: {result['status']:12s} "
            f"(Score {result.get('score', '?')}/100)"
        )
        print(f"Explanation: {result.get('explanation', '')}")
        reasons = result.get("reasons", [])
        if reasons:
            print(f"Reasons: {', '.join(reasons)}")
        print("-" * 60)

    # Overall metrics
    labels = ["Safe", "Suspicious", "Dangerous"]
    print("\n--- Evaluation Metrics ---")
    print(classification_report(expected, predicted, labels=labels, zero_division=0))
    print("Confusion Matrix:")
    print(confusion_matrix(expected, predicted, labels=labels))


if __name__ == "__main__":
    evaluate_engine()
