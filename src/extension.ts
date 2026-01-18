import * as vscode from 'vscode';

import { initializeProvider } from './provider';
import { resetApiKey } from './secrets';

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'claude-model-provider.resetApiKey',
            async () => {
                try {
                    await resetApiKey(context);
                    vscode.window.showInformationMessage(
                        'API key updated successfully. Please reload the window for changes to take effect.'
                    );
                } catch {
                    vscode.window.showWarningMessage(
                        'API key reset cancelled.'
                    );
                }
            }
        )
    );

    const provider = await initializeProvider(context);
    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(
            'claude-model-provider',
            provider
        )
    );
}

export function deactivate() {}
