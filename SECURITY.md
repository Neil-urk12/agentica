# Security Policy

This project is in active early-stage development. Security reports are welcome, and we ask that you handle them responsibly.

## Supported versions

At present, the project does not yet publish a formal support matrix for a stable release series. Until the maintainers define a broader release policy, the project supports:

- the current default branch (the latest committed code in the repository), and
- any currently published GitHub release that the maintainers explicitly keep available.

Older releases, older commit points, forks, and unmaintained branches are not covered by a guaranteed fix commitment. If a release policy is added later, this section should be updated to match the maintainers' actual support window.

## How to report a vulnerability

Please report suspected vulnerabilities privately through the repository's GitHub Security Advisories reporting flow if it is enabled for this project. If that private reporting path is not active, the maintainers should enable it or configure another private maintainer contact before public disclosure is considered.

Do not open a public GitHub issue, discussion, or social post for a suspected security vulnerability before the maintainers have had an opportunity to review it.

## What to include in a report

When reporting a vulnerability, include as much relevant information as possible:

- affected project version or commit hash;
- the specific component or runtime path involved;
- steps to reproduce the issue;
- the observed impact or risk, including who could be affected;
- the conditions required to trigger the issue;
- any relevant logs, stack traces, screenshots, or proof-of-concept output;
- the environment used for reproduction (OS, toolchain, build, configuration, and relevant data assumptions).

The more evidence you can provide, the faster the maintainers can assess and validate the report.

## Response expectations

This project is maintained on a best-effort basis and does not currently publish a fixed service-level agreement for security triage or remediation. The maintainers will do their best to acknowledge reports promptly and assess them as time permits. Fix timing depends on project capacity, the severity of the issue, and the release cadence for the affected area.

If a vulnerability is confirmed, the maintainers may coordinate a fix, a temporary mitigation, or a public advisory once the report has been handled responsibly.

## Responsible disclosure

Please do not disclose vulnerability details publicly before the maintainers have had a chance to investigate and respond. Responsible disclosure helps protect users and keeps the fix process orderly.

When a report is received, the maintainers may coordinate with the reporter on a reasonable disclosure timeline. The goal is to fix or mitigate the issue without exposing users to unnecessary risk before a patch or mitigation is available.

## Security-related guidance

- Do not exploit a vulnerability beyond what is necessary to confirm the issue.
- Do not access or exfiltrate data beyond the minimum required for validation.
- Do not disclose exploit details publicly before maintainers respond.
- If you are unsure whether something qualifies as a security issue, report it privately and let the maintainers decide.

This policy should be reviewed and adjusted by maintainers when the project reaches a more formal release and maintenance model.
