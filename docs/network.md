# Network

[Back to README](../README.md)

## Subnets

| Network | Subnet | Gateway |
|---|---|---|
| Home LAN | 192.168.1.0/24 | Home router |
| Lab LAN | 10.10.99.0/24 | FortiGate internal (10.10.99.1) |

## IP plan

| Device | IP | Notes |
|---|---|---|
| FortiGate wan1 | 192.168.1.20 | Faces the home LAN |
| Laptop | 192.168.1.120 | Static, management workstation |
| FortiGate internal | 10.10.99.1 | Lab gateway |
| pve01 | 10.10.99.2 | Proxmox host |
| DC01 | 10.10.99.11 | Domain controller, DNS |
| DC02 | 10.10.99.12 | Planned |
| docker01 | 10.10.99.20 | Ubuntu Server, Docker host, see [04](04-docker-host.md) |
| Clients | 10.10.99.100 to 150 | Reserved for DHCP from DC01 later |

The FortiGate had a DHCP server running on `internal` (10.10.99.100 to 150). Turned it off since every lab device has a static IP. DHCP will run on DC01 once clients are added, so there's only ever one DHCP server on the subnet.

### FortiGate admin access on `internal`

Only **PING** is enabled. FMG-Access, SSH and Security Fabric Connection were removed: the FortiGate is managed from `wan1` (192.168.1.20), so the lab side doesn't need management access. Least privilege.

## Firewall policies (FortiGate)

### Home to Lab

| Field | Value |
|---|---|
| Incoming / Outgoing | wan1 / internal |
| Source | Home-LAN (192.168.1.0/24) |
| Destination | Lab-LAN (10.10.99.0/24) |
| Services | PING, PROXMOXUI (TCP 8006), RDP, SSH, Uptime Kuma (TCP 3001), Portainer (TCP 9443), Homarr (TCP 7575), Clock (TCP 8081) |
| NAT | Off |
| Logging | All sessions |

Every new web UI needs its port added here. A reverse proxy (05) will cut this down to 80 and 443.

Replaced the original laptop-only rule from [01](01-network-access.md), which has been removed.

### Lab to Internet

| Field | Value |
|---|---|
| Incoming / Outgoing | internal / wan1 |
| Source / Destination | all / all |
| Services | ALL |
| NAT | On |

### Current policy list

![FortiGate policies](images/network-fortigate-policies.png)

## Routing

| Where | Route |
|---|---|
| Laptop | `10.10.99.0/24 via 192.168.1.20` (persistent) |
| Home router (TP-Link, LTE) | Same route on the LAN interface, so all home devices can reach the lab |

## DNS

| Client | DNS server |
|---|---|
| DC01 | Itself, with 1.1.1.1 as a forwarder |
| Lab machines | DC01 (10.10.99.11) |
| docker01 | 1.1.1.1, 8.8.8.8 for now. Move to Pi-hole/DC01 later. |

## Internet connection

Home internet is LTE behind CGNAT. The router's WAN IP is in 100.64.0.0/10, so nothing on the internet can start a connection in and port forwarding won't work. Remote access has to dial out, which is why Tailscale is used.

## Remote access

Tailscale runs on pve01 and advertises 10.10.99.0/24 as a subnet route. See [02](02-tailscale-remote-access.md).

| Target | Address |
|---|---|
| Proxmox UI | https://pve01:8006 via Tailscale |
| Lab machines | Their 10.10.99.x address via the subnet route |	
