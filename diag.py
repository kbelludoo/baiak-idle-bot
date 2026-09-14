from playwright.sync_api import sync_playwright
import os, time, json

token = ""
with open("/app/.env") as f:
    for line in f:
        if line.startswith("BAIAK_TOKEN="):
            token = line.split("=", 1)[1].strip()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"])
    context = browser.new_context(viewport={"width": 1280, "height": 720})
    page = context.new_page()
    
    page.on("console", lambda m: print(f"CONSOLE [{m.type}]: {m.text}"))
    page.on("pageerror", lambda e: print(f"PAGEERROR: {e}"))
    
    page.add_init_script(f"""
        localStorage.setItem("baiak-idle-token", "{token}");
        localStorage.setItem("idle.auth.token", "{token}");
        localStorage.setItem("token", "{token}");
    """)
    
    page.goto("https://baiakidle.com/jogar/", wait_until="commit", timeout=30000)
    
    for i in range(12):
        time.sleep(1)
        res = page.evaluate("""() => {
            const modals = Array.from(document.querySelectorAll('.modal, [role="dialog"], #picker-modal, .bb-modal, .overlay:not(.hidden)')).map(m => ({
                id: m.id,
                className: m.className,
                text: m.innerText.replace(/\\s+/g, ' ').slice(0, 100)
            }));
            return {
                title: document.title,
                wave: document.getElementById('wave-title')?.textContent,
                stamina: document.getElementById('stamina-time')?.textContent,
                gold: document.getElementById('gold-count')?.textContent || document.querySelector('.gold')?.textContent,
                level: document.querySelector('.player-level')?.textContent,
                modals
            };
        }""")
        print(f"[{i}s] {res}")
        if res.get("level") or (res.get("wave") and res.get("wave") != "—"):
            print("GAME FULLY ACTIVE!")
            break

    # Screenshot
    cdp = context.new_cdp_session(page)
    res = cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": 80, "fromSurface": False})
    cdp.detach()
    import base64
    with open("/app/data/diag_screen.jpg", "wb") as f:
        f.write(base64.b64decode(res["data"]))
    print("Screenshot saved to /app/data/diag_screen.jpg")
    browser.close()
