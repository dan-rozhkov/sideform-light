# Sideform Light privacy policy

Sideform Light keeps your data on your computer. It sends data to a network service only when you ask the
agent to do something.

## What stays on your computer

These items are stored in the `Sideform Light` user data folder and are never uploaded:

- chats and chat history;
- saved logins (passwords are encrypted with the operating system key store);
- browsing history, settings and ad-block lists;
- traces of agent runs;
- the agent's memory: short notes about you and your preferences that the agent saves to help you in
  later chats. You can see, delete or turn them off in Settings > Memory. They are sent to your model
  provider only as part of the agent's prompt.

The agent never receives your saved passwords. When it signs in with a saved login, the app fills the
password into the page itself.

## What is sent, and when

The app sends data only to the Sideform backend (`https://pen-editor-backend.onrender.com`):

- **At start:** a request for the list of available AI models. It contains no personal data.
- **When you send a message to the agent:** your message, the chat so far, and what the agent reads in
  the browser for that task (page text, page structure and screenshots). The request also contains a
  random anonymous ID that the app creates on first start. It is not linked to your name or email.

Nothing is sent to the backend while you browse without the agent.

Other network requests that are not about the agent:

- the web pages you open, as in any browser, and their icons for the tab bar and history;
- ad-block filter lists from the Ghostery CDN (once, then from a local cache). You can turn ad blocking
  off in Settings.

## What the backend does with it

- It forwards the request to an AI model provider (OpenRouter or DeepSeek) to produce the answer. These
  providers process the data under their own privacy policies.
- It stores request traces for up to 14 days to investigate errors, then deletes them.
- It records anonymous usage events (for example, "a turn failed") with the anonymous ID in PostHog. These
  events do not contain your messages or page content.

## How to stop data transfer

Do not send messages to the agent. The browser part of the app works without the backend. To remove all
local data, uninstall the app and delete the `Sideform Light` user data folder.

## Contact

Open an issue at https://github.com/dan-rozhkov/sideform-light/issues.
