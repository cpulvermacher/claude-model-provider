# Claude Model Provider Extension for VS Code

[![Latest Release](https://flat.badgen.net/github/release/cpulvermacher/claude-model-provider)](https://github.com/cpulvermacher/claude-model-provider/releases)
[![License](https://flat.badgen.net/github/license/cpulvermacher/claude-model-provider)](./LICENSE)

This Visual Studio Code extension contributes language models that can be used in the chat view and also by other extensions that allow selecting language models.

## Why?

Adding your Anthropic API key directly in Visual Studio Code only allows using Claude models from the Chat sidebar. Trying to use the models from another extension will produce `system: text content blocks must be non-empty` errors.

This extension allows using Claude models from other extensions like [LGTM](https://marketplace.visualstudio.com/items?itemName=cpulvermacher.lgtm) as well.

## Models

Models are fetched from the Anthropic API, so newer models such as Claude Opus 4.8 and Sonnet 5 are available automatically, without an extension update.

## Use in Chat

Extension-provided language models may not be visible in the chat model picker. Use the `Chat: Manage Language Models` command to list all models, and toggle visibility for the model(s) you want.

Note: If you only want to use Claude in the Chat view, you don't need this extension. Visual Studio Code's built-in "bring your own key" (BYOK) support should work. (Open the `Chat: Manage Language Models` command and click `Add Models > Anthropic`)

## Use from another extension

Any extension can send requests to these models through VS Code's [Language Model API](https://code.visualstudio.com/api/extension-guides/language-model) (`vscode.lm`), without depending on this extension directly.

Select a model with a [chat model selector](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChatSelector), then stream a response:

```ts
import * as vscode from 'vscode';

const [model] = await vscode.lm.selectChatModels({
    vendor: 'claude-model-provider', // omit to allow any provider
    // family: 'claude',
    // id: 'claude-sonnet-4-5-20250929',
});
if (!model) {
    return; // extension not installed, or no models available
}

const messages = [
    vscode.LanguageModelChatMessage.User('Explain this code: ...'),
];
const response = await model.sendRequest(messages, {}, cancelToken);
for await (const chunk of response.text) {
    // chunk is of type `string`
}
```

Notes:

- The user is asked for consent the first time your extension sends a request. Pass `justification` in the request options to explain why you need access.
- Tool calling is supported: pass `tools` in the request options, and handle `LanguageModelToolCallPart` items from `response.stream` (rather than `response.text`, which yields text only). See [Tool calling](https://code.visualstudio.com/api/extension-guides/ai/language-model#tool-calling).

## Setup

The extension will prompt you to enter your API key when you first use it.
It's recommended to generate a new key from the [Claude Console](https://platform.claude.com/settings/keys).

To change your key later, run the `Claude Model Provider: Update API Key` command from the Command Palette.

## Settings

- `Claude-model-provider: Prompt Caching` (default: enabled): caches the request prefix (tool definitions and prior messages) via Anthropic's [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching), so later turns in a conversation re-read the cached prefix at reduced cost. If you mainly send single requests rather than multi-turn conversations, this can moderately increase costs and you may want to turn this off.

## Disclaimer

This extension is not associated with Anthropic. It's an independent project that uses Anthropic's API.

Usage is billed to your own account at standard API rates.

## Support

If you encounter any issues or have questions, please open an issue on the GitHub repository.
