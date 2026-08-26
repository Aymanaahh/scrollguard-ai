import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("DASHSCOPE_API_KEY")
if not api_key:
    print("ERROR: Please set DASHSCOPE_API_KEY inside backend/.env")
    exit(1)

client = OpenAI(
    api_key=api_key,
    base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
)

print("Connecting to Alibaba Cloud Qwen LLM...")

try:
    response = client.chat.completions.create(
        model="qwen3.7-plus",
        messages=[
            {"role": "system", "content": "You are a cybersecurity expert analyzing suspicious links and phishing attempts."},
            {"role": "user", "content": "Analyze this message for security risks: 'Congratulations! You won 50,000 PKR from Benazir Income Support. Click to claim now! http://bisp-free-money-claim.tk/login'"}
        ]
    )

    print("\n--- Qwen API Test Output ---")
    print(response.choices[0].message.content)
    print("----------------------------")
    print("API Connection Successful!")

except Exception as e:
    print("\nAPI Call Failed:", e)