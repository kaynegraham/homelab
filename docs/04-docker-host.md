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
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./data:/app/data
```

| Line | What it does | Why it matters |
|---|---|---|
| `image: louislam/uptime-kuma:1` | The image to run, pinned to major version 1 | `:latest` can jump to a new major version and break things on an update. Pinning makes updates deliberate. |
| `container_name` | A fixed name instead of a random one | Easier to find in `docker ps` and logs |
| `restart: unless-stopped` | Restarts the container if it crashes or the VM reboots, unless you stopped it yourself | Without it, services stay down after a reboot |
| `ports: "3001:3001"` | Host port on the left, container port on the right | Containers are isolated by default. This opens one port from the VM into the container. |
| `volumes: ./data:/app/data` | Maps a folder on the VM into the container | Containers are disposable. Anything not in a volume is lost when the container is recreated, including all your monitors. |

**Check:** `docker compose up -d`, then browse to `http://10.10.99.20:3001`. Is it reachable from your laptop? If not, which device is blocking it, and what would you change?

**Then:** add monitors for pve01, the FortiGate, DC01 and a few Built for Perth client sites. Set up a notification to your phone.

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

**Notes:**
- Mounting the Docker socket into a container gives that container full control of the host. Why, and what does that mean for which images you trust?

---

## Step 6: Homarr

**Why:** a single dashboard with tiles for every service in the lab.

**Figure out:**
- Homarr's compose setup from their docs, using the same pattern as Step 4.
- Which port to give it. It can't clash with anything already running.

**Check:** a dashboard with working tiles for Proxmox, Portainer, Uptime Kuma and the FortiGate.

**Notes:**
- How do you check which ports are already in use on the VM?

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

-

## Next

05: Reverse proxy and HTTPS with a lab domain.
