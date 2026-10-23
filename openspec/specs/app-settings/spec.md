# app-settings Specification

## Purpose

The full-screen settings page: categories, navigation, plain-language AI setup status and check, and the Advanced section for developer settings.

## Requirements

### Requirement: Settings opens as a full-screen page over the current screen

The system SHALL show settings as a full-screen page layered over the current screen
(workspace picker, canvas picker, or canvas). The underlying screen MUST stay mounted
while settings is open, so live sessions and unsaved canvas state are preserved.

#### Scenario: Open settings from the canvas

- **WHEN** the user selects the Settings button on the canvas toolbar
- **THEN** the settings page covers the screen
- **AND** running terminal and Codex sessions on the canvas keep running

#### Scenario: Return with Back

- **WHEN** the user selects **← Back** or presses Escape on the settings page
- **THEN** the settings page closes and the previous screen is shown unchanged
- **AND** keyboard focus returns to the control that opened settings

#### Scenario: Open settings from any start screen

- **WHEN** the user selects Settings on the workspace picker or canvas picker
- **THEN** the same settings page opens

### Requirement: Settings is organized into categories

The settings page SHALL group settings into the categories **AI assistant**,
**Appearance**, and **Advanced**, and SHALL show one category's section at a time.
**AI assistant** MUST be selected when the page opens without a requested section.

#### Scenario: Wide window shows a category rail

- **WHEN** the settings page is open in a wide window
- **THEN** a category list is shown beside the selected category's section
- **AND** selecting a category shows its section without closing the page

#### Scenario: Narrow window shows list then detail

- **WHEN** the settings page is open in a narrow window and no category is selected
- **THEN** only the category list is shown
- **AND** selecting a category shows its section with a control to go back to the list

### Requirement: Settings can open at a specific section

The system SHALL allow settings to be opened directly at a named category.

#### Scenario: Provider error opens the AI section

- **WHEN** an AI request fails with an error that points the user to Settings
- **AND** the user selects "Open settings" in the error banner
- **THEN** the settings page opens with **AI assistant** selected

### Requirement: AI assistant section uses plain language

The **AI assistant** section SHALL show a status line describing the current setup in
plain language, the API key field with show/hide, a link to get an OpenRouter key, and
a **Quality** choice. It MUST NOT show developer terms such as "base URL", "endpoint",
"CORS", "function calling", or "model identifier".

#### Scenario: No key entered

- **WHEN** OpenRouter is the provider and no key is stored
- **THEN** the status line says a key is needed and the "Get a free key" link is shown

#### Scenario: Key entered

- **WHEN** OpenRouter is the provider and a key is stored
- **THEN** the status line says the assistant is ready and names the chosen quality

#### Scenario: Custom provider in use

- **WHEN** the custom provider is selected
- **THEN** the status line says the user's own AI server is in use, shows its host, and
  links to **Advanced**

#### Scenario: Quality choices

- **WHEN** the user opens the **Quality** choice
- **THEN** "Free" (stored as the existing default model) and "A specific model…" are offered
- **AND** choosing "A specific model…" shows the **Advanced** section's model field

### Requirement: Check tests the current AI setup

The **AI assistant** section SHALL offer a **Check** button that sends one minimal
request to the selected provider with the current settings and reports the result in
plain language. The check MUST NOT change any stored setting.

#### Scenario: Setup works

- **WHEN** the user selects **Check** and the provider accepts the request
- **THEN** the status line confirms the assistant is working

#### Scenario: Key rejected

- **WHEN** the user selects **Check** and the provider rejects the key
- **THEN** the status line says the key isn't working and suggests copying it again

#### Scenario: Provider unreachable

- **WHEN** the user selects **Check** and the provider cannot be reached
- **THEN** the status line says the AI service couldn't be reached and suggests checking
  the internet connection or the server address in **Advanced**

#### Scenario: Check in progress

- **WHEN** a check is running
- **THEN** the **Check** button is disabled and the status line says it is checking

### Requirement: Advanced section holds developer settings

The **Advanced** section SHALL contain the provider choice (OpenRouter or own
OpenAI-compatible server), the server address, the canvas-edits toggle, the exact model
ID, and the Codex availability status. Each control MUST have a one-line plain-language
explanation.

#### Scenario: Switch to own server

- **WHEN** the user chooses their own AI server in **Advanced**
- **THEN** the server address and canvas-edits toggle are shown
- **AND** the key and model stored for OpenRouter are kept and restored if the user
  switches back

#### Scenario: Codex status

- **WHEN** the backend is connected and the **Advanced** section is shown
- **THEN** the Codex availability reason from the backend is shown

### Requirement: Settings changes save automatically and keep existing values

Settings SHALL save as the user changes them and show a brief "Saved" confirmation.
Existing stored settings MUST be read from the same storage keys as before, so upgrading
loses no configuration.

#### Scenario: Upgrade keeps configuration

- **WHEN** a user with a stored OpenRouter key, model, custom provider, and theme opens
  the new settings page
- **THEN** all of those values are shown and still used for AI requests

#### Scenario: Theme change

- **WHEN** the user changes Dark/Light in **Appearance**
- **THEN** the theme applies immediately and is remembered on this device
