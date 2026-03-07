# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | Yes                |
| < 2.0   | No                 |

## Reporting a Vulnerability

If you discover a security vulnerability in Ruam, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **owen@owen.lol** with:

- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fix (optional)

You should receive an acknowledgment within 48 hours. Once the issue is confirmed, a fix will be developed privately and released as a patch before public disclosure.

## Scope

Ruam is a build-time obfuscation tool. Security reports are relevant for:

- **Bytecode encryption weaknesses** — flaws in the rolling cipher, integrity binding, or key derivation that allow automated recovery of original source
- **Opcode shuffle predictability** — weaknesses in the PRNG seeding or Fisher-Yates implementation that reduce shuffle entropy
- **String encoding bypasses** — methods to decode XOR-encoded constant pool strings without executing the VM
- **Runtime template vulnerabilities** — issues in generated VM code that could be exploited at runtime (e.g., prototype pollution, injection)
- **Information leakage** — cases where the obfuscated output unintentionally reveals source structure, variable names, or logic

Out of scope:

- Attacks requiring physical access to the build environment
- Social engineering
- Denial of service against the CLI tool itself
- General JavaScript deobfuscation techniques that apply equally to all obfuscators

## Disclosure Policy

- Vulnerabilities will be patched before public disclosure
- Credit will be given to reporters in the release notes (unless anonymity is requested)
- We aim to release fixes within 14 days of confirmation
