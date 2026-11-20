# KG Tech Lab

Home lab for learning Windows Server, Active Directory, Linux, Docker and networking. Built on a single Proxmox host behind a FortiGate 60E, with each step documented as I go.

## Quick links

| Page | What's in it |
|---|---|
| [Hardware](docs/hardware.md) | Host specs, current limits and the upgrade plan |
| [Network](docs/network.md) | IP plan, firewall rules, routing and remote access |
| [Build log](#build-log) | Step by step write-ups of everything built so far |

## At a glance

- **Hypervisor:** Proxmox VE 9 on a Dell OptiPlex 7040 SFF
- **Firewall:** FortiGate 60E
- **Domain:** `lab.twilight` (NetBIOS `TWILIGHT`)
- **Lab subnet:** `10.10.99.0/24`
- **Remote access:** Tailscale on the Proxmox host

## Network

![Lab diagram](docs/images/lab-diagram.png)

```
Home router (192.168.1.0/24)
  |
  |-- Laptop 192.168.1.120 (static)
  |
  |-- FortiGate wan1 192.168.1.20
        |
        FortiGate internal 10.10.99.1
        |
        Lab subnet 10.10.99.0/24
          |-- pve01    10.10.99.2
          |-- DC01     10.10.99.11
          |-- docker01 10.10.99.20
```

Full details in [network.md](docs/network.md).

## Build log

| # | Topic | Status |
|---|---|---|
| 01 | [Network access to the lab](docs/01-network-access.md) | Done |
| 02 | [Remote access with Tailscale](docs/02-tailscale-remote-access.md) | Done |
| 03 | [DC01: first domain controller](docs/03-dc01.md) | Done |
| 04 | [Docker host: Portainer, Uptime Kuma, Homarr, Pi-hole](docs/04-docker-host.md) | In progress |
| 05 | Reverse proxy and HTTPS with a lab domain | Planned |
| 06 | DC02: second domain controller (Server Core) | Planned, after RAM upgrade |
| 07 | Windows 11 client, OUs and GPOs | Planned |
| 08 | AD Certificate Services (internal CA) | Planned |
| 09 | WireGuard inside the lab | Planned |

## To do

- [x] Order RAM (2x8GB DDR4-2133), see [hardware](docs/hardware.md)
- [ ] Rerun Windows Update on DC01 (running), then `dcdiag /q` once old errors age out
- [x] Add the 10.10.99.0/24 static route on the home router
- [x] Turn on logging for the FortiGate implicit deny rule
- [x] Remove the leftover `ts01` container (VM 100)
- [x] Approve the 10.10.99.0/24 subnet route in Tailscale

## Rules for this repo

- No passwords, keys or real public IPs.
- Nothing from work or clients.
