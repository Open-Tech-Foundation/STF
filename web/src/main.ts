import './style.css';
import { parse, stringify, format } from '../../ref-impl/js/stf.ts';

import jsyaml from 'js-yaml';
import JSON5 from 'json5';
import * as TOML from 'smol-toml';
import * as fxp from 'fast-xml-parser';
import { encode as msgpackEncode } from '@msgpack/msgpack';
import * as CBOR from 'cbor-js';

const SAMPLES = {
  welcome: `{
  title: \`Welcome to STF\`,
  version: 1.0,
  features: [
    \`Predictable\`,
    \`High Performance\`,
    \`Zero Overhead\`,
  ],
  metrics: {
    latency: 0.12,
    isActive: T,
  },
  timestamp: DATE(2026-01-24),
}`,
  users: `{
  users: [
    {
      id: BIGINT(10029384756201928374),
      name: \`Alice\`,
      email: \`alice@example.com\`,
      roles: [\`admin\`, \`dev\`],
      lastLogin: TIMESTAMP(2026-01-23T14:20:00Z),
    },
    {
      id: BIGINT(10029384756201928375),
      name: \`Bob\`,
      email: \`bob@example.com\`,
      avatar: BINARY(SGVsbG8=),
      isActive: F,
    },
  ],
}`,
  complex: `{
  config: {
    debug: T,
    max_retries: 3,
    timeout: 1.5e3,
    price: DECIMAL(19.99),
  },
  data: [
    N,
    123,
    -45.6,
    \`multi-line
string\`,
  ],
  metadata: {
    hash: BINARY(SGVsbG8=),
    tags: [],
  },
}`
};

const FORMATS = [
  { id: 'json', name: 'JSON', ext: '.json', bidirectional: true },
  { id: 'json5', name: 'JSON5', ext: '.json5', bidirectional: true },
  { id: 'yaml', name: 'YAML', ext: '.yaml', bidirectional: true },
  { id: 'toml', name: 'TOML', ext: '.toml', bidirectional: true },
  { id: 'xml', name: 'XML', ext: '.xml', bidirectional: true },
  { id: 'minified', name: 'Minified STF', ext: '.stf', bidirectional: true },
  { id: 'msgpack', name: 'MsgPack (Hex)', ext: '.msgpack', bidirectional: false },
  { id: 'cbor', name: 'CBOR (Hex)', ext: '.cbor', bidirectional: false },
];

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="container">
    <header>
      <h1>STF Playground</h1>
      <p class="subtitle">Experience the future of predictable, high-performance data interchange. Edit STF on the left, see results on the right.</p>
    </header>

    <main class="playground">
      <div class="editor-pane">
        <div class="pane-header">
          <div class="header-left">
            <span class="label">STF Input</span>
            <select id="sample-select">
              <option value="welcome">Welcome</option>
              <option value="users">User Profile</option>
              <option value="complex">Complex Types</option>
            </select>
          </div>
          <button id="format-btn" class="action-btn">Format</button>
        </div>
        <textarea id="dtxt-input" spellcheck="false">${SAMPLES.welcome}</textarea>
      </div>

      <div class="editor-pane">
        <div class="pane-header">
          <div class="header-left">
            <span class="label">Output</span>
            <select id="format-select">
              ${FORMATS.map(f => `<option value="${f.id}">${f.name}</option>`).join('')}
            </select>
          </div>
          <span class="ext" id="output-ext">.json</span>
        </div>
        <textarea id="output-view" class="output-viewer" spellcheck="false"></textarea>
      </div>
    </main>

    <div class="stats-container">
      <div class="stat-card">
        <div class="stat-value" id="dtxt-size">0 B</div>
        <div class="stat-label">STF Payload</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="target-size">0 B</div>
        <div class="stat-label" id="target-label">JSON Equivalent</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="reduction-pct">0%</div>
        <div class="stat-label">Space Reduction</div>
      </div>
    </div>

    <footer>
      Created by the <a href="https://github.com/Open-Tech-Foundation">Open Tech Foundation</a>. 
      Read the <a href="https://github.com/Open-Tech-Foundation/dtxt/blob/main/doc/spec.md">Spec</a>.
    </footer>
  </div>
`;

const dtxtInput = document.querySelector<HTMLTextAreaElement>('#dtxt-input')!;
const formatBtn = document.querySelector<HTMLButtonElement>('#format-btn')!;
const outputView = document.querySelector<HTMLTextAreaElement>('#output-view')!;
const sampleSelect = document.querySelector<HTMLSelectElement>('#sample-select')!;
const formatSelect = document.querySelector<HTMLSelectElement>('#format-select')!;
const outputExt = document.querySelector<HTMLSpanElement>('#output-ext')!;

const dtxtSizeEl = document.querySelector<HTMLDivElement>('#dtxt-size')!;
const targetSizeEl = document.querySelector<HTMLDivElement>('#target-size')!;
const targetLabelEl = document.querySelector<HTMLDivElement>('#target-label')!;
const reductionEl = document.querySelector<HTMLDivElement>('#reduction-pct')!;

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(2) + ' KB';
}

function updateStats(stfText: string, targetText: string, formatName: string) {
  const stfBytes = new TextEncoder().encode(stfText).length;
  let targetBytes: number;
  const currentFormat = formatSelect.value;
  if (currentFormat === 'msgpack' || currentFormat === 'cbor') {
    targetBytes = targetText.replace(/[^0-9A-F]/gi, '').length / 2;
  } else {
    targetBytes = new TextEncoder().encode(targetText).length;
  }

  const reduction = targetBytes > 0 ? ((targetBytes - stfBytes) / targetBytes * 100).toFixed(1) : '0.0';

  dtxtSizeEl.textContent = formatBytes(stfBytes);
  targetSizeEl.textContent = formatBytes(targetBytes);
  targetLabelEl.textContent = `${formatName} Equivalent`;
  reductionEl.textContent = reduction + '%';

  reductionEl.style.color = parseFloat(reduction) > 0 ? 'var(--accent-color)' : '#ff4d4d';
}

function prepareForSerialization(v: any): any {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) {
    return Array.from(v).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
  }
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(prepareForSerialization);
  if (v !== null && typeof v === 'object') {
    const res: any = {};
    for (const k in v) res[k] = prepareForSerialization(v[k]);
    return res;
  }
  return v;
}

const Handlers: Record<string, { serialize: (obj: any) => string, parse?: (text: string) => any }> = {
  json: {
    serialize: (obj) => JSON.stringify(prepareForSerialization(obj), null, 2),
    parse: (text) => JSON.parse(text)
  },
  json5: {
    serialize: (obj) => {
      return JSON5.stringify(prepareForSerialization(obj), null, 2);
    },
    parse: (text) => JSON5.parse(text)
  },
  yaml: {
    serialize: (obj) => {
      return jsyaml.dump(prepareForSerialization(obj), { indent: 2, lineWidth: -1 });
    },
    parse: (text) => jsyaml.load(text)
  },
  toml: {
    serialize: (obj) => {
      try {
        return TOML.stringify(prepareForSerialization(obj) as any);
      } catch (e: any) {
        return `# Error: ${e.message}\n` + JSON.stringify(prepareForSerialization(obj), null, 2);
      }
    },
    parse: (text) => TOML.parse(text)
  },
  xml: {
    serialize: (obj) => {
      const builder = new fxp.XMLBuilder({ format: true, ignoreAttributes: false });
      return builder.build({ root: prepareForSerialization(obj) });
    },
    parse: (text) => {
      const parser = new fxp.XMLParser();
      const res = parser.parse(text);
      return res.root || res;
    }
  },
  minified: {
    serialize: (obj) => stringify(obj, null),
    parse: (text) => parse(text)
  },
  msgpack: {
    serialize: (obj) => {
      const uint8 = msgpackEncode(prepareForSerialization(obj));
      return Array.from(uint8).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }
  },
  cbor: {
    serialize: (obj) => {
      const buffer = CBOR.encode(prepareForSerialization(obj));
      return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    }
  }
};

function updateOutput() {
  const stfText = dtxtInput.value;
  const targetFormatId = formatSelect.value;
  const formatInfo = FORMATS.find(f => f.id === targetFormatId)!;

  try {
    const parsed = parse(stfText);

    outputView.classList.remove('error');

    const handler = Handlers[targetFormatId];
    const outputText = handler ? handler.serialize(parsed) : "Unsupported format";

    outputView.value = outputText;
    outputExt.textContent = formatInfo.ext;

    updateStats(stfText, outputText, formatInfo.name);

  } catch (e: any) {
    outputView.classList.add('error');
  }
}

function updateFromOutput() {
  const outputText = outputView.value;
  const targetFormatId = formatSelect.value;
  const formatInfo = FORMATS.find(f => f.id === targetFormatId)!;

  if (!formatInfo.bidirectional) return;

  try {
    const handler = Handlers[targetFormatId];
    if (!handler || !handler.parse) return;

    const parsed = handler.parse(outputText);
    const stfText = stringify(parsed, '  ');

    dtxtInput.classList.remove('error');
    dtxtInput.value = stfText;

    updateStats(stfText, outputText, formatInfo.name);
  } catch (e: any) {
    dtxtInput.classList.add('error');
  }
}

let isUpdating = false;

dtxtInput.addEventListener('input', () => {
  if (isUpdating) return;
  isUpdating = true;
  updateOutput();
  isUpdating = false;
});

outputView.addEventListener('input', () => {
  if (isUpdating) return;
  if (!FORMATS.find(f => f.id === formatSelect.value)?.bidirectional) return;
  isUpdating = true;
  updateFromOutput();
  isUpdating = false;
});

sampleSelect.addEventListener('change', () => {
  const sampleName = sampleSelect.value as keyof typeof SAMPLES;
  dtxtInput.value = SAMPLES[sampleName];
  updateOutput();
});

formatSelect.addEventListener('change', () => {
  const formatInfo = FORMATS.find(f => f.id === formatSelect.value)!;
  outputView.readOnly = !formatInfo.bidirectional;
  updateOutput();
});

formatBtn.addEventListener('click', () => {
  try {
    const formatted = format(dtxtInput.value);
    dtxtInput.value = formatted;
    updateOutput();
  } catch (e) {
    alert("Cannot format invalid STF code");
  }
});

updateOutput();
