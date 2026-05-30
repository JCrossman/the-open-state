# syntax=docker/dockerfile:1
#
# Container image for the read-only public preview (docs/m2-validation-findings.md,
# decision 2). Serves the public-data, prepare-only tools over Streamable HTTP with
# the alert tools and poller disabled. Azure Container Apps terminates HTTPS at the
# ingress, so the app speaks plain HTTP internally.

FROM python:3.11-slim

# uv for fast, reproducible installs (copied from the official uv image).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Runtime dependencies first, for better layer caching.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Then the project itself (the uv_build backend needs the source and README).
COPY README.md ./
COPY src ./src
RUN uv sync --frozen --no-dev

# Read-only preview defaults; any can be overridden at deploy time.
ENV OPEN_STATE_TRANSPORT=http \
    OPEN_STATE_HOST=0.0.0.0 \
    OPEN_STATE_PORT=8000 \
    OPEN_STATE_ENABLE_ALERTS=false \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Run as a non-root user.
RUN useradd --create-home app && chown -R app /app
USER app

CMD ["uv", "run", "--no-dev", "python", "-m", "open_state_camping.server"]
