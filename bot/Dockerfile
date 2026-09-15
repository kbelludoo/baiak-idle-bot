FROM mcr.microsoft.com/playwright/python:v1.49.0-noble
WORKDIR /app

RUN pip install --no-cache-dir playwright==1.49.0

COPY bot.py server.py stream.py hunts.py hunt_sim.py engine_hunts.json chrome.py config.py extras.py \
     page_hud.js page_hunt.js page_spell.js page_potion.js page_treino.js page_boss.js page_bags.js \
     page_equip.js page_prey.js page_extra.js baiakidle-helper.user.js ./
VOLUME ["/app/data"]

CMD ["python", "-u", "bot.py"]
