```markdown

\# ScrollGuard AI



> \*\*Real-Time AI Link Safety and Scam Detection Engine\*\*  

> \*Built for the Alibaba Cloud AI Hackathon by \*\*Team Raven\*\*\*



ScrollGuard AI is an intelligent browser security extension and API backend designed to protect users from phishing attempts, deceptive giveaway schemes, fraudulent domains, and social media scam links in real time.





\## Key Features



\- \*\*Real-Time URL and Content Scanning:\*\* Instantly inspects active web pages, titles, and incoming links straight from your browser.

\- \*\*Qwen LLM Intelligence:\*\* Powered by Alibaba Cloud's `qwen3.7-plus` model via the DashScope API to analyze context, urgency tactics, and domain reputation.

\- \*\*Structured Risk Scoring:\*\* Returns strict JSON reports categorized into clear threat levels:

&#x20; - \*\*Safe:\*\* Standard verified URLs and benign content.

&#x20; - \*\*Suspicious:\*\* Urgency tactics, shortened links (`bit.ly`), or questionable claims.

&#x20; - \*\*Dangerous:\*\* Confirmed phishing schemes, fake giveaway links (such as fraudulent BISP or banking alerts), and credential harvesting.

\- \*\*Lightweight Chrome Extension:\*\* Built with Manifest V3 for high performance, minimal resource consumption, and seamless UI feedback.

\- \*\*Automated Evaluation Benchmark:\*\* Includes an automated accuracy testing script (`evaluate\_engine.py`) for dataset validation.







\## Architecture and Tech Stack



\- \*\*Backend:\*\* Python 3.12, FastAPI, Uvicorn, Pydantic, Python-Dotenv

\- \*\*AI Engine:\*\* Alibaba Cloud Model Studio (DashScope OpenAI-Compatible API using `qwen3.7-plus`)

\- \*\*Frontend:\*\* Google Chrome / Microsoft Edge Extension (Manifest V3, JavaScript, HTML5, CSS3)

\- \*\*DevOps and Version Control:\*\* Git, GitHub







\## Installation and Setup Guide



\### 1. Prerequisites

\- Python 3.10+ installed

\- Google Chrome or Microsoft Edge browser

\- An active Alibaba Cloud Model Studio API Key







\### 2. Backend Setup



1\. \*\*Clone the repository:\*\*



&#x20;  git clone \[https://github.com/Aymanaahh/scrollguard-ai.git](https://github.com/Aymanaahh/scrollguard-ai.git)

&#x20;  cd scrollguard-ai/backend







2\. \*\*Install dependencies:\*\*



pip install fastapi uvicorn openai python-dotenv pydantic requests





3\. \*\*Configure Environment Variables:\*\*

Create a `.env` file inside the `backend/` directory:

```env

DASHSCOPE\_API\_KEY=your\_actual\_dashscope\_api\_key\_here





> \*\*Note:\*\* Do not surround the API key with quotation marks, and ensure `.env` is listed in your `.gitignore` file.





4\. \*\*Launch the FastAPI Server:\*\*



python -m uvicorn main:app --reload --port 8000









\* Access interactive API documentation at: `http://127.0.0.1:8000/docs`





\### 3. Chrome / Edge Extension Setup



1\. Open your browser and navigate to:

\* \*\*Chrome:\*\* `chrome://extensions/`

\* \*\*Edge:\*\* `edge://extensions/`





2\. Toggle on \*\*Developer mode\*\* (located in the top-right corner or left sidebar).

3\. Click \*\*Load unpacked\*\*.

4\. Select the `scrollguard-ai/extension` folder.

5\. Pin \*\*ScrollGuard AI\*\* to your browser toolbar, open any web page, and click \*\*Scan This Page\*\*.







\## Running Benchmark Evaluation



To evaluate model detection accuracy against known scam samples:



1\. Ensure the FastAPI backend server is running on `http://127.0.0.1:8000`.

2\. Run the evaluation script inside `backend/`:



python evaluate\_engine.py







\## Team Raven



\* \*\*Member A\*\* – Backend Architecture and AI API Integration Lead

\* \*\*Member B\*\* – Frontend Extension and Dataset Benchmarking Lead





\*Developed for the Alibaba Cloud AI Hackathon.\*



