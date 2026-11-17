"""Speaks lines with Kokoro (https://huggingface.co/hexgrad/Kokoro-82M, Apache 2.0) through
kokoro-onnx (MIT). Called by make-speech.mjs:  python speak.py <jobs.json> <model folder> <out folder>
A job is {"key", "text", "voice", "lang", "speed"}; "voice" is a voice name or a blend {name: weight}."""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

jobs = json.load(open(sys.argv[1]))
models, out = sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
kokoro = Kokoro(os.path.join(models, 'kokoro-v1.0.onnx'), os.path.join(models, 'voices-v1.0.bin'))
made = 0
for j in jobs:
    path = os.path.join(out, j['key'] + '.wav')
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        continue
    voice = j['voice']
    if isinstance(voice, dict):
        total = sum(voice.values())
        voice = sum(kokoro.get_voice_style(name) * (weight / total) for name, weight in voice.items())
    samples, rate = kokoro.create(j['text'], voice=voice, speed=j.get('speed', 1.0), lang=j.get('lang', 'en-us'))
    sf.write(path, samples, rate)
    made += 1
print(f'{made} spoken, {len(jobs) - made} already there')
