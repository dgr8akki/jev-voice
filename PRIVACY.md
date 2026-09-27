# Privacy policy

_Last updated: 27 September 2026_

Jev Voice is a Chrome extension for controlling the browser by voice. It has no servers, accounts or analytics of its own.

## What is processed, and where

| Data                                                                     | Where it goes                                                                                                                                                          | Why                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Your microphone audio                                                    | Your browser's speech recognition: on your device where Chrome supports it, otherwise Google's speech service                                                          | Turning speech into text            |
| The text of each command                                                 | The provider you pick in settings: [TypeSafe](https://typesafe.ai) directly, or [Vercel AI Gateway](https://vercel.com/docs/ai-gateway), which forwards it to TypeSafe | Understanding what you asked        |
| The active tab's URL and title                                           | The same provider, as above                                                                                                                                            | Context for the command             |
| Labels of visible links, buttons and fields (for example "field: Email") | The same provider, as above                                                                                                                                            | Finding the element you referred to |
| Your API key and provider                                                | `chrome.storage.local` in this browser only, readable only by the extension's own pages                                                                                | Authenticating requests             |

Jev Voice does **not** send what you've typed into fields, page text, cookies or your browsing history. It never records or stores audio. Nothing is sent unless you give a command.

Requests are billed to your own TypeSafe or Vercel account and are subject to the privacy policies of TypeSafe and, if you use it, [Vercel](https://vercel.com/legal/privacy-policy).

## Permissions

- **Access to websites (`<all_urls>`) and `scripting`**: to list the visible links, buttons and fields on the active tab, and to click and type when you ask.
- **`sidePanel`**: to show the controls beside the page.
- **`storage`**: to keep your API key.
- **Microphone** (asked for once): to hear your commands.

## Your choices

Stop listening at any time with the microphone button. Removing the extension deletes your stored key.

## Contact

Questions: open an issue at [github.com/dgr8akki/jev-voice](https://github.com/dgr8akki/jev-voice/issues).
