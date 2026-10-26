#!/bin/sh
# Install or upgrade the kanban print agent:  sudo sh agent/install.sh
# Uninstall (keeps the env file):             sudo sh agent/install.sh --uninstall
set -eu

NAME=kanban-print-agent
AGENT_USER=kanban-print
DEST=/opt/$NAME
UNIT=/etc/systemd/system/$NAME.service
ENV_FILE=/etc/$NAME.env
SRC=$(cd "$(dirname "$0")" && pwd)

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo sh $0 $*" >&2
  exit 1
fi
command -v systemctl >/dev/null 2>&1 || { echo "systemd (systemctl) is required" >&2; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now "$NAME" 2>/dev/null || true
  rm -f "$UNIT"
  rm -rf "$DEST"
  systemctl daemon-reload
  echo "Uninstalled $NAME."
  echo "Kept $ENV_FILE (it holds your token), job state in /var/lib/$NAME and user $AGENT_USER."
  echo "To remove them too:"
  echo "  sudo rm -r $ENV_FILE /var/lib/$NAME && sudo userdel $AGENT_USER"
  exit 0
fi

PY=$(command -v python3) || { echo "python3 not found: install it (apt install python3 / dnf install python3)" >&2; exit 1; }
"$PY" -c 'import sys; sys.exit(sys.version_info < (3, 8))' || { echo "python3 3.8 or newer is required" >&2; exit 1; }

install -d -m 755 "$DEST"
install -m 755 "$SRC/printer_agent.py" "$DEST/printer_agent.py"

if ! id "$AGENT_USER" >/dev/null 2>&1; then
  NOLOGIN=$(command -v nologin || echo /bin/false)
  useradd --system --no-create-home --home-dir /nonexistent --shell "$NOLOGIN" "$AGENT_USER"
  echo "Created system user $AGENT_USER"
fi
if getent group lp >/dev/null 2>&1; then
  usermod -a -G lp "$AGENT_USER"
fi

if [ ! -e "$ENV_FILE" ]; then
  install -m 600 -o 0 -g 0 "$SRC/agent.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE"
fi
# The token lives here: keep it root-only even if the file was created by hand.
chown 0:0 "$ENV_FILE"
chmod 600 "$ENV_FILE"

sed "s|/usr/bin/python3|$PY|" "$SRC/$NAME.service" > "$UNIT"
chmod 644 "$UNIT"
systemctl daemon-reload
systemctl enable "$NAME" >/dev/null 2>&1

# Read a value from the env file without sourcing it.
val() { sed -n "s/^[[:space:]]*$1[[:space:]]*=//p" "$ENV_FILE" | tail -n 1 | tr -d "\"'[:space:]"; }

if [ -n "$(val SERVER_URL)" ] && [ -n "$(val AGENT_TOKEN)" ]; then
  systemctl restart "$NAME"
  echo "$NAME installed and (re)started. Logs: journalctl -u $NAME -f"
else
  echo
  echo "$NAME installed but NOT started. Edit $ENV_FILE and fill in:"
  [ -n "$(val SERVER_URL)" ] || echo "  SERVER_URL=https://your-board.example.com"
  [ -n "$(val AGENT_TOKEN)" ] || echo "  AGENT_TOKEN=<token from the board's settings>"
  echo "  (also check PRINTER and the LABEL_* sizes)"
  echo "then run:  sudo systemctl restart $NAME"
fi
