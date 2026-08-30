import json
import requests
from sklearn.metrics import classification_report, confusion_matrix

DATASET_FILE = "scam_dataset.json"
API_URL = "http://127.0.0.1:8000/scan_links"

def load_dataset():
    with open(DATASET_FILE, "r") as f:
        return json.load(f)

def evaluate_engine():
    dataset = load_dataset()
    urls = [item["url"] for item in dataset]
    expected = [item["expected_status"] for item in dataset]

    # Send batch request to backend
    response = requests.post(API_URL, json={"urls": urls})
    if response.status_code != 200:
        print("Error:", response.status_code, response.text)
        return

    results = response.json()
    predicted = [result["status"] for result in results]

    # Print per‑URL comparison
    print("\n--- Individual Results ---")
    for item, result in zip(dataset, results):
        print(f"Platform: {item['platform']}")
        print(f"Text: {item['text']}")
        print(f"URL: {item['url']}")
        print(f"Expected: {item['expected_status']} | Predicted: {result['status']} (Risk {result['risk_score']}/100)")
        print(f"Explanation: {result['explanation']}")
        print(f"Reasons: {', '.join(result['flagged_reasons'])}")
        print("-" * 60)

    # Print overall metrics
    print("\n--- Evaluation Metrics ---")
    print(classification_report(expected, predicted, labels=["Safe", "Suspicious", "Dangerous"]))
    print("Confusion Matrix:\n", confusion_matrix(expected, predicted, labels=["Safe", "Suspicious", "Dangerous"]))

if __name__ == "__main__":
    evaluate_engine()
