"""Launch the production server.

    python -m app.serve            # http://127.0.0.1:8000 (this computer only)
    python -m app.serve --lan      # also reachable from devices on the same network

LAN mode binds 0.0.0.0. It does not change firewall settings: Windows may ask
whether to allow Python on private networks; that decision stays with you.
"""

from __future__ import annotations

import argparse
import socket

import uvicorn


def lan_addresses() -> list[str]:
    found: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = str(info[4][0])
            if not ip.startswith("127."):
                found.add(ip)
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent for UDP connect
            found.add(s.getsockname()[0])
    except OSError:
        pass
    return sorted(ip for ip in found if not ip.startswith("127."))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run ReSpace Studio")
    parser.add_argument("--lan", action="store_true", help="listen on all interfaces for same-network testing")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    host = "0.0.0.0" if args.lan else "127.0.0.1"  # noqa: S104 - explicit opt-in LAN mode
    from .config import get_settings

    if not get_settings().frontend_dist.is_dir():
        print("Frontend build not found. Run: cd frontend; npm run build")
    print(f"ReSpace Studio on http://127.0.0.1:{args.port}")
    if args.lan:
        for ip in lan_addresses():
            print(f"  same-network testers: http://{ip}:{args.port}")
        print("  LAN mode uses plain HTTP. Use only on a trusted private network; never port-forward it.")
    uvicorn.run("app.main:create_app", factory=True, host=host, port=args.port, proxy_headers=False, log_level="info")


if __name__ == "__main__":
    main()
