# Anthropic Claude Language Model Provider Extension for VS Code

This Visual Studio Code extension contributes a language model that can be used in the chat view and also by other extensions that allow selecting language models.

## Why?

Adding your Anthropic API key directly in Visual Studio Code is possible but will work only in chat.
Trying to use models from another extension will produce `system: text content blocks must be non-empty` errors.

This extension allows using Anthropic models from other extensions as well.

## Prerequisites

Before using this extension, you need to have an Anthropic API key. If you don't have one, you can obtain it from [Anthropic's website](https://www.anthropic.com/).

## Installation

1. Install the extension from the VS Code marketplace or by searching for "Claude Chat" in the Extensions view.
2. Reload VS Code after installation.

## Setup

The extension will prompt you to enter your API key when you first use it.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This extension is not officially associated with Anthropic. It's an independent project that uses Anthropic's API.

## Support

If you encounter any issues or have questions, please open an issue on the GitHub repository.
