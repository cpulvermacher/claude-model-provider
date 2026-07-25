import { Anthropic } from '@anthropic-ai/sdk';
import * as vscode from 'vscode';

import { getApiKey, promptAndStoreApiKey, resetApiKey } from './secrets';

export async function initializeProvider(context: vscode.ExtensionContext) {
    let apiKey = await getApiKey(context);
    if (!apiKey) {
        apiKey = await promptAndStoreApiKey(context);
    }

    let anthropic: Anthropic;
    let availableModels: vscode.LanguageModelChatInformation[];
    try {
        anthropic = new Anthropic({ apiKey });
        availableModels = await fetchAvailableModels(anthropic);
    } catch (error) {
        const resetApiKeyAction = 'Reset API Key';
        const abortAction = 'Abort';
        const action = await vscode.window.showErrorMessage(
            `Failed to initialize Anthropic client: ${error}`,
            resetApiKeyAction,
            abortAction
        );

        if (action === resetApiKeyAction) {
            await resetApiKey(context);
            return await initializeProvider(context);
        }
        throw error;
    }

    return new ChatModelProvider(anthropic, availableModels);
}

async function fetchAvailableModels(anthropic: Anthropic) {
    try {
        const modelsResponse = await anthropic.models.list();

        return modelsResponse.data.map((model: Anthropic.ModelInfo) => {
            // Extract version from model ID (e.g., "claude-sonnet-4-5-20250929" -> "4.5")
            const versionMatch = model.id.match(/claude-\w+-(\d+)-(\d+)/);
            const version = versionMatch
                ? `${versionMatch[1]}.${versionMatch[2]}`
                : '1.0';

            const maxOutputTokens = model.max_tokens ?? 64000;
            const maxInputTokens =
                (model.max_input_tokens ?? 200000) - maxOutputTokens;

            return {
                id: model.id,
                name: model.display_name,
                family: 'claude',
                version: version,
                maxOutputTokens,
                maxInputTokens,
                capabilities: {
                    toolCalling: true,
                    imageInput:
                        model.capabilities?.image_input.supported ?? true,
                },
            };
        });
    } catch (error) {
        throw new Error(`Failed to fetch models: ${error}`);
    }
}

export class ChatModelProvider implements vscode.LanguageModelChatProvider {
    // ~4 chars/token on prose but ~2.5 on dense source; estimating low is
    // deliberate, since undercounting breaks a caller's budgeting while
    // overcounting only wastes context.
    private static readonly CHARS_PER_TOKEN = 3.5;

    // An estimate at this fraction still fits the real budget down to 2.1
    // chars/token (0.6 * 3.5 / 2.1 = 1).
    private static readonly EXACT_COUNT_FRACTION = 0.6;

    constructor(
        private anthropic: Anthropic,
        private availableModels: vscode.LanguageModelChatInformation[] = []
    ) {}

    async provideLanguageModelChatInformation(
        _options: vscode.PrepareLanguageModelChatModelOptions,
        _token: vscode.CancellationToken
    ) {
        return this.availableModels;
    }

    async provideLanguageModelChatResponse(
        model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        token: vscode.CancellationToken
    ): Promise<void> {
        const anthropicMessages = this.convertMessages(messages);
        if (anthropicMessages.length === 0) {
            return;
        }

        const stream = this.anthropic.messages.stream(
            this.createModelParamsStreaming(model, anthropicMessages, options)
        );

        // Stream text deltas as they arrive.
        stream.on('text', (text) => {
            progress.report(new vscode.LanguageModelTextPart(text));
        });

        token.onCancellationRequested(() => stream.abort());

        let finalMessage: Anthropic.Message;
        try {
            // finalMessage() always settles: it resolves on success and
            // rejects on error or abort, so the response can never hang.
            finalMessage = await stream.finalMessage();
        } catch (error) {
            if (error instanceof Anthropic.APIUserAbortError) {
                return;
            }
            throw error;
        }

        // Text was already streamed above; here we surface any tool calls the
        // model decided to make.
        for (const block of finalMessage.content) {
            if (block.type === 'tool_use') {
                progress.report(
                    new vscode.LanguageModelToolCallPart(
                        block.id,
                        block.name,
                        (block.input ?? {}) as object
                    )
                );
            }
        }
    }

    async provideTokenCount(
        model: vscode.LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatRequestMessage,
        token: vscode.CancellationToken
    ): Promise<number> {
        // VS Code calls this thousands of times per chat session, so the
        // common path stays local; only estimates near the input budget are
        // worth a network round-trip.
        const content =
            typeof text === 'string' ? text : this.partsToText(text.content);
        const estimate = Math.ceil(
            content.length / ChatModelProvider.CHARS_PER_TOKEN
        );

        const threshold =
            model.maxInputTokens * ChatModelProvider.EXACT_COUNT_FRACTION;
        if (estimate <= threshold) {
            return estimate;
        }

        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() =>
            controller.abort()
        );
        try {
            const count = await this.anthropic.messages.countTokens(
                { model: model.id, messages: [{ role: 'user', content }] },
                { signal: controller.signal }
            );
            return count.input_tokens;
        } catch {
            // a budgeting caller needs a number, not an exception
            return estimate;
        } finally {
            cancellation.dispose();
        }
    }

    private partsToText(parts: ReadonlyArray<unknown>): string {
        return parts
            .map((part) => {
                if (part instanceof vscode.LanguageModelTextPart) {
                    return part.value;
                }
                if (part instanceof vscode.LanguageModelToolCallPart) {
                    return part.name + JSON.stringify(part.input);
                }
                if (part instanceof vscode.LanguageModelToolResultPart) {
                    return this.partsToText(part.content);
                }
                // image data parts are billed as tokens, but we can't size
                // them locally; ignore for the text estimate.
                return '';
            })
            .join('');
    }

    private createModelParamsStreaming(
        model: vscode.LanguageModelChatInformation,
        messages: Anthropic.MessageParam[],
        options: vscode.ProvideLanguageModelChatResponseOptions
    ): Anthropic.MessageCreateParamsStreaming {
        const tools = this.convertTools(options.tools);
        const promptCaching = vscode.workspace
            .getConfiguration('claude-model-provider')
            .get<boolean>('promptCaching', true);
        return {
            messages,
            stream: true,
            model: model.id,
            max_tokens: model.maxOutputTokens,
            // enable automatic caching of the request prefix at block level
            ...(promptCaching && {
                cache_control: { type: 'ephemeral' },
            }),
            ...(tools && {
                tools,
                tool_choice:
                    options.toolMode ===
                    vscode.LanguageModelChatToolMode.Required
                        ? { type: 'any' }
                        : { type: 'auto' },
            }),
        };
    }

    private convertTools(
        tools: readonly vscode.LanguageModelChatTool[] | undefined
    ): Anthropic.Tool[] | undefined {
        if (!tools || tools.length === 0) {
            return undefined;
        }

        return tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: (tool.inputSchema as Anthropic.Tool.InputSchema) ?? {
                type: 'object',
            },
        }));
    }

    private convertMessages(
        messages: readonly vscode.LanguageModelChatRequestMessage[]
    ): Anthropic.MessageParam[] {
        const result: Anthropic.MessageParam[] = [];

        for (const message of messages) {
            const role =
                message.role === vscode.LanguageModelChatMessageRole.Assistant
                    ? 'assistant'
                    : 'user';
            const content = this.convertContentParts(message.content);
            if (content.length === 0) {
                continue;
            }

            // The Anthropic API requires roles to alternate, so merge
            // consecutive messages that share the same role.
            const previous = result[result.length - 1];
            if (previous && previous.role === role) {
                (previous.content as Anthropic.ContentBlockParam[]).push(
                    ...content
                );
            } else {
                result.push({ role, content });
            }
        }

        return result;
    }

    private convertContentParts(
        parts: ReadonlyArray<unknown>
    ): Anthropic.ContentBlockParam[] {
        const blocks: Anthropic.ContentBlockParam[] = [];

        for (const part of parts) {
            if (part instanceof vscode.LanguageModelTextPart) {
                if (part.value.length > 0) {
                    blocks.push({ type: 'text', text: part.value });
                }
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                blocks.push({
                    type: 'tool_use',
                    id: part.callId,
                    name: part.name,
                    input: part.input,
                });
            } else if (part instanceof vscode.LanguageModelToolResultPart) {
                blocks.push({
                    type: 'tool_result',
                    tool_use_id: part.callId,
                    content: this.convertToolResultContent(part.content),
                });
            } else if (part instanceof vscode.LanguageModelDataPart) {
                const block = this.convertDataPart(part);
                if (block) {
                    blocks.push(block);
                }
            }
        }

        return blocks;
    }

    private convertToolResultContent(
        parts: ReadonlyArray<unknown>
    ): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
        const blocks: Array<
            Anthropic.TextBlockParam | Anthropic.ImageBlockParam
        > = [];

        for (const part of parts) {
            if (part instanceof vscode.LanguageModelTextPart) {
                blocks.push({ type: 'text', text: part.value });
            } else if (part instanceof vscode.LanguageModelDataPart) {
                const block = this.convertDataPart(part);
                if (block) {
                    blocks.push(block);
                }
            }
        }

        // tool_result content must not be empty
        if (blocks.length === 0) {
            blocks.push({ type: 'text', text: '' });
        }

        return blocks;
    }

    private convertDataPart(
        part: vscode.LanguageModelDataPart
    ): Anthropic.ImageBlockParam | undefined {
        if (!part.mimeType.startsWith('image/')) {
            return undefined;
        }

        return {
            type: 'image',
            source: {
                type: 'base64',
                media_type:
                    part.mimeType as Anthropic.Base64ImageSource['media_type'],
                data: Buffer.from(part.data).toString('base64'),
            },
        };
    }
}
