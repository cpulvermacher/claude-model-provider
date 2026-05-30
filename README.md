# Claude Model Provider Extension for VS Code

This Visual Studio Code extension contributes language models that can be used in the chat view and also by other extensions that allow selecting language models.

## Why?

Adding your Anthropic API key directly in Visual Studio Code only allows using Claude models from the Chat sidebar. Trying to use the models from another extension will produce `system: text content blocks must be non-empty` errors.

This extension allows using Claude models from other extensions as well.

## Models

Models are fetched from the Anthropic API, so newer models such as Claude Sonnet 4.6 and Opus 4.8 work automatically, without an extension update.

## Use in Chat

By default, extension-provided language models are not visible in the chat model picker. Use the `Chat: Manage Language Models` command to list all models, and toggle visibility for the model(s) you want. Afterwards, the models should be available in `Ask` mode.

## Setup

The extension will prompt you to enter your API key when you first use it.
It's recommended to generate a new key from the [Claude Console](https://platform.claude.com/settings/keys).

## Disclaimer

This extension is not associated with Anthropic. It's an independent project that uses Anthropic's API.

## Support

If you encounter any issues or have questions, please open an issue on the GitHub repository.
