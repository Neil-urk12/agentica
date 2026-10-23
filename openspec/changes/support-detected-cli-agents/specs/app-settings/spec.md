## MODIFIED Requirements

### Requirement: Advanced section holds developer settings

The **Advanced** section SHALL contain the provider choice (OpenRouter or own
OpenAI-compatible server), the server address, the canvas-edits toggle, the exact model
ID, and a **Coding agents** list. Each control MUST have a one-line plain-language
explanation. The Coding agents list SHALL show each built-in agent with its resolved path
or unavailable reason as reported by the backend, and each custom agent defined on this
machine with controls to add, edit, and remove it. It SHALL state that custom agents are
saved only on this machine.

#### Scenario: Switch to own server

- **WHEN** the user chooses their own AI server in **Advanced**
- **THEN** the server address and canvas-edits toggle are shown
- **AND** the key and model stored for OpenRouter are kept and restored if the user
  switches back

#### Scenario: Coding agents status

- **WHEN** the backend is connected and the **Advanced** section is shown
- **THEN** each built-in agent is listed with its resolved path or the backend's unavailable reason

#### Scenario: Add a custom agent from Settings

- **WHEN** the user adds a custom agent with a valid label, absolute executable path, and argv
- **THEN** it appears in the Coding agents list and in the add-tile menu without reloading

#### Scenario: Backend rejects a custom agent

- **WHEN** the backend rejects a custom agent definition
- **THEN** its reason is shown next to the form and no entry is added
