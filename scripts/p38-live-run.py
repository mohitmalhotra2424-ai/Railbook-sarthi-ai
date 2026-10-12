#!/usr/bin/env python3
"""P38 live staging run — real provider availability batch via /api/assistant.
Turn 1: search LDH->NDLS. Turn 2: '3A confirmed seats only' (availableOnly).
Turn 3: same request again (reuse-window evidence). No secrets printed."""
import json, time, urllib.request

BASE = "http://localhost:3107/api/assistant"
TURNS = [
    "15 October ko Ludhiana se Delhi jaana hai, trains dikhao",
    "Sirf 3A mein confirmed seats wali trains dikhao",
    "Abhi fresh check karke 3A confirmed wali trains dikhao",
]

conv = None
for i, msg in enumerate(TURNS, 1):
    body = {"message": msg}
    if conv:
        body["conversationId"] = conv
    req = urllib.request.Request(BASE, data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=170) as r:
            raw = r.read().decode("utf-8", "replace")
    except Exception as e:
        print(f"--- turn {i} FAILED: {e}")
        continue
    dt = time.time() - t0
    events = []
    for chunk in raw.split("\n\n"):
        for line in chunk.splitlines():
            if line.startswith("data: "):
                try:
                    events.append(json.loads(line[6:]))
                except json.JSONDecodeError:
                    pass
    print(f"\n===== TURN {i} ({dt:.1f}s): {msg}")
    for e in events:
        t = e.get("type")
        if t == "tool_call":
            print(f"  TOOL_CALL {e.get('name')} args={json.dumps(e.get('args'), ensure_ascii=False)}")
        elif t == "tool_result":
            note = (e.get("note") or "").replace("\n", " ")
            print(f"  TOOL_RESULT {e.get('tool')} status={e.get('status')} note={note[:400]}")
        elif t == "message":
            cards = e.get("cards") or []
            print(f"  MESSAGE cards={len(cards)}")
            for c in cards[:10]:
                av = c.get("availability") or []
                print(f"    card {c.get('trainNumber')} {c.get('trainName')} avail={av}")
            if len(cards) > 10:
                print(f"    ... +{len(cards)-10} more cards")
            txt = (e.get("text") or "").replace("\n", " ")
            print(f"  REPLY: {txt[:500]}")
        elif t == "error":
            print(f"  ERROR {e}")
    conv = next((e.get("conversationId") for e in events if e.get("type") == "conversation"), conv)
print(f"\nconversationId={conv}")
