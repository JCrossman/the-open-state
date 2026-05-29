"""The Open State: Camping - Civic Access Protocol reference implementation."""


def main() -> None:
    """Console-script entry point: run the MCP server."""
    from open_state_camping.server import main as run_server

    run_server()
