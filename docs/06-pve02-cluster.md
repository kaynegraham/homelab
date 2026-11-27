# 06: pve02 and a two node cluster

[Back to README](../README.md) · Previous: [05](05-reverse-proxy.md)

> Status: done

## Goal

Add a second Proxmox host so DC02 can live on separate hardware from DC01, then join both hosts into one cluster so they're managed from a single UI.

Two domain controllers on the same host isn't redundancy. If pve01 dies, both DCs go with it. A second physical box fixes that.

## Hardware

| Part | Spec |
|---|---|
| CPU | Intel Core i5, 3.0GHz (6th/7th gen, Intel H110 chipset) |
| RAM | 8GB DDR4 desktop |
| Storage | 250GB Samsung 850 EVO SATA SSD |
| M.2 slot | None |
| BIOS | Gigabyte UEFI |

Same generation and RAM type as pve01, so pve01's 2x4GB sticks can move here after its RAM upgrade.

## Wiping the old OS

The box came with Windows installed. You can't wipe the disk Windows is running from, so I booted into the recovery environment instead: Shift + Restart, then Troubleshoot > Advanced options > Command Prompt.

```
diskpart
list disk
select disk 0
clean
exit
```

`clean` removes the partition table, so there's no OS left. The Proxmox installer formats the disk anyway, so this was mostly to make sure nothing booted back into Windows.

## BIOS

| Setting | Where on this Gigabyte board | Value |
|---|---|---|
| Intel Virtualization Technology (VT-x) | CPU settings (buried on this board) | Enabled |
| VT-d | Chipset | Enabled |
| Windows 8/10 Features | BIOS Features | Other OS |
| CSM Support | BIOS Features | Disabled (clean UEFI boot) |
| Boot from USB | F12 boot menu | One time |

Confirmed virtualisation was actually on after the install:

```
ls /dev/kvm
```

If `/dev/kvm` exists, KVM works. If it doesn't, VT-x is off in the BIOS.

## Proxmox install

| Setting | Value |
|---|---|
| Disk | 250GB 850 EVO |
| Filesystem | ext4 (ZFS wants RAM for its cache, too much on 8GB) |
| Hostname | `pve02.lab.twilight` |
| IP | `10.10.99.3/24` |
| Gateway | `10.10.99.1` |
| DNS | `10.10.99.11` (changed later, see below) |

## Network

Plugged into a spare internal port on the FortiGate. The internal ports act as one hardware switch, so any of them lands on 10.10.99.0/24 with no config.

Checked on the console:

```
ip -br a
cat /etc/network/interfaces
ping -c 3 10.10.99.1
```

| What to look for | Result |
|---|---|
| `vmbr0` UP with `10.10.99.3/24` | Yes |
| `bridge-ports` matches the physical NIC | Yes, `nic0` |
| Gateway replies | Yes |

`nic0` is Proxmox 9's pinned NIC naming, so a kernel update can't rename the card and break the bridge.

## Repositories

Proxmox ships with the enterprise repos turned on. Without a subscription they return `401 Unauthorized`. Proxmox 9 uses deb822 `.sources` files, so the fix is:

```
echo "Enabled: no" >> /etc/apt/sources.list.d/pve-enterprise.sources
echo "Enabled: no" >> /etc/apt/sources.list.d/ceph.sources
cat > /etc/apt/sources.list.d/proxmox.sources <<'EOF'
Types: deb
URIs: http://download.proxmox.com/debian/pve
Suites: trixie
Components: pve-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
EOF
apt update && apt full-upgrade -y
```

The same thing can be done in the UI under Updates > Repositories. Use `full-upgrade` on Proxmox, because updates sometimes add or remove packages and plain `upgrade` won't.

pve01 was updated to 9.3 as well, so both nodes match before clustering.

## DNS fallback on both nodes

The first internet test failed by name but worked by IP. DNS was pointed only at DC01, which was shut down.

Pi-hole and DC01 both run on pve01, so if pve01 is down both lab DNS servers are gone too. Each node now has an outside server as a last resort.

| Slot | Server |
|---|---|
| DNS 1 | `10.10.99.20` Pi-hole |
| DNS 2 | `10.10.99.11` DC01 |
| DNS 3 | `9.9.9.9` Quad9 |

Linux only moves to the next server when one doesn't answer at all. If a server answers "doesn't exist", that's final.

## Cluster

Created on pve01 under Datacenter > Cluster, then joined from pve02 using the join information. pve02 had no VMs yet, which matters because a node can only join while it's empty.

| Setting | Value |
|---|---|
| Cluster name | `twilight` (can't be renamed later) |
| pve01 link 0 | `10.10.99.2` |
| pve02 link 0 | `10.10.99.3` |

```
pvecm status
```

Shows 2 nodes and `Quorate: Yes`.

Corosync (the cluster traffic) stays on 10.10.99.0/24 and never crosses the FortiGate, so no firewall changes were needed. API tokens are shared across the cluster, so the existing `root@pam!homarr` token works on both nodes.

### The two node quorum problem

Each node gets one vote. A side needs more than half the votes to make changes.

| Situation | Votes | What happens |
|---|---|---|
| Both nodes up | 2 of 2 | Normal |
| One node down | 1 of 2 | Running VMs keep running, but nothing can be started, stopped or changed |

If that happens, run this on the surviving node to tell it to carry on alone:

```
pvecm expected 1
```

The proper fix is a QDevice: a small third vote running outside both nodes. It can run in the cloud over Tailscale because, unlike corosync, it doesn't need a low latency link.

### Why the nodes kept their names

Renaming a node after it joins a cluster isn't supported. The name is in the corosync config, `/etc/pve/nodes/`, certificates and hosts entries. Friendly names can go on top instead with DNS names, tags and labels.

## Monitoring

| Tool | What was added |
|---|---|
| Uptime Kuma | Monitor on `10.10.99.3:8006` |
| Nginx Proxy Manager | `pve02.twilight.goaround.lol`, https upstream, websockets on |

## Issues hit

| Problem | Cause | Fix |
|---|---|---|
| `401 Unauthorized` on apt | Enterprise repos on by default | Disabled them, added no-subscription |
| pve02 unreachable | FortiGate internal3 port only linking at 100Mbps and unreliable | Moved to another port, internal3 left unused |
| Mac lost the lab, pings failed | A second cable from the home router into `wan2`. `wan2` took a DHCP address, **the same IP as the Mac**, plus a second default route | Unplugged it, set `wan2` to static `0.0.0.0` and admin down |
| Couldn't ping by name | DNS only pointed at DC01, which was off | Pi-hole, DC01 and Quad9 as fallback |

The `wan2` change from the CLI:

```
config system interface
edit wan2
set mode static
set ip 0.0.0.0 0.0.0.0
set status down
end
```

A second WAN cable to the same router doesn't add real redundancy anyway. The router and the LTE connection are still single points of failure. Proper dual WAN means two different connections in an SD-WAN zone.

## Lessons

- Two DCs on one host isn't redundancy. Separate hardware is the point.
- Check `/dev/kvm` to prove virtualisation is on instead of hunting through every BIOS menu.
- Never plug a spare port into a network "just in case". It can grab an address, add a route and quietly break things.
- Infrastructure DNS needs a fallback that doesn't depend on the infrastructure.
- Join nodes to a cluster while they're empty, and update both to the same version first.
- Two nodes means no quorum when one is down. Know `pvecm expected 1`.

## Next

- DC02 on pve02 (Server Core), promoted into `lab.twilight`
- QDevice for a third vote
- Shared or replicated storage, then HA for docker01
- lab-stats panel switched to `/cluster/resources` so it shows both nodes
