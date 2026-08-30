import json
import requests

# Load dataset
with open("scam_dataset.json", "r") as f:
    dataset = json.load(f)

urls = [item["url"] for item in dataset]

# Send batch request
response = requests.post("http://127.0.0.1:8000/scan_links", json={"urls": urls})

if response.status_code == 200:
    results = response.json()
    for result in results:
        print(f"{result['url']} → {result['status']} (Risk {result['risk_score']}/100)")
        print("Explanation:", result['explanation'])
        print("Reasons:", ", ".join(result['flagged_reasons']))
        print("-" * 50)
else:
    print("Error:", response.status_code, response.text)
