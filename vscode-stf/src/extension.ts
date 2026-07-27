import * as vscode from 'vscode';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    console.log('STF extension activated');

    diagnosticCollection = vscode.languages.createDiagnosticCollection('stf');
    context.subscriptions.push(diagnosticCollection);

    const validateDocument = async (document: vscode.TextDocument) => {
        if (document.languageId === 'stf') {
            await validateSTF(document);
        }
    };

    vscode.workspace.onDidOpenTextDocument(validateDocument, null, context.subscriptions);

    let timeout: NodeJS.Timeout | undefined;
    vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === 'stf') {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(() => {
                validateDocument(event.document);
            }, 500);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidSaveTextDocument(validateDocument, null, context.subscriptions);

    vscode.workspace.textDocuments.forEach(doc => {
        if (doc.languageId === 'stf') {
            validateDocument(doc);
        }
    });

    const validateCommand = vscode.commands.registerCommand('stf.validate', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'stf') {
            validateDocument(editor.document);
            vscode.window.showInformationMessage('STF validation complete');
        }
    });
    context.subscriptions.push(validateCommand);
}

async function validateSTF(document: vscode.TextDocument): Promise<void> {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    
    try {
        const errors = validateSTFSyntax(text);
        
        for (const error of errors) {
            const diagnostic = createDiagnostic(document, error);
            if (diagnostic) {
                diagnostics.push(diagnostic);
            }
        }
    } catch (e: any) {
        const range = new vscode.Range(0, 0, 0, 1);
        const diagnostic = new vscode.Diagnostic(
            range,
            `STF Validation Error: ${e.message || e}`,
            vscode.DiagnosticSeverity.Error
        );
        diagnostics.push(diagnostic);
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

interface STFError {
    message: string;
    line: number;
    column?: number;
    severity?: 'error' | 'warning';
}

function validateSTFSyntax(text: string): STFError[] {
    const errors: STFError[] = [];
    const lines = text.split('\n');
    
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let inComment = false;
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        inComment = false;
        
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            
            if (inComment) continue;
            if (ch === '#') {
                inComment = true;
                continue;
            }
            
            if (inString) {
                if (ch === stringChar && (i === 0 || line[i-1] !== '\\')) {
                    inString = false;
                }
                continue;
            }
            
            if (ch === '`' || ch === '"') {
                inString = true;
                stringChar = ch;
                continue;
            }
            
            if (ch === '{' || ch === '[') {
                depth++;
            } else if (ch === '}' || ch === ']') {
                depth--;
                if (depth < 0) {
                    errors.push({
                        message: 'ERR_SYNTAX: Unexpected closing bracket',
                        line: lineNum,
                        column: i,
                        severity: 'error'
                    });
                    depth = 0;
                }
            }
        }
    }
    
    if (inString) {
        errors.push({
            message: 'ERR_UNTERMINATED: Unterminated string literal',
            line: lines.length - 1,
            severity: 'error'
        });
    }
    
    if (depth > 0) {
        errors.push({
            message: 'ERR_UNTERMINATED: Unbalanced brackets',
            line: lines.length - 1,
            severity: 'error'
        });
    }
    
    return errors;
}

function createDiagnostic(document: vscode.TextDocument, error: STFError): vscode.Diagnostic | null {
    const line = error.line !== undefined ? error.line : 0;
    const column = error.column !== undefined ? error.column : 0;
    
    if (line >= document.lineCount) {
        return null;
    }
    
    const lineText = document.lineAt(line);
    const startCol = column < lineText.text.length ? column : 0;
    const endCol = lineText.text.length;
    
    const range = new vscode.Range(line, startCol, line, endCol);
    let severity = vscode.DiagnosticSeverity.Error;
    if (error.severity === 'warning') {
        severity = vscode.DiagnosticSeverity.Warning;
    }
    
    const diagnostic = new vscode.Diagnostic(
        range,
        error.message,
        severity
    );
    
    diagnostic.source = 'stf';
    
    if (error.message.includes('ERR_SYNTAX')) {
        diagnostic.code = 'ERR_SYNTAX';
    } else if (error.message.includes('ERR_UNTERMINATED')) {
        diagnostic.code = 'ERR_UNTERMINATED';
    }
    
    return diagnostic;
}

export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.clear();
        diagnosticCollection.dispose();
    }
}
