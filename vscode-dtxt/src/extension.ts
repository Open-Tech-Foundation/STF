import * as vscode from 'vscode';
import * as path from 'path';

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    console.log('DTXT extension activated');

    // Create diagnostic collection for DTXT errors
    diagnosticCollection = vscode.languages.createDiagnosticCollection('dtxt');
    context.subscriptions.push(diagnosticCollection);

    // Validate document function
    const validateDocument = async (document: vscode.TextDocument) => {
        if (document.languageId === 'dtxt') {
            await validateDTXT(document);
        }
    };

    // Validate on document open
    vscode.workspace.onDidOpenTextDocument(validateDocument, null, context.subscriptions);

    // Validate on document change (with debounce)
    let timeout: NodeJS.Timeout | undefined;
    vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === 'dtxt') {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(() => {
                validateDocument(event.document);
            }, 500);
        }
    }, null, context.subscriptions);

    // Validate on save
    vscode.workspace.onDidSaveTextDocument(validateDocument, null, context.subscriptions);

    // Validate all open DTXT documents on activation
    vscode.workspace.textDocuments.forEach(doc => {
        if (doc.languageId === 'dtxt') {
            validateDocument(doc);
        }
    });

    // Register command to manually validate
    const validateCommand = vscode.commands.registerCommand('dtxt.validate', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'dtxt') {
            validateDocument(editor.document);
            vscode.window.showInformationMessage('DTXT validation complete');
        }
    });
    context.subscriptions.push(validateCommand);
}

async function validateDTXT(document: vscode.TextDocument): Promise<void> {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    
    try {
        // Use basic DTXT validation
        const errors = validateDTXTSyntax(text);
        
        for (const error of errors) {
            const diagnostic = createDiagnostic(document, error);
            if (diagnostic) {
                diagnostics.push(diagnostic);
            }
        }
    } catch (e: any) {
        // If validation fails entirely, show a generic error
        const range = new vscode.Range(0, 0, 0, 1);
        const diagnostic = new vscode.Diagnostic(
            range,
            `DTXT Validation Error: ${e.message || e}`,
            vscode.DiagnosticSeverity.Error
        );
        diagnostics.push(diagnostic);
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

interface DTXTError {
    message: string;
    line: number;
    column?: number;
    severity?: 'error' | 'warning';
}

function validateDTXTSyntax(text: string): DTXTError[] {
    const errors: DTXTError[] = [];
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
            
            // Skip comments
            if (inComment) continue;
            if (ch === '#') {
                inComment = true;
                continue;
            }
            
            // Handle strings
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
            
            // Track depth
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
    
    // Check for unterminated strings
    if (inString) {
        errors.push({
            message: 'ERR_UNTERMINATED: Unterminated string literal',
            line: lines.length - 1,
            severity: 'error'
        });
    }
    
    // Check for unbalanced brackets
    if (depth > 0) {
        errors.push({
            message: 'ERR_UNTERMINATED: Unbalanced brackets',
            line: lines.length - 1,
            severity: 'error'
        });
    }
    
    // Check for missing colons after keys (basic heuristic)
    const keyPattern = /^\s*[a-zA-Z_][a-zA-Z0-9_-]*\s*$/;
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const trimmed = lines[lineNum].trim();
        if (trimmed.length > 0 && 
            !trimmed.startsWith('#') && 
            !trimmed.includes(':') &&
            !trimmed.includes('{') &&
            !trimmed.includes('}') &&
            !trimmed.includes('[') &&
            !trimmed.includes(']') &&
            !trimmed.startsWith('`') &&
            keyPattern.test(trimmed)) {
            
            // Check if next non-empty line has a colon
            for (let j = lineNum + 1; j < lines.length; j++) {
                const next = lines[j].trim();
                if (next.length > 0 && !next.startsWith('#')) {
                    if (!next.includes(':')) {
                        errors.push({
                            message: 'ERR_MISSING_COLON: Missing colon after key',
                            line: lineNum,
                            severity: 'error'
                        });
                    }
                    break;
                }
            }
        }
    }
    
    return errors;
}

function createDiagnostic(document: vscode.TextDocument, error: DTXTError): vscode.Diagnostic | null {
    const line = error.line !== undefined ? error.line : 0;
    const column = error.column !== undefined ? error.column : 0;
    
    // Ensure line is within document bounds
    if (line >= document.lineCount) {
        return null;
    }
    
    const lineText = document.lineAt(line);
    const startCol = column < lineText.text.length ? column : 0;
    const endCol = lineText.text.length;
    
    const range = new vscode.Range(line, startCol, line, endCol);
    
    // Determine severity
    let severity = vscode.DiagnosticSeverity.Error;
    if (error.severity === 'warning') {
        severity = vscode.DiagnosticSeverity.Warning;
    }
    
    const diagnostic = new vscode.Diagnostic(
        range,
        error.message,
        severity
    );
    
    diagnostic.source = 'dtxt';
    
    // Map error codes
    if (error.message.includes('ERR_SYNTAX')) {
        diagnostic.code = 'ERR_SYNTAX';
    } else if (error.message.includes('ERR_UNTERMINATED')) {
        diagnostic.code = 'ERR_UNTERMINATED';
    } else if (error.message.includes('ERR_MISSING_COLON')) {
        diagnostic.code = 'ERR_MISSING_COLON';
    }
    
    return diagnostic;
}

export function deactivate() {
    if (diagnosticCollection) {
        diagnosticCollection.clear();
        diagnosticCollection.dispose();
    }
}
