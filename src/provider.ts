import { Anthropic } from '@anthropic-ai/sdk';
import * as vscode from 'vscode';

let anthropic: Anthropic | undefined;
let availableModels: vscode.LanguageModelChatInformation[] = [];

export async function initAnthropicClient(context: vscode.ExtensionContext) {
    if (!anthropic) {
        let apiKey = await context.secrets.get('claude.apiKey');
        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your Anthropic API Key',
                ignoreFocusOut: true,
            });

            if (!apiKey) {
                throw new Error('API Key is required');
            }

            await context.secrets.store('claude.apiKey', apiKey);
        }
        anthropic = new Anthropic({
            apiKey,
        });

        // Fetch available models from the API
        await fetchAvailableModels();
    }
}

async function fetchAvailableModels() {
    if (!anthropic) {
        throw new Error('Anthropic client is not initialized.');
    }

    try {
        const modelsResponse = await anthropic.models.list();

        availableModels = modelsResponse.data.map((model) => {
            // Extract version from model ID (e.g., "claude-sonnet-4-5-20250929" -> "4.5")
            const versionMatch = model.id.match(/claude-\w+-(\d+)-(\d+)/);
            const version = versionMatch
                ? `${versionMatch[1]}.${versionMatch[2]}`
                : '1.0';

            // Use default token limits (these may vary by model, see Anthropic docs)
            // Most Claude 3+ models support 200k input and at least 8k output tokens
            const maxInputTokens = 200000;
            const maxOutputTokens = model.id.includes('opus')
                ? 16384
                : model.id.includes('sonnet')
                  ? 64000
                  : 8192;

            return {
                id: model.id,
                name: model.display_name,
                family: 'claude',
                version: version,
                maxInputTokens: maxInputTokens,
                maxOutputTokens: maxOutputTokens,
                capabilities: {},
            };
        });
    } catch (error) {
        throw new Error(`Failed to fetch models: ${error}`);
    }
}

export class ChatModelProvider implements vscode.LanguageModelChatProvider {
    async provideLanguageModelChatInformation(
        _options: vscode.PrepareLanguageModelChatModelOptions,
        _token: vscode.CancellationToken
    ) {
        return availableModels;
    }

    async provideLanguageModelChatResponse(
        model: vscode.LanguageModelChatInformation,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
        _options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: vscode.Progress<vscode.LanguageModelResponsePart>,
        _token: vscode.CancellationToken
    ): Promise<void> {
        await new Promise((resolve, reject) => {
            if (!anthropic) {
                reject(new Error('Anthropic client is not initialized.'));
                return;
            }

            const concatenatedContent = this.messagesToPrompt(messages);
            if (concatenatedContent.length === 0) {
                resolve('');
                return;
            }
            anthropic.messages
                .stream(
                    this.createModelParamsStreaming(model, concatenatedContent)
                )
                .on('text', (text) => {
                    progress.report(new vscode.LanguageModelTextPart(text));
                })
                .on('error', (err) => {
                    reject(err);
                })
                .on('finalMessage', () => {
                    resolve('');
                });
        });
    }
    async provideTokenCount(
        model: vscode.LanguageModelChatInformation,
        text: string | vscode.LanguageModelChatRequestMessage,
        _token: vscode.CancellationToken
    ): Promise<number> {
        if (!anthropic) {
            throw new Error('Anthropic client is not initialized.');
        }

        const prompt = this.messageToPrompt(text);

        if (prompt.length === 0) {
            return 0;
        }

        const response = await anthropic.messages.countTokens({
            messages: this.createMessages(prompt),
            model: model.id,
        });
        if (!response) {
            throw new Error('Failed to count tokens.');
        }

        return response.input_tokens;
    }

    private createModelParamsStreaming(
        model: vscode.LanguageModelChatInformation,
        userPrompt: string
    ): Anthropic.MessageCreateParamsStreaming {
        return {
            messages: this.createMessages(userPrompt),
            stream: true,
            model: model.id,
            max_tokens: model.maxOutputTokens,
        };
    }

    private createMessages(userPrompt: string): Anthropic.MessageParam[] {
        return [{ role: 'user', content: userPrompt }];
    }

    private messagesToPrompt(
        messages: readonly vscode.LanguageModelChatRequestMessage[]
    ): string {
        return messages.map((msg) => this.messageToPrompt(msg)).join(' ');
    }

    private messageToPrompt(
        message: string | vscode.LanguageModelChatRequestMessage
    ): string {
        if (typeof message === 'string') {
            return message;
        }

        return message.content
            .map((msg) => {
                if (msg instanceof vscode.LanguageModelTextPart) {
                    return msg.value;
                } else {
                    // for tool result/call parts, estimate the token count
                    return JSON.stringify(msg);
                }
            })
            .join(' ');
    }
}
