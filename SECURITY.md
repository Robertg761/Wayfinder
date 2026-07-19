# Wayfinder Security Policy

## Supported version

Wayfinder is currently a pre-release project. Security fixes are applied to the
latest code on `main` and to the active public Worker deployment.

## Reporting a vulnerability

Please do not publish an unpatched vulnerability, credential, exploit, or
sensitive repository data in a public issue.

Use GitHub's **Report a vulnerability** flow from the repository's Security
tab when it is available. If private reporting is unavailable, open a minimal
issue asking the maintainer for a private contact path without including the
vulnerability details.

Useful reports include:

- the affected extension or Worker version
- the public GitHub route or API endpoint involved
- the security boundary that was crossed
- minimal reproduction steps with secrets removed
- the expected safe behavior

Non-sensitive reliability and correctness defects can use the regular bug
report form.

## Security boundaries

Wayfinder is designed for public GitHub repositories. Reports are especially
useful when they concern:

- exposure of extension or Worker credentials
- repository path or command injection
- evidence links that escape the mapped repository and commit
- model output that bypasses deterministic path or command validation
- cross-tab or cross-repository cache leakage
- model-budget or rate-limit bypasses

See [PRIVACY.md](PRIVACY.md) for the current data flow and retention policy.
