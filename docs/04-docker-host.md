# 04: Docker host

[Back to README](../README.md) · Previous: [03](03-dc01.md)

> Status: in progress

## Goal

Build a Linux VM that runs containers with Docker Compose, then run Portainer, Uptime Kuma, Homarr and Pi-hole on it. Every service is defined in a compose file in this repo, so the whole host can be rebuilt from Git.

## How to use this page

This is a guided build, not a copy and paste. Each step has:

- **Why:** the reason the step exists
- **Figure out:** what to look up or work out yourself
- **Check:** how to prove it works
- **Notes:** questions to answer in your own words once it's done. Replace them with your answers, since that's what makes this page worth reading.

---

## Step 1: Create the VM

**Why:** Docker runs in a VM rather than an LXC. Proxmox recommends this, because Docker inside an unprivileged LXC needs extra permissions and tends to break after Proxmox updates. A VM is fully isolated with its own kernel.

**Figure out:**
- Debian 12 or Ubuntu Server 24.04. Pick one and write down why.
- Specs: 2 cores, 3 to 4GB RAM, 40GB disk, IP `10.10.99.20`. DC01 is shut down to free RAM.
- How to set a static IP on your chosen distro. Debian and Ubuntu do it differently (`/etc/network/interfaces` vs netplan).

**Check:** from your laptop, `ssh <user>@10.10.99.20` works and `ping 1.1.1.1` works from the VM.

### What I built ✅

| Setting | Value |
|---|---|
| Name | docker01 |
| OS | Ubuntu Server LTS |
| CPU / RAM / Disk | 2 cores, 4GB (ballooning on), 40GB (discard, SSD emulation) |
| Network | vmbr0, VirtIO, interface `ens18` |
| IP | 10.10.99.20/24, gateway 10.10.99.1 |
| DNS | 1.1.1.1, 8.8.8.8 (temporary, DC01 is off) |
| QEMU agent | On in Proxmox, `qemu-guest-agent` installed in Ubuntu |

Static IP set in the Ubuntu installer. OpenSSH installed, no snaps. DC01 shut down cleanly from Windows to free RAM.

Post-install:

```
sudo apt update && sudo apt upgrade
sudo apt install qemu-guest-agent
systemctl status qemu-guest-agent
ip addr show ens18
```

Gotchas:
- First try at the name servers field was missing the comma (`1.1.1.1.8.8.8.8`). It has to be `1.1.1.1,8.8.8.8`.
- `ip addr show` takes an interface name (`ens18`), not an IP.
- `systemctl enable qemu-guest-agent` warns that the unit is static. That's normal on Ubuntu: it starts automatically when Proxmox's agent device is attached.
- To do: point DNS at Pi-hole (and DC01) once they're running.

**Notes:**
- Why a VM and not an LXC for Docker?
- Why does the FortiGate already allow SSH to this VM without a new rule?

---

## Step 2: Install Docker and Compose

**Why:** use Docker's official repository, not the distro package. The distro version is often old and doesn't include the Compose plugin.

**Figure out:**
- Docker's official install guide for your distro (docs.docker.com).
- What the `docker` group does, and whether to add your user to it.

**Check:** `docker run hello-world` and `docker compose version` both work.

### What I did ✅

Installed from Docker's apt repository, following the official guide.

| Command | What it does |
|---|---|
| `apt install ca-certificates curl` | `curl` downloads files. `ca-certificates` lets the VM verify HTTPS sites. |
| `install -m 0755 -d /etc/apt/keyrings` | Creates a folder for trusted signing keys |
| `curl ... gpg -o /etc/apt/keyrings/docker.asc` | Downloads Docker's public signing key |
| `chmod a+r` | Makes the key readable so apt can use it |
| `tee /etc/apt/sources.list.d/docker.sources` | Tells apt where Docker's repo is |
| `$(. /etc/os-release ...)` | Fills in the Ubuntu codename so the right packages are used |
| `$(dpkg --print-architecture)` | Fills in the CPU architecture (amd64) |
| `Signed-By:` | Only trust packages from this repo if signed with Docker's key |
| `apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin` | Engine, CLI, container runtime, image builder and Compose |

Why the GPG key matters: apt checks every package from the repo was signed by Docker. A tampered download wouldn't match the signature, and apt would refuse it.

Result: `sudo docker run hello-world` works, `docker compose version` returns v5.8.0.

**Notes:**
- Adding a user to the `docker` group is effectively giving them root. Why?
- What's the difference between an image and a container?

---

## Step 3: Repo layout

**Why:** one folder per service, each with its own `docker-compose.yml`. You can start, stop and update services on their own, and the repo becomes your backup of how everything is configured.

```
docker/
  portainer/docker-compose.yml
  uptime-kuma/docker-compose.yml
  homarr/docker-compose.yml
  pihole/docker-compose.yml
```

Clone the repo onto the VM and run each service from its own folder.

**Notes:**
- Why keep compose files in Git instead of just running `docker run` commands?

---

## Step 4: Uptime Kuma (worked example)

This one is done for you, line by line, so you can see the pattern. Write the rest yourself using it as a reference.

```yaml
services:
  uptime-kuma:
    image: louislam/uptime-kuma:2
    container_name: uptime-kuma
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/data
```

| Line | What it does | Why it matters |
|---|---|---|
| `image: louislam/uptime-kuma:2` | The image to run, pinned to major version 2 | `:latest` can jump to a new major version and break things on an update. Pinning makes updates deliberate. |
| `container_name` | A fixed name instead of a random one | Easier to find in `docker ps` and logs |
| `restart: unless-stopped` | Restarts the container if it crashes or the VM reboots, unless you stopped it yourself | Without it, services stay down after a reboot |
| `ports: "3001:3001"` | Host port on the left, container port on the right | Containers are isolated by default. This opens one port from the VM into the container. |
| `volumes: ./data:/app/data` | Maps a folder on the VM into the container | Containers are disposable. Anything not in a volume is lost when the container is recreated, including all your monitors. |

**Check:** `docker compose up -d`, then browse to `http://10.10.99.20:3001`. Is it reachable from your laptop? If not, which device is blocking it, and what would you change?

**Then:** add monitors for pve01, the FortiGate, DC01 and a few Built for Perth client sites. Set up a notification to your phone.

### What I did ✅

- Started on the `:1` tag, then moved to `:2` (current major version) before adding any monitors. Deleted `./data` and started fresh, since upgrading later means a database migration.
- Picked **SQLite** at the v2 database setup: lowest RAM, and the whole database is one file in `./data`, so backups are just copying the folder.
- Browser showed `Socket.io connect_error` after the upgrade because it had cached the v1 page. An incognito window fixed it.
- Not reachable from the laptop at first: the FortiGate **Home to Lab** rule only allows listed services. Created a custom service for TCP 3001 and added it to the rule.

| Monitor | Type | Notes |
|---|---|---|
| pve01 | HTTP(s) `https://10.10.99.2:8006` | "Ignore TLS/SSL errors" ticked, Proxmox uses a self-signed cert |
| FortiGate | Ping `10.10.99.1` | Started as HTTP(s) and timed out. HTTPS admin access isn't enabled on `internal`, and shouldn't be. Ping is enough to prove it's alive. |
| Built for Perth | HTTP(s) | Public site |

DC01 not added yet, since it's shut down to save RAM. docker01 isn't monitored because Uptime Kuma runs on it: if docker01 goes down, so does the thing that would alert. Needs an outside check later.

### Phone notifications (ntfy) ✅

| Setting | Value | Why |
|---|---|---|
| Type | ntfy | Free, no account, has a phone app |
| Server | https://ntfy.sh | Public server |
| Topic | A long, hard-to-guess name | On the public server, anyone who knows the topic can read the alerts, so treat it like a password |
| Priority | 3 normal, 5 for DOWN | Only outages show as urgent |
| Phone call | Blank | Needs a paid ntfy account |
| Applied to | All existing monitors | |

Subscribed to the same topic in the ntfy app, sent a test, and got it on my phone.

Gotcha: the topic field is the channel name, not the alert text. First attempt put a message in there.

Later: self-host ntfy in the lab so alert topics aren't on a public server.

Troubleshooting the FortiGate monitor: `ping -c 3 10.10.99.1` on docker01 and `docker exec uptime-kuma ping -c 3 10.10.99.1` both worked, which proved the FortiGate and the container were fine and the monitor itself was misconfigured.

**Notes:**
- What happens to your monitors if you delete the container but keep `./data`? Test it.
- What's the difference between a bind mount (`./data`) and a named volume?

---

## Step 5: Portainer

**Why:** a web UI for containers, logs and stats. Widely used, so it's worth knowing.

**Figure out:**
- Portainer CE's compose setup from their docs.
- It mounts `/var/run/docker.sock`. What is that file?

**Check:** you can log in and see the Uptime Kuma container listed.

### What I did ✅

```yaml
services:
  portainer:
    image: portainer/portainer-ce:lts
    container_name: portainer
    restart: always
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer_data:/data
    ports:
      - 9443:9443

volumes:
  portainer_data:
    name: portainer_data
```

| Choice | Why |
|---|---|
| `:lts` tag | Long-term support track: stable releases only, not every new feature release |
| Port 9443 | Portainer's HTTPS UI. Added TCP 9443 to the FortiGate Home to Lab rule. |
| `portainer_data` named volume | Docker manages where it's stored, unlike Uptime Kuma's `./data` bind mount |
| Docker socket mounted | How Portainer sees and controls containers (see below) |

#### Configuration

- Stacks created with `docker compose` show as **Limited** in Portainer: it can view them but not edit them. Decision: Git and the command line are the source of truth, Portainer is for logs, stats and the console only. Editing in Portainer would make the repo drift from what's running.
- Session timeout set, and a config backup downloaded.

### Why the Docker socket matters

The Docker engine already runs as root. Mounting `docker.sock` into a container gives that container control of the engine, which means root on the host, so it can be easily exploited if the image is vulnerable or malicious. Only mount it into trusted images, keep them patched, never expose them to the internet, and review the host's security regularly.

Same reason being in the `docker` group is effectively root: the group just grants access to the socket.

---

## Step 6: Homarr

**Why:** a single dashboard with tiles for every service in the lab.

**Figure out:**
- Homarr's compose setup from their docs, using the same pattern as Step 4.
- Which port to give it. It can't clash with anything already running.

**Check:** a dashboard with working tiles for Proxmox, Portainer, Uptime Kuma and the FortiGate.

### What I did ✅

| Choice | Value | Why |
|---|---|---|
| Image | `ghcr.io/homarr-labs/homarr` | TODO: record the pinned version tag |
| Port | 7575 | Checked it was free with `ss -tulpn`. Added TCP 7575 to the FortiGate Home to Lab rule. |
| Data | `./homarr/appdata` bind mount | Ignored by Git |
| Encryption key | `.env` file, referenced as `${SECRET_ENCRYPTION_KEY}` | Secrets never go in a committed file |
| Docker socket | TODO: record whether it was kept or removed, and why | |

#### Secrets and Git

The first version of the compose file had the encryption key pasted in, which would have gone straight to the public repo. Fixed by:

1. Generating a new key with `openssl rand -hex 32`, since the old one had been in a screenshot.
2. Putting it in `docker/homarr/.env`. Compose reads `.env` from the folder you run it in.
3. Referencing it in the compose file as `${SECRET_ENCRYPTION_KEY}`.
4. Adding `docker/.gitignore`:

```
**/.env
**/data/
**/appdata/
```

`**/` matches any folder below, so one file covers every service. `.gitignore` only affects untracked files: anything already committed needs `git rm -r --cached <path>` first. Checked with `git status` before committing.

#### Pushing from docker01

GitHub doesn't accept passwords over Git, so docker01 got its own SSH key:

```
ssh-keygen -t ed25519 -C "docker01"
cat ~/.ssh/id_ed25519.pub
git remote set-url origin git@github.com:kaynegraham/<repo>.git
```

The public key was added to GitHub under Settings > SSH and GPG keys, named `docker01`. `-C` is just a label so I know which machine each key belongs to.

#### Proxmox integration

Homarr shows pve01's node, VM and container counts using a **read-only API token**, not the root login.

1. **API token:** Datacenter > Permissions > API Tokens, `root@pam!homarr`, with privilege separation on. With separation on, the token starts with no permissions, even though it belongs to root.
2. **Permission:** Datacenter > Permissions > Add > API Token Permission. Path `/`, role `PVEAuditor` (read-only), propagate on.
3. **Homarr fields:** URL `https://10.10.99.2:8006`, username `root`, realm `pam`, token ID `homarr`, plus the secret.

| Problem | Cause | Fix |
|---|---|---|
| Certificate not trusted | Proxmox's cert is signed by its own CA (`PVE Cluster Manager CA`), which Homarr doesn't know | Uploaded the CA cert `/etc/pve/pve-root-ca.pem` to Homarr. Trusting the CA trusts every cert it signs. The private key (`pve-root-ca.key`) never leaves pve01. |
| Authorization error | Token setup | Tested the token with `curl` to rule out Homarr: `curl -k -H 'Authorization: PVEAPIToken=root@pam!homarr=<secret>' https://10.10.99.2:8006/api2/json/nodes` |
| Token secret showed in a screenshot | | Deleted and recreated the token, re-added the permission |
| Node showed, but 0 VMs | The permission was never added. The token page only has privilege separation; permissions are on Datacenter > Permissions. | Added the API Token Permission |

#### Uptime Kuma integration

Homarr has a native Uptime Kuma integration. With no secrets it looks for a status page with the slug `default`, which gave a 404. Fixed by creating a status page in Uptime Kuma, adding the monitors to it, and choosing **Status page slug** in Homarr. No API key needed: status pages are public, read-only.

#### Widgets

Clock, Perth weather (Open-Meteo, set by coordinates, use Perth CBD for screenshots), Proxmox and Uptime Kuma.

To do: app tiles for each service, date on the clock, Pi-hole stats once it's built.

### Checking ports in use

```
sudo ss -tulpn
```

| Flag | Meaning |
|---|---|
| `-t` | TCP sockets |
| `-u` | UDP sockets |
| `-l` | Listening only |
| `-p` | Show the process using each port (needs sudo) |
| `-n` | Show port numbers instead of service names |

---

## Step 7: Pi-hole

**Why:** lab DNS with ad blocking and local names, so you stop typing IPs.

**Figure out:**
- Pi-hole's compose setup from their docs.
- DNS runs on port 53. When you start it, there's a good chance it fails because something on the VM is already using port 53. Work out what that is and how to fix it properly, rather than just picking a different port.
- Add local DNS records like `kuma.lab` pointing at `10.10.99.20`.

**Check:** `nslookup kuma.lab 10.10.99.20` from your laptop returns `10.10.99.20`, and ads are blocked on a device using Pi-hole as its DNS.

**Notes:**
- What was using port 53, and why was it there?
- Why does the FortiGate need a rule change for other home devices to use Pi-hole, when SSH already worked?
- Once DC01 is back on, how should DC01 and Pi-hole work together? Which one should forward to which, and why?

---

## Issues hit

| Problem | Cause | Fix |
|---|---|---|
| | | |

## Lessons

- Pin image versions. `:latest` turns every pull into a surprise upgrade.
- Secrets go in `.env`, never in a committed file. Check `git status` before every commit.
- Every new web UI on the lab means a new port on the FortiGate rule. A reverse proxy fixes that.
- Give integrations the least access that works: a read-only API token, not root. Same for admin access on firewall interfaces.
- Self-signed certs: trust the CA, don't switch off verification.
- `restart: unless-stopped` plus Docker enabled at boot brings containers back after a reboot.

## Next

05: Reverse proxy and HTTPS with a lab domain.
