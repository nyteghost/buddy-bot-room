#!/usr/bin/env python3
"""Manual QA: make 100 underneath-window clicks auditable.

Run from a KDE Wayland terminal, before starting the S1 *top-layer* overlay.
Tkinter may run via XWayland; log the backend/environment for reproduction.
"""
import tkinter as tk

root = tk.Tk()
root.title("S1 Underlay: click-through audit (NOT the overlay)")
root.attributes("-fullscreen", True)
root.configure(bg="#132136")
count = 0
seen = set()
label = tk.Label(root, fg="white", bg="#132136", font=("Sans", 18),
                 text="Click 100 uniquely numbered spots outside the Pal. Escape exits.")
label.pack(fill="x")
status = tk.Label(root, fg="#8ee8ac", bg="#132136", font=("Sans", 22), text="Pass-through: 0/100")
status.pack(fill="x")
canvas = tk.Canvas(root, bg="#253950", highlightthickness=0)
canvas.pack(fill="both", expand=True)

def draw(_event=None):
    canvas.delete("all")
    w, h = canvas.winfo_width(), canvas.winfo_height()
    if w < 10 or h < 10:
        return
    for row in range(10):
        for col in range(10):
            n = row * 10 + col + 1
            x, y = (col + 0.5) * w / 10, (row + 0.5) * h / 10
            # Place numeric targets away from the exact center of the monitor
            # when speed=0 leaves the Pal static in the middle.
            fill = "#23ae6b" if n in seen else "#6486a7"
            canvas.create_oval(x - 16, y - 16, x + 16, y + 16, fill=fill, outline="")
            canvas.create_text(x, y, text=str(n), fill="white", font=("Sans", 11))

def click(event):
    global count
    w, h = canvas.winfo_width(), canvas.winfo_height()
    col = min(9, max(0, int(event.x * 10 / w)))
    row = min(9, max(0, int(event.y * 10 / h)))
    n = row * 10 + col + 1
    count += 1
    seen.add(n)
    status.configure(text=f"Pass-through: {count}/100; unique target cells: {len(seen)}/100")
    print(f"S1_UNDERLAY_CLICK number={count} cell={n} unique={len(seen)}", flush=True)
    draw()

canvas.bind("<Configure>", draw)
canvas.bind("<Button-1>", click)
root.bind("<Escape>", lambda _e: root.destroy())
root.mainloop()
