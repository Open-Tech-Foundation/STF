// The extension is a launcher, nothing more.
//
// Every diagnostic, code, and formatting decision comes from `stf lsp`, which runs the
// reference parser. An extension that checked STF itself would be a second, approximate
// implementation of the specification — which is what this one used to be, and why its
// warnings disagreed with `stf check`.

import * as vscode from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    context.subscriptions.push(
        vscode.commands.registerCommand('stf.restartServer', () => restart(context))
    );

    // A changed server path is only meaningful after a restart, so offer one rather than
    // leaving the old process running against the new setting.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('stf.server')) {
                await restart(context);
            }
        })
    );

    await start(context);
}

async function start(context: vscode.ExtensionContext): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('stf');
    const command = configuration.get<string>('server.path', 'stf').trim() || 'stf';
    const args = [...configuration.get<string[]>('server.args', []), 'lsp'];

    const serverOptions: ServerOptions = {
        run: { command, args, transport: TransportKind.stdio },
        debug: { command, args, transport: TransportKind.stdio }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'stf' }],
        // `.stf` and `.stfs` are one language; the server reads the URI's extension to decide
        // whether to frame the document as a stream.
        synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher('**/*.stf{,s}') }
    };

    // Not pushed onto `context.subscriptions`: a restart replaces the client, and the disposed
    // ones would accumulate there for the life of the window. `deactivate` stops the live one.
    client = new LanguageClient('stf', 'STF Language Server', serverOptions, clientOptions);

    try {
        await client.start();
    } catch (error) {
        client = undefined;
        await reportMissingServer(command, error);
    }
}

async function restart(context: vscode.ExtensionContext): Promise<void> {
    await stop();
    await start(context);
}

async function stop(): Promise<void> {
    const running = client;
    client = undefined;
    if (running) {
        await running.stop();
    }
}

/// The server is a separate binary, so "not installed" is the one failure a user will
/// actually hit. Say which command failed and how to get it, rather than logging to a channel
/// nobody has open.
async function reportMissingServer(command: string, error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error);
    const install = 'Installation instructions';
    const setPath = 'Set server path';
    const choice = await vscode.window.showErrorMessage(
        `STF: could not start \`${command} lsp\`. Install the \`stf\` command-line tool, or set ` +
            `\`stf.server.path\` to its location. (${detail})`,
        install,
        setPath
    );
    if (choice === install) {
        await vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/Open-Tech-Foundation/STF#command-line-tool')
        );
    } else if (choice === setPath) {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'stf.server.path');
    }
}

export async function deactivate(): Promise<void> {
    await stop();
}
