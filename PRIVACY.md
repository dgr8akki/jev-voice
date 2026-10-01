# Privacy policy

_Last updated: 30 September 2026_

Jev Voice lets you drive Chrome by voice. It has no server behind it, and nothing it handles ever reaches me. Network traffic comes from two places. The extension calls the Jev provider you chose. Chrome's speech recognition does its own fetching: Google's speech service when recognition cannot run on your device, or a one-off model download on Chrome 139 and later when it can.

## Where each piece of data goes

| Data                                                                     | Where it goes                                                                                                                                                                        | Why                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Your microphone audio                                                    | Chrome's built-in recogniser. It runs locally where supported (Chrome 139 and later fetch the speech model from Google once); elsewhere the audio goes to Google's speech service    | Turning speech into text            |
| The text of each command                                                 | Your chosen provider. With [TypeSafe](https://typesafe.ai) it goes straight there; with [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) it passes through Vercel to TypeSafe | Understanding what you asked        |
| The active tab's full URL, including any query string, and its title     | Same destination as the command text                                                                                                                                                 | Context for the command             |
| Labels of visible links, buttons and fields (for example "field: Email") | Same destination as the command text                                                                                                                                                 | Finding the element you referred to |
| The API key and the provider name                                        | Stored in `chrome.storage.local`. Each request carries the key as a bearer token, addressed only to the provider the key belongs to                                                  | Authenticating requests             |

Jev Voice does **not** send what you've typed into fields, page text, cookies or your browsing history. It never records or stores audio.

While you are listening, a request goes out for each phrase you say, and the same phrase may be sent several times as you speak it, once per pause in your speech, so that a command can run before you finish. A typed command goes out a single time. Nothing is sent while listening is off and you are not typing a command.

The provider bills your own TypeSafe or Vercel account for each request, and what it does with the text once it arrives is covered by TypeSafe's privacy policy and, if you route through the gateway, [Vercel's](https://vercel.com/legal/privacy-policy). I never see the requests.

## Permissions

- **Access to websites (`http://*/*` and `https://*/*`) and `scripting`**: to list the visible links, buttons and fields on the active tab, and to click, type and scroll when you ask. Local files and other schemes are not requested.
- **`sidePanel`**: to show the controls beside the page.
- **`storage`**: holds the API key and which provider it is for.
- **Microphone**: Chrome prompts once, the first time you start listening, and the audio then feeds speech recognition.

## Stopping and uninstalling

Pressing the microphone button again ends listening. Uninstalling Jev Voice wipes the stored key along with the rest of what it kept.

## Getting in touch

Write to pahujaaakash5@gmail.com. Questions you are happy to ask in public can go on the [issue tracker](https://github.com/dgr8akki/jev-voice/issues).
