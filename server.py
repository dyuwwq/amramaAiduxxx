from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()
app = Flask(__name__)
CORS(app)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

@app.route("/ask", methods=["POST"])
def ask():
    data = request.json
    question = data.get("question","").strip()
    if not question:
        return jsonify({"reply":"Вопрос пустой"}),400
    try:
        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role":"system","content":"Ты AI ассистент проекта AIDUX. Отвечай кратко и современно."},
                {"role":"user","content":question}
            ]
        )
        reply = completion.choices[0].message.content
        return jsonify({"reply":reply})
    except Exception as e:
        print(e)
        return jsonify({"reply":"Ошибка сервера. Попробуйте позже."}),500

if __name__=="__main__":
    app.run(port=5000)