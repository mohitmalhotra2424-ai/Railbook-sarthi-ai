#!/usr/bin/env python3
"""P36 live selection verification — REAL model + REAL provider, local prod build.
Proves number/name/position identities traverse the actual /api/assistant flow
and resolve against the full current results. Prints evidence, no secrets."""
import json, sys, time, urllib.request

BASE = "http://127.0.0.1:3105/api/assistant"

def turn(conv, msg):
    body = {"message": msg}
    if conv:
        body["conversationId"] = conv
    req = urllib.request.Request(BASE, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=240) as r:
        raw = r.read().decode("utf-8", "replace")
    events = []
    for chunk in raw.split("\n\n"):
        for line in chunk.splitlines():
            if line.startswith("data: "):
                try:
                    events.append(json.loads(line[6:]))
                except json.JSONDecodeError:
                    pass
    return conv or next((e.get("conversationId") for e in events if e.get("conversationId")), None), events, time.time() - t0

def summarize(events):
    out = {"tools": [], "results": [], "selection": None, "cards": None, "text": ""}
    for e in events:
        t = e.get("type")
        if t == "tool_call":
            out["tools"].append(f'{e.get("tool")}({e.get("argsSummary")})')
        elif t == "tool_result":
            out["results"].append(f'{e.get("tool")}:{e.get("status")}')
        elif t == "passenger_form":
            sel = e.get("selection") or {}
            out["selection"] = {k: sel.get(k) for k in ("trainNumber", "trainName", "journeyDate")}
        elif t == "message":
            if e.get("cards"):
                out["cards"] = [(c.get("trainNumber"), c.get("trainName")) for c in e["cards"]]
            out["text"] = (e.get("text") or "")[:160]
    return out

conv = None
print("=== TURN 1: search LDH->NDLS 2026-10-12 ===")
conv, ev, dt = turn(conv, "Mujhe 12 October 2026 ko Ludhiana se New Delhi jaana hai, saari trains dikhao")
s = summarize(ev)
print(f"{dt:.1f}s tools={s['tools']} results={s['results']}")
cards = s["cards"] or []
print(f"cards: {len(cards)} rows; first={cards[0] if cards else None}")
if len(cards) < 26:
    print("!! fewer than 26 rows — abort position test"); sys.exit(1)
target = cards[24]
print(f"position 25 = {target}")

print("\n=== TURN 2: position-based ('25th train select karo') ===")
conv, ev, dt = turn(conv, "25th train select karo")
s2 = summarize(ev)
print(f"{dt:.1f}s tools={s2['tools']} results={s2['results']} selection={s2['selection']}")
print(f"MATCH position25: {(s2['selection'] or {}).get('trainNumber') == target[0]}")

print("\n=== TURN 3: name-based (real name of a beyond-8 train) ===")
conv, ev, dt = turn(conv, f"{target[1]} select karni hai")
s3 = summarize(ev)
print(f"{dt:.1f}s tools={s3['tools']} results={s3['results']} selection={s3['selection']}")
print(f"MATCH name: {(s3['selection'] or {}).get('trainNumber') == target[0]}")

print("\n=== TURN 4: number-based ===")
conv, ev, dt = turn(conv, f"{target[0]} select karo")
s4 = summarize(ev)
print(f"{dt:.1f}s tools={s4['tools']} results={s4['results']} selection={s4['selection']}")
print(f"MATCH number: {(s4['selection'] or {}).get('trainNumber') == target[0]}")
