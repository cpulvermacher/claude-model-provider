# Change Log

## [0.5.1] (pre-release)
- Use accurate token count for larger inputs (>60% of input token maximum), quick estimate for smaller.
- Fix token count for image data.

## [0.5.0] (pre-release)

- Enable Anthropic prompt caching for the request prefix (tool definitions and prior messages), reducing cost on multi-turn conversations. Can be disabled via the `Claude-model-provider: Prompt Caching` setting.
- Update Anthropic API SDK to 0.110.0.

## [0.4.1]
Same as 0.4.0.

## [0.4.0] (pre-release)

- Add tool calling support, to fix using the models within the Chat sidebar. Models can now be used in Ask, Agent, or Plan mode.
- Add image input support.

## [0.3.4]

- Use token limits reported by the API instead of hardcoded values per model family. Newer models such as Claude Sonnet 4.6 and Opus 4.8 now allow up to 872,000 input tokens.
- Update Anthropic API SDK.

## [0.3.3]

- Update Anthropic API SDK.

## [0.3.2]

- Update anthropic API sdk, adds support for Claude Opus 4.6.
- Add extension icon.

## [0.3.1]

- Fix error handling for reset API key command.

## [0.3.0]

- Add error handling for e.g. wrong API keys.
- Add `Claude Model Provider: Reset API Key` command.

## [0.2.0]

- First release.
