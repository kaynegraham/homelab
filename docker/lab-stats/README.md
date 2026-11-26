# Lab Stats

A small Node.js backend and web page for displaying Proxmox, Uptime Kuma
and Pi-hole statistics in Homarr.

## What it does

- Polls the three APIs and exposes a combined JSON endpoint at `/api/stats`.
- Caches the combined response for 30 seconds.
- Handles individual source failures without taking down the other sources.
- Serves the dashboard page from `/`.

## Secrets and certificates

Secrets are stored in the local `.env` file. Do not commit this file.

`.env.example` contains placeholders and can be committed.

The Proxmox API token uses the read-only `PVEAuditor` role.

The Proxmox CA certificate is mounted read-only at `/certs/pve-ca.pem`.
Node trusts this certificate through `NODE_EXTRA_CA_CERTS`.

TLS verification is not disabled.

Pi-hole authenticates with its application password. The backend reuses
the session ID until it expires and logs out during normal shutdown.

## Run

Copy `.env.example` to `.env` and fill in the real values.

Place the Proxmox CA certificate at `certs/pve-ca.pem`.

Build and start:

    docker compose up -d --build

Check the logs:

    docker compose logs -f lab-stats

Test the endpoint:

    curl http://10.10.99.20:8083/api/stats

## Troubleshooting

- Proxmox errors: verify the token, PVEAuditor ACL and CA certificate.
- Uptime Kuma errors: verify the public status page slug and API response.
- Pi-hole errors: verify the application password and Pi-hole v6 API.
- If a source fails, check the container logs for its HTTP status.

## Known issues

The exact Uptime Kuma and Pi-hole response structures should be verified
against the installed versions during initial testing.

