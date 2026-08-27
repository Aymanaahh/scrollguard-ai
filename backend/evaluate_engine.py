import json
import requests

API_URL = "http://127.0.0.1:8000/analyze"

def run_evaluation():
    try:
        with open("scam_dataset.json", "r") as f:
            dataset = json.load(f)
    except FileNotFoundError:
        print("Error: scam_dataset.json not found!")
        return

    correct = 0
    total = len(dataset)

    print(f"Starting evaluation on {total} samples...\n" + "-" * 50)

    for item in dataset:
        payload = {
            "url": item.get("url", ""),
            "text": item.get("text", ""),
            "platform": item.get("platform", "Unknown")
        }

        try:
            res = requests.post(API_URL, json=payload)
            if res.status_code == 200:
                data = res.json()
                predicted = data.get("status")
                expected = item.get("expected_status")

                is_correct = predicted == expected
                if is_correct:
                    correct += 1

                print(f"Sample #{item['id']} | Platform: {item['platform']}")
                print(f"Expected: {expected} | Predicted: {predicted} | Match: {'YES' if is_correct else 'NO'}")
                print(f"Risk Score: {data.get('risk_score')} | Explanation: {data.get('explanation')}\n" + "-" * 50)
            else:
                print(f"Sample #{item['id']} failed with status code {res.status_code}")
        except Exception as e:
            print(f"Sample #{item['id']} request error: {e}")

    accuracy = (correct / total) * 100 if total > 0 else 0
    print(f"\nEvaluation Complete! Accuracy: {accuracy:.2f}% ({correct}/{total} correct)")

if __name__ == "__main__":
    run_evaluation()