import * as vscode from 'vscode';

import { initializeProvider } from './provider';
import { updateApiKey } from './secrets';

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'claude-model-provider.updateApiKey',
            async () => {
                try {
                    await updateApiKey(context);
                    vscode.window.showInformationMessage(
                        'API key updated successfully. Please reload the window for changes to take effect.'
                    );
                } catch {
                    vscode.window.showWarningMessage(
                        'API key update cancelled.'
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
