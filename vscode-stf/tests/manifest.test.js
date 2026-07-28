// Checks the parts of the extension that only break at install time.
//
// The manifest and the launcher have to agree about names — a command declared but never
// registered, or a setting read under a key the manifest does not declare, fails silently in
// a way no typecheck catches. Everything else the extension does is the server's behaviour,
// which the Rust test suite covers.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

test('every declared command is registered', () => {
    for (const { command } of manifest.contributes.commands) {
        assert.ok(
            source.includes(`'${command}'`),
            `${command} is declared in package.json but never registered`
        );
    }
});

test('every setting the launcher reads is declared', () => {
    const declared = Object.keys(manifest.contributes.configuration.properties);
    // `getConfiguration('stf')` scopes the keys, so `server.path` means `stf.server.path`.
    for (const [, key] of source.matchAll(/configuration\.get<[^>]+>\('([^']+)'/g)) {
        assert.ok(
            declared.includes(`stf.${key}`),
            `stf.${key} is read by the extension but not declared in package.json`
        );
    }
});

test('the language covers both discrete documents and streams', () => {
    const [language] = manifest.contributes.languages;
    assert.deepStrictEqual(language.extensions, ['.stf', '.stfs']);
    assert.strictEqual(language.id, 'stf');
    // The grammar and language configuration must exist, or VS Code disables the extension.
    assert.ok(fs.existsSync(path.join(root, language.configuration)));
    assert.ok(fs.existsSync(path.join(root, manifest.contributes.grammars[0].path)));
});

test('the extension launches the language server rather than validating on its own', () => {
    assert.ok(source.includes("'lsp'"), 'the server is started with the `lsp` subcommand');
    assert.ok(
        !/createDiagnosticCollection|new vscode\.Diagnostic\(/.test(source),
        'diagnostics must come from the server, not from the extension'
    );
    assert.ok(manifest.dependencies['vscode-languageclient']);
});

test('the bundled grammar matches the one in the repository', () => {
    // The extension ships its own copy because a VSIX cannot reference a file outside itself.
    // Two copies drift; this is what notices.
    const bundled = fs.readFileSync(path.join(root, 'syntaxes', 'stf.tmLanguage.json'), 'utf8');
    const canonical = fs.readFileSync(
        path.join(root, '..', 'syntax', 'stf.tmLanguage.json'),
        'utf8'
    );
    assert.strictEqual(bundled, canonical, 'copy syntax/stf.tmLanguage.json into vscode-stf/syntaxes/');

    const grammar = JSON.parse(bundled);
    assert.deepStrictEqual(grammar.fileTypes, ['stf', 'stfs']);
    assert.ok(grammar.repository.directives, 'directives (spec §5.1) must be highlighted');
});

test('the packaged entry point is what the build produces', () => {
    const tsconfig = JSON.parse(
        fs
            .readFileSync(path.join(root, 'tsconfig.json'), 'utf8')
            // The file is JSON with comments in VS Code's tooling; strip them defensively.
            .replace(/^\s*\/\/.*$/gm, '')
    );
    assert.strictEqual(manifest.main, `./${tsconfig.compilerOptions.outDir}/extension.js`);
});
