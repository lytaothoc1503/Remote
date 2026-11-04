import sys

from google import genai

sys.stdout.reconfigure(encoding="utf-8")

# The client automatically reads the GEMINI_API_KEY environment variable.
client = genai.Client()

interaction = client.interactions.create(
    model="gemini-3.5-flash-lite",
    input="Xin chào! Hãy giới thiệu ngắn gọn về bạn trong 1 câu.",
)
print(interaction.output_text)
