FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates ripgrep && rm -rf /var/lib/apt/lists/*
RUN userdel -r node && useradd -m -u 1000 -s /bin/bash trooper
COPY troop/ /opt/troop/
RUN chmod 755 /opt/troop/entry.sh
# ENGINE INSTALL LINES
USER trooper
WORKDIR /home/trooper
