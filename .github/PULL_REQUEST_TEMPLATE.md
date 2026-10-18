<!--
🙏 Thank you for contributing to Agentica!
We appreciate your time and effort in helping improve this visual workspace OS.
Please fill out the sections below as completely as possible to help us review your PR faster. 💪
-->

### 📋 Pull Request Summary

Provide a concise description of what this PR does.  
Example: Added custom OpenAI-compatible provider configuration and endpoint validation to the canvas settings panel.

---

### 🔍 Related Issue

Link related issue(s) if applicable.  
Example: Closes #42

---

### 🧠 Motivation / Context

Explain the reasoning behind this change — why is it needed?  
Example: Users needed a way to connect local or custom LLM endpoints without editing configuration files directly, improving flexibility for offline and self-hosted workflows.

---

### 🧪 Changes Introduced

List key updates or affected files.

- Added provider configuration modal in `apps/desktop/src/`
- Updated SQLite workspace persistence handling in `packages/agent-runtime/`
- Fixed TypeScript type definitions in `packages/protocol/`

---

### 🧰 Type of Change

Mark the type of change with an “x”.

- [ ] 🆕 New feature (non-breaking change that adds functionality)
- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to change)
- [ ] 🧹 Refactor (code improvement with no functional changes)
- [ ] 🧾 Documentation update

---

### 🧪 How Has This Been Tested?

Describe how you tested your changes. Include test configuration and steps.

# Example:
0. pnpm install --frozen-lockfile
1. pnpm dev
2. Verified provider settings save correctly and tested chat completions request flow against a local endpoint.
3. Ran `pnpm check` and `pnpm test` successfully.

---

### 📋 Relevant Images

Provide a screenshot of new/updated features (if applicable).
If resolving an issue, add picture of successful tests or UI changes.
