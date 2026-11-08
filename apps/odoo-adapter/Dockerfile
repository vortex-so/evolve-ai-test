FROM ghcr.io/astral-sh/uv:0.10.10 AS uv

FROM python:3.12.12-slim-bookworm AS builder
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY LICENSES ./LICENSES
RUN uv sync --frozen --no-dev

FROM python:3.12.12-slim-bookworm AS runtime
RUN groupadd --gid 10001 adapter \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin adapter
WORKDIR /app
COPY --from=builder --chown=adapter:adapter /app/.venv /app/.venv
COPY --from=builder --chown=adapter:adapter /app/src /app/src
COPY --from=builder --chown=adapter:adapter /app/LICENSES /app/LICENSES
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/adapter \
    PORT=8080
USER adapter
EXPOSE 8080
CMD ["vortex-odoo-adapter"]
