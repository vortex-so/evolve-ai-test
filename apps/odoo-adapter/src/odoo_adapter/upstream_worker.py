from __future__ import annotations

import os
import xmlrpc.client
from typing import Any


def _patch_upstream() -> None:
    from odoo_mcp.odoo_client import OdooClient, RedirectTransport

    original_connect = OdooClient._connect_xmlrpc

    def checked_connect(self: Any) -> None:
        original_connect(self)
        expected = int(os.environ["VORTEX_EXPECTED_ODOO_UID"])
        if self.uid != expected:
            raise ValueError("authenticated Odoo user does not match connection owner")

    def request_without_redirects(
        self: Any, host: Any, handler: str, request_body: Any, verbose: bool = False
    ) -> Any:
        return xmlrpc.client.Transport.request(self, host, handler, request_body, verbose)

    OdooClient._connect_xmlrpc = checked_connect
    RedirectTransport.request = request_without_redirects


def main() -> int:
    _patch_upstream()
    from odoo_mcp.__main__ import main as upstream_main

    return int(upstream_main())


if __name__ == "__main__":
    raise SystemExit(main())
