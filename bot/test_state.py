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
    page.add_init_script(f"""
        localStorage.setItem("baiak-idle-token", "{token}");
        localStorage.setItem("idle.auth.token", "{token}");
        localStorage.setItem("token", "{token}");
    """)
    page.goto("https://baiakidle.com/jogar/", wait_until="commit", timeout=30000)
    time.sleep(6)
    
    info = page.evaluate("""() => {
        const loopBtn = document.getElementById("loop-toggle");
        const recruitBtn = document.getElementById("recruit-btn");
        const buySlotBtn = document.getElementById("buy-slot");
        const sellBtn = document.getElementById("sell-all");
        const invCount = document.getElementById("inv-count")?.innerText;
        const waveTitle = document.getElementById("wave-title")?.innerText;
        const goldEl = document.querySelector(".gold, #gold-count, [data-gold]");
        const lvlEl = document.querySelector(".player-level, #player-level");
        const partyRows = Array.from(document.querySelectorAll(".char-row, .char-slot, .party-slot")).map(c => c.innerText.replace(/\\s+/g, " ").trim());
        
        return {
            title: document.title,
            waveTitle,
            invCount,
            gold: goldEl ? goldEl.innerText : null,
            level: lvlEl ? lvlEl.innerText : null,
            loopOn: loopBtn ? loopBtn.classList.contains("on") : null,
            loopText: loopBtn ? loopBtn.innerText : null,
            recruitMode: recruitBtn ? recruitBtn.dataset.mode : null,
            recruitDisabled: recruitBtn ? recruitBtn.disabled : null,
            recruitText: recruitBtn ? recruitBtn.innerText : null,
            buySlotDisabled: buySlotBtn ? buySlotBtn.disabled : null,
            buySlotText: buySlotBtn ? buySlotBtn.innerText : null,
            partyRows
        };
    }""")
    print("STATE:", json.dumps(info, indent=2))
    browser.close()
