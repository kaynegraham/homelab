# 02: Remote access with Tailscale

[Back to README](../README.md) · Previous: [01](01-network-access.md) · Next: [03](03-dc01.md)

## Goal

Reach the lab from anywhere without opening any ports on the home network.

## Why Tailscale

- Built on WireGuard, so traffic is encrypted end to end.
- No port forwarding needed, so nothing on the home network is exposed to the internet.
- Works behind CGNAT, where a normal port forward wouldn't.
- Free for personal use.

## Design decision

Tailscale is installed directly on the Proxmox host (pve01), not in a container. Remote access to the hypervisor then doesn't depend on a container being up, which matters most when something else in the lab is broken.

## Setup

### Install

```
curl -fsSL https://tailscale.com/install.sh | sh
```

### Enable IP forwarding

Needed so pve01 can pass traffic between Tailscale and the lab subnet (subnet router).

```
echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-tailscale.conf
sysctl -p /etc/sysctl.d/99-tailscale.conf
```

`/etc/sysctl.d/` is used instead of `/etc/sysctl.conf` because newer Debian releases don't reliably load the old file at boot.

Check:

```
sysctl net.ipv4.ip_forward
```

### Bring it up and advertise the lab subnet

```
tailscale up
tailscale set --advertise-routes=10.10.99.0/24
```

Then in the Tailscale admin console:

1. pve01 > Edit route settings > approve 10.10.99.0/24.
2. pve01 > Disable key expiry.

## Access

| Target | Address |
|---|---|
| Proxmox UI (direct) | https://100.64.39.95:8006 or https://pve01:8006 |
| Anything on the lab subnet | Its 10.10.99.x address, via the subnet route |

Tested from my phone on mobile data.

## Issues hit

- **Phone couldn't load the UI via 10.10.99.2.** Using the Tailscale IP of pve01 worked straight away, because Tailscale runs on the host itself. The subnet route only matters for reaching VMs and containers.
- **Health check warning: `--accept-routes is false`.** Left as is. That setting is for devices using routes other machines advertise. Turning it on for the machine advertising the subnet can break its own local routing.
- **Old `twilight` device in the tailnet.** Left over from before the rebuild. Removed in the admin console.

## Side note: Tailscale in an unprivileged LXC

Not used here, but worth knowing. An unprivileged container can't access the host's TUN device by default, and Tailscale needs it to create its interface. These lines in `/etc/pve/lxc/<ID>.conf` allow it:

```
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
```

Line 1 grants permission to use the TUN device (character device 10:200). Line 2 bind-mounts it into the container.

## Lessons

- Running remote access on the hypervisor means it survives the lab breaking.
- Mesh VPNs avoid port forwarding and CGNAT problems entirely.
