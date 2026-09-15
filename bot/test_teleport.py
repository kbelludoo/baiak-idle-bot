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
    
    print("Clicking wave-title...")
    page.evaluate("() => document.getElementById('wave-title')?.click()")
    time.sleep(1)
    
    tp_opts = page.evaluate("""() => {
        const menu = document.getElementById("teleport-menu");
        if (!menu) return null;
        return Array.from(menu.querySelectorAll(".tp-opt")).map(b => ({
            tp: b.dataset.tp,
            text: b.innerText
        }));
    }""")
    print("Teleport options:", tp_opts)
    
    # Click Hunts option
    page.evaluate("""() => {
        const b = document.querySelector('#teleport-menu .tp-opt[data-tp="hunts"]');
        if (b) b.click();
    }""")
    time.sleep(2)
    
    modal_info = page.evaluate("""() => {
        const modal = document.getElementById("picker-modal");
        const cards = Array.from(document.querySelectorAll("#picker-modal .im-card, #picker-modal .stage-row, .stage-row")).map(c => ({
            text: c.innerText.replace(/\\s+/g, ' ').trim(),
            hunt: c.dataset.hunt,
            disabled: c.querySelector('button')?.disabled
        }));
        return { hasModal: !!modal, cardsCount: cards.length, sample: cards.slice(0, 10) };
    }""")
    print("Modal info:", json.dumps(modal_info, indent=2))
    
    browser.close()
