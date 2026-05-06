import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const tests = JSON.parse(readFileSync('./tests.json', 'utf8'));

function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === 'object') {
        const ka = Object.keys(a).sort();
        const kb = Object.keys(b).sort();
        if (ka.length !== kb.length) return false;
        if (!ka.every((k, i) => k === kb[i])) return false;
        return ka.every(k => deepEqual(a[k], b[k]));
    }
    return false;
}

function findLatestBinary(pattern) {
    try {
        const result = execSync(`find ${pattern} -type f -printf '%T@ %p\\n' 2>/dev/null | sort -n | tail -1`, { encoding: 'utf8' });
        const parts = result.trim().split(' ');
        return parts[1];
    } catch {
        return null;
    }
}

const implementations = {
    zig: {
        run: (input) => {
            const binary = findLatestBinary('/home/G/projects/opentf/DTXT/ref-impl/zig/.zig-cache -name "dtxt-convert"');
            if (!binary || !existsSync(binary)) return { error: 'Binary not found' };
            try {
                const output = execSync(`${binary} -d`, { input, encoding: 'utf8', timeout: 5000 });
                return { output: JSON.parse(output) };
            } catch (e) {
                return { error: e.message };
            }
        }
    },
    python: {
        run: (input) => {
            try {
                const cmd = `cd /home/G/projects/opentf/DTXT/ref-impl/python && python3 -c "
import dtxt, json, sys
data = dtxt.loads(sys.stdin.read())
print(json.dumps(data))
"`;
                const output = execSync(cmd, { input, encoding: 'utf8', timeout: 5000 });
                return { output: JSON.parse(output) };
            } catch (e) {
                return { error: e.message };
            }
        }
    }
};

try {
    const dtxt = await import('../../ref-impl/ts/dtxt.ts');
    implementations.ts = {
        run: (input) => {
            try {
                const result = dtxt.parse(input);
                return { output: result };
            } catch (e) {
                return { error: e.message };
            }
        }
    };
} catch (e) {
    console.log('TS import failed:', e.message);
}

const results = {};

for (const [name, impl] of Object.entries(implementations)) {
    const implResults = { tests: [], summary: { pass: 0, fail: 0, skip: 0 } };
    
    for (const test of tests) {
        const result = { name: test.name, status: 'fail' };
        
        try {
            const output = impl.run(test.input);
            
            if (test.expected !== undefined) {
                if (output.error) {
                    result.status = 'fail';
                    result.error = output.error;
                } else if (deepEqual(output.output, test.expected)) {
                    result.status = 'pass';
                    implResults.summary.pass++;
                } else {
                    result.status = 'fail';
                    result.detail = { expected: test.expected, actual: output.output };
                }
            } else if (test.error !== undefined) {
                if (output.error) {
                    result.status = 'pass';
                    implResults.summary.pass++;
                } else {
                    result.status = 'fail';
                    result.detail = { expected_error: test.error, actual: 'no error' };
                }
            }
        } catch (e) {
            result.status = 'fail';
            result.error = e.message;
        }
        
        implResults.tests.push(result);
        if (result.status === 'fail') implResults.summary.fail++;
    }
    
    results[name] = implResults;
    console.log(`${name}: ${implResults.summary.pass} passed, ${implResults.summary.fail} failed`);
}

function toJson(obj) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    , 2);
}

for (const [name, data] of Object.entries(results)) {
    writeFileSync(`./results_${name}.json`, toJson(data));
}

console.log('\nSummary:');
console.log('┌──────────┬───────┬──────┬───────┐');
console.log('│ Impl     │ Pass  │ Fail │ Total │');
console.log('├──────────┼───────┼──────┼───────┤');
for (const [name, data] of Object.entries(results)) {
    const total = data.summary.pass + data.summary.fail;
    console.log(`│ ${name.padEnd(8)} │ ${String(data.summary.pass).padStart(5)} │ ${String(data.summary.fail).padStart(4)} │ ${String(total).padStart(5)} │`);
}
console.log('└──────────┴───────┴──────┴───────┘');
