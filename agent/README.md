# Kanban print agent

Runs on the Linux box attached to the Gprinter GP-3120TL (TSPL, 203 dpi). Every few
seconds it polls the kanban board (`POST {SERVER_URL}/api/agent/poll`), prints each queued
job, acknowledges the result, and reports CPU / memory / disk / load /
temperature / uptime. One Python 3.8+ script, standard library only, run by systemd.

There are two kinds of job:

- **Task jobs** (`{jobId, task}`, from the kanban board): the agent builds the TSPL label
  itself, using the label settings in the env file.
- **Raw jobs** (`{jobId, raw}`, from the web label editor): `raw` is base64 TSPL that
  already sets size, gap, density and speed. The agent decodes it and writes the bytes to
  the printer unchanged; the env file's label settings do not apply. A payload that is not
  valid base64 (or is empty) is reported as a failed job and nothing is printed.

Both kinds share the same result reporting. The agent keeps the last 200 finished job
ids and any results not yet delivered in `/var/lib/kanban-print-agent/state.json`
(systemd `StateDirectory`; override with `STATE_DIR`), so neither a lost acknowledgement
nor an agent restart prints a label twice. A job is marked "printing" in that file before
any byte goes to the printer: if the agent dies mid-write, on the next start the job is
reported failed ("Agent restarted while printing; check the label and print again")
instead of being reprinted.

Jobs are only taken while the printer is ready; otherwise they stay queued on the board
and print once the printer is back. If sending fails before anything reached the printer
(printer off or power-cycling, connection refused, CUPS busy) the job is not acknowledged:
the agent reports the printer not ready for one poll and the board redelivers the job
later. If the error came after part of the label was sent (USB write error part-way,
dropped TCP connection, `lp` timeout) the job is reported failed, since something may
have printed. A bad payload is always reported failed.

## Install / upgrade

```sh
git clone <this repo> && cd <repo>
sudo sh agent/install.sh
```

This copies the agent to `/opt/kanban-print-agent/`, creates the `kanban-print` system
user (added to group `lp`), creates `/etc/kanban-print-agent.env` if missing, and
enables the `kanban-print-agent` service. Re-run it after `git pull` to upgrade; your env
file is never overwritten.

## Configure

```sh
sudo nano /etc/kanban-print-agent.env      # SERVER_URL, AGENT_TOKEN, PRINTER, label size
sudo systemctl restart kanban-print-agent
```

`PRINTER` is `/dev/usb/lp0` (default), `tcp://HOST:9100`, or `cups:QUEUE_NAME` for a raw
CUPS queue. Every setting is documented in `agent.env.example`.

## Test print and calibration

```sh
sudo sh -c 'set -a; . /etc/kanban-print-agent.env; python3 /opt/kanban-print-agent/printer_agent.py --test-print'
```

If the print is shifted, adjust `OFFSET_X_DOTS` / `OFFSET_Y_DOTS` (8 dots = 1 mm);
if it is faint, raise `DENSITY`. To see the TSPL without printing:
`python3 printer_agent.py --dump-label "Some title"`. Built-in checks: `--self-test`.

## Logs

```sh
journalctl -u kanban-print-agent -f
```

## Uninstall

```sh
sudo sh agent/install.sh --uninstall
```

Stops and removes the service and `/opt/kanban-print-agent`. Keeps
`/etc/kanban-print-agent.env`, the job state in `/var/lib/kanban-print-agent` and the
`kanban-print` user (the script prints how to remove them).

## Troubleshooting

- **`no write permission on /dev/usb/lp0`**: the device is normally `root:lp`, mode 660.
  Check with `ls -l /dev/usb/lp0` and `id kanban-print`; the user must be in `lp`
  (re-run the installer, then restart the service).
- **`/dev/usb/lp0 not found`**: the `usblp` kernel module is not loaded. Run
  `sudo modprobe usblp` and check `dmesg | tail`. To load it at boot:
  `echo usblp | sudo tee /etc/modules-load.d/usblp.conf`.
- **CUPS grabbed the printer**: if CUPS (or ipp-usb) claims the USB device, `/dev/usb/lp0`
  disappears or prints nothing. Either remove that CUPS queue / stop `ipp-usb`, or keep
  CUPS and use `PRINTER=cups:QUEUE_NAME` with a **raw** queue (`lpstat -p` lists queues).
- **`bad AGENT_TOKEN (HTTP 401)`**: the token in the env file doesn't match the board.
- **`refusing to start`**: `SERVER_URL` must be `https://` (http only for localhost) and
  `AGENT_TOKEN` must be set.
- **Labels drift or skip**: check `LABEL_GAP_MM` matches the stock (0 = continuous) and run
  the printer's own gap calibration (hold FEED at power-on on most Gprinter models).
