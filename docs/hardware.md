# Hardware

[Back to README](../README.md)

## Proxmox host (pve01)

| Part | Spec |
|---|---|
| Model | Dell OptiPlex 7040 SFF |
| CPU | Intel Core i5-6500, 4 cores @ 3.2GHz |
| RAM | 8GB DDR4-2133 (2x4GB), 2 of 4 slots free, max 64GB |
| Storage | 1TB Crucial BX500 SATA SSD |
| M.2 slot | Free, supports NVMe |
| NIC | 1x onboard gigabit |
| Boot mode | Legacy BIOS |

## Other gear

| Device | Role |
|---|---|
| FortiGate 60E | Lab firewall and router |
| Laptop | Management workstation |

## Current limits

- **RAM:** 8GB is the main bottleneck. With DC01 on 3GB, the host sits around 60% used. There's no room for DC02, a client and a Docker VM.
- **Disk:** the BX500 has no DRAM cache, so it slows down under sustained writes. IO delay hit around 36% while installing Windows Server.

## Upgrade plan

| Priority | Upgrade | Why |
|---|---|---|
| 1 | 2x8GB DDR4-2133 desktop RAM (Crucial CT8G4DFD8213) in the free slots, 24GB total | Room for DC01, DC02, a Windows 11 client and the Docker VM. Same speed as the existing sticks. |
| Later | Swap the 2x4GB sticks for 2x8GB or 2x16GB | 32GB or 48GB once the lab grows |
| 2 | NVMe SSD with DRAM cache in the M.2 slot, used as VM storage | Cuts IO delay. No reinstall needed, keep the BX500 for Proxmox and ISOs. |
| Later | USB NIC (RTL8156B) or a box with two NICs | Needed for OPNsense |

## Buying notes

- The 7040 runs RAM at 2133MT/s and doesn't support XMP, so faster sticks just run slower. No point paying for speed or RGB.
- Avoid tall heatspreaders. Space around the RAM is tight in the SFF case.
- Must be non-ECC unbuffered desktop RAM (UDIMM). Registered or ECC server RAM (RDIMM) won't work.
