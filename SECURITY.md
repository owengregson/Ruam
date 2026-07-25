# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes       |
| < 2.0   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in Ruam, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, use [GitHub's private vulnerability reporting](https://github.com/owengregson/ruam/security/advisories/new):

1. Go to the [Security Advisories](https://github.com/owengregson/ruam/security/advisories) page
2. Click **"New draft security advisory"**
3. Fill in the details:
    - A description of the vulnerability
    - Steps to reproduce it
    - The potential impact
    - Any suggested fix (optional)

This creates a private channel visible only to repository maintainers. You should receive an acknowledgment within 48 hours. Once the issue is confirmed, a fix will be developed privately and released as a patch before public disclosure.

## Scope

Ruam is an Isogloss source-protection compiler. The local profile ships a
complete executable client and makes no secrecy or hardness claim. Security
reports are relevant for:

-   **Semantic miscompilation** — protected output differs from the accepted source region, including evaluation order, TDZ, exception, numeric, or reentrancy behavior
-   **Trust-boundary leakage** — owner-only relation, placement, trace, key, or capability material appears in a client artifact
-   **Evidence or claim forgery** — caller-controlled data can produce a complete proof, eligible deployment, or stronger security claim without compiler/custodian evidence
-   **Custody protocol failures** — replay, fork, substitution, ambiguous authentication, missing request binding, or unsafe key/lineage handling in experimental nonlocal profiles
-   **Filesystem safety** — traversal, link following, race, partial publication, unsafe overwrite, or owner/client artifact aliasing
-   **Generated-code vulnerabilities** — injection, prototype pollution, ambient-intrinsic dependence, or resource exhaustion in emitted code
-   **Browser and build-service availability** — unbounded input, worker hangs, malformed messages, dependency compromise, or privilege escalation

Out of scope:

-   Attacks requiring physical access to the build environment
-   Social engineering
-   General JavaScript deobfuscation techniques that apply equally to all obfuscators
-   Claims that the explicitly complete `holographic-local` client can be inspected or reverse engineered

## Disclosure Policy

-   Vulnerabilities will be patched before public disclosure
-   Credit will be given to reporters in the release notes (unless anonymity is requested)
-   We aim to release fixes within 14 days of confirmation
