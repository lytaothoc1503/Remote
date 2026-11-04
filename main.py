import sys

from google import genai

sys.stdout.reconfigure(encoding="utf-8")

# The client reads the GEMINI_API_KEY environment variable automatically.
client = genai.Client()

response = client.models.generate_content(
    model="gemini-3.1-flash-lite-preview",
    contents="Xin chào! Hãy giới thiệu ngắn gọn về bạn trong 1 câu.",
)
print(response.text)
