# 05: Reverse proxy and HTTPS

[Back to README](../README.md) · Previous: [04](04-docker-host.md)

> Status: done

## Goal

Reach every lab web UI by name over HTTPS with a real certificate, for example `https://kuma.twilight.goaround.lol`, instead of `http://10.10.99.20:3001`. One proxy on 80 and 443 replaces a separate firewall port for every service.

## How it fits together

```
Browser: https://kuma.twilight.goaround.lol
   |
   | 1. Laptop asks Pi-hole for the name, gets 10.10.99.20
   v
docker01:443  Nginx Proxy Manager
   |
   | 2. NPM reads the Host header (kuma.twilight.goaround.lol)
   |    and picks the matching proxy host
   v
10.10.99.20:3001  Uptime Kuma
```

Every name points at the same IP and port. NPM tells them apart using the **Host header**, the name the browser puts in every request.

---

## Domain

Bought `goaround.lol` as a throwaway lab domain and put it on Cloudflare. Lab services live under `twilight.goaround.lol`.

| Option | Why not |
|---|---|
| `twilight.lab` or `.twilight` | Not real domains. Let's Encrypt only issues certs for domains you can prove you own. |
| A subdomain of the Built for Perth domain | Would mean moving that DNS to Cloudflare and risking client sites |

`lab.twilight` stays as the Active Directory domain. Anything ending in `twilight.goaround.lol` is a lab web UI.

## Cloudflare API token

My Profile > API Tokens > Create Token > **Edit zone DNS** template.

| Setting | Value |
|---|---|
| Permissions | Zone, DNS, Edit |
| Zone resources | Include, specific zone, `goaround.lol` only |

Least privilege: if the token leaks, it can only change DNS on the throwaway domain. Stored in the password manager.

NPM warns that the token is stored as plaintext in its database and a file. That's why `./data` is gitignored and why the token is scoped to one zone.

## Nginx Proxy Manager

```yaml
services:
  npm:
    image: jc21/nginx-proxy-manager:<pinned version>
    container_name: npm
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "81:81"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

| Choice | Why |
|---|---|
| Ports 80 and 443 | Kept free on purpose when Pi-hole and the others were set up |
| Port 81 | NPM's admin UI |
| `./letsencrypt` | Holds the certificates' **private keys**. Added `**/letsencrypt/` to `.gitignore` (repo root) before first start. |

## Certificates

| Cert | Covers | Used for |
|---|---|---|
| `*.twilight.goaround.lol` | Every name one level under `twilight.goaround.lol` | All proxy hosts |
| `twilight.goaround.lol` | The bare name | Redirect to Homarr |

**DNS challenge, not HTTP.**

- HTTP challenge: Let's Encrypt connects to port 80 over the internet. Impossible behind CGNAT.
- Wildcards can only be issued through the DNS challenge anyway.
- With the DNS challenge, NPM uses the Cloudflare token to create a temporary TXT record. Let's Encrypt checks it, which proves control of the domain, then it's removed. Nothing in the lab is exposed.

Notes:
- A wildcard covers **one level**: `kuma.twilight.goaround.lol` yes, `a.kuma.twilight.goaround.lol` no, and not the bare `twilight.goaround.lol`. NPM's form only took one name, so the bare domain got its own cert.
- A new cert shows **Not used** until it's attached to a proxy host. That's not an error.
- NPM renews automatically, roughly every 60 days. Uptime Kuma's certificate expiry alerts are the safety net.

## DNS: one wildcard rule in Pi-hole

Instead of a record per service, one dnsmasq line sends every name under the lab domain to docker01:

```
address=/twilight.goaround.lol/10.10.99.20
```

Newer Pi-hole versions block setting `misc.dnsmasq_lines` from the web UI, so it's set in the Pi-hole compose file instead:

```yaml
      FTLCONF_misc_dnsmasq_lines: 'address=/twilight.goaround.lol/10.10.99.20'
```

Pi-hole's FTL engine reads any `FTLCONF_` environment variable at startup and applies it as a setting (dots become underscores: `misc.dnsmasq_lines` → `misc_dnsmasq_lines`). Settings from environment variables are locked in the UI. Bonus: the rule is now in Git.

### Public DNS vs lab DNS

`goaround.lol` is also used for other projects, published through a Cloudflare Tunnel with a public `*.goaround.lol` wildcard record. That wildcard only covers one level, so:

| Name | Public DNS (Cloudflare) | Lab DNS (Pi-hole) |
|---|---|---|
| `app.goaround.lol` | Cloudflare Tunnel | n/a |
| `twilight.goaround.lol` | Matched by the public wildcard unless it has its own record | 10.10.99.20 |
| `kuma.twilight.goaround.lol` and other lab names | Doesn't exist | 10.10.99.20 |

Lab services are never published publicly. A TXT record named `twilight` stops the bare name falling into the public wildcard (a wildcard only applies to names with no records of their own).

### Devices not using Pi-hole

Found when the Mac (DNS set to 1.1.1.1) couldn't reach any lab names: `nslookup` against 1.1.1.1 returned Cloudflare's IPs, against 10.10.99.20 returned the lab IP.

Fix: **Tailscale split DNS**. In the Tailscale admin console, DNS > add nameserver `10.10.99.20`, restricted to `twilight.goaround.lol`. Any device on the tailnet asks Pi-hole for lab names and normal DNS for everything else, at home or away, and nothing breaks if Pi-hole is down. Works because of the 10.10.99.0/24 subnet route on pve01.

macOS DNS cache flush: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`

## Proxy hosts

All use the wildcard cert, Force SSL and HTTP/2. HSTS left off for now, since browsers remember it for months.

| Domain | Scheme | Forward to | Websockets | Notes |
|---|---|---|---|---|
| kuma | http | 10.10.99.20:3001 | ✅ | Uptime Kuma needs websockets |
| homarr | http | 10.10.99.20:7575 | ✅ | |
| pihole | http | 10.10.99.20:8082 | | UI at `/admin` |
| clock | http | 10.10.99.20:8081 | | |
| stats | http | 10.10.99.20:8083 | | lab-stats panel |
| npm | http | 10.10.99.20:81 | | NPM proxying its own admin UI |
| portainer | **https** | 10.10.99.20:9443 | ✅ | Portainer only speaks HTTPS. Console needs websockets. |
| pve | **https** | 10.10.99.2:8006 | ✅ | Proxmox only speaks HTTPS. noVNC console needs websockets. |

The scheme is how **NPM** talks to the service, not how the browser talks to NPM.

**Not proxied: the FortiGate.** NPM would reach it from the lab side, and admin access on `internal` was deliberately limited to PING. It stays managed directly at `https://192.168.1.20`.

### Bare domain

`twilight.goaround.lol` is a **redirection host** to `https://homarr.twilight.goaround.lol`, with HTTP code **302**.

- Redirect, not proxy: serving Homarr under two addresses can confuse its logins.
- 302, not 301: browsers cache a 301 permanently, which hurts if it ever changes.

It's the lab's front door and the browser homepage.

## Firewall

The Home to Lab rule went from a port per service down to:

| Service | Why |
|---|---|
| HTTP, HTTPS | Everything through NPM |
| DNS | Pi-hole |
| Nginx Proxy Manager (81) | Direct way in if a proxy host breaks |
| PROXMOXUI (8006) | Direct way in to Proxmox if NPM is down |
| SSH | Terminal access |
| RDP | DC01 |
| PING | Testing |

The individual web ports (3001, 7575, 8081, 8082, 9443) were removed only after every service worked through the proxy.

![Home to Lab rule after the proxy](images/05-fortigate-rule.png)

**Incident:** while editing the rule, DNS, SSH, PING and RDP were accidentally removed for about 10 minutes. Because the laptop uses Pi-hole for DNS, losing the DNS service made it look like the whole internet was down, not just the lab. Same single point of failure lesson as keeping Pi-hole off the home router.

## Follow-ups

- [ ] Homarr tiles updated to the `https://...twilight.goaround.lol` names
- [ ] Uptime Kuma monitors moved to the HTTPS names, certificate expiry notifications on
- [ ] Proxmox monitor no longer needs "ignore TLS errors"
- [ ] Shared Docker network so NPM forwards by container name and the containers stop publishing their own ports

## Lessons

- Let's Encrypt needs a real domain you control. Use a subdomain of one, not a made-up TLD.
- DNS challenge works behind CGNAT and is the only way to get a wildcard.
- Scope API tokens to exactly what they need: one zone, DNS edit.
- Private keys (`letsencrypt/`) go in `.gitignore` before the container first runs.
- A reverse proxy tells sites apart by the Host header, so one IP and port can serve everything.
- Keep a direct way in (NPM 81, Proxmox 8006) for when the proxy itself breaks.

## Next

[06: pve02 and a two node cluster](06-pve02-cluster.md)
