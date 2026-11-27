'use strict';

const { spawnSync } = require('node:child_process');

const shellQuote = (f) => `'${f.replace(/'/g, "'\\''")}'`;

// Fills {workdir} {task} {out} in a user's review command so each reaches it as the exact value,
// wherever the user put it: bare, inside "…" or '…' with other text, or inside $(…). Tracks the
// shell quoting context and closes/reopens the user's quote around a single-quoted value.
function fillReviewCmd(cmd, slots) {
  const stack = ['plain'];
  let out = '';
  for (let i = 0; i < cmd.length; i += 1) {
    const top = stack[stack.length - 1];
    const slot = /^\{(workdir|task|out)\}/.exec(cmd.slice(i));
    if (slot) {
      const v = shellQuote(slots[slot[1]]);
      out += top === 'dq' ? `"${v}"` : top === 'sq' ? `'${v}'` : v;
      i += slot[0].length - 1;
      continue;
    }
    const c = cmd[i];
    out += c;
    if (top === 'sq') {
      if (c === "'") stack.pop();
    } else if (c === '\\') {
      out += cmd[i + 1] || '';
      i += 1;
    } else if (c === '$' && cmd[i + 1] === '(') {
      out += '(';
      i += 1;
      stack.push('sub');
    } else if (top === 'dq') {
      if (c === '"') stack.pop();
    } else if (c === "'") stack.push('sq');
    else if (c === '"') stack.push('dq');
    else if (c === ')' && top === 'sub') stack.pop();
  }
  return out;
}

// The command word the shell runs: past VAR=value prefixes, without its quotes.
const COMMAND_WORD = /^\s*(?:[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S*)\s+)*(?:"([^"]+)"|'([^']+)'|(\S+))/;

function toolExists(root, cmd) {
  const m = cmd.match(COMMAND_WORD);
  const tool = m && (m[1] || m[2] || m[3]);
  if (!tool || tool.includes('$')) return null; // only the shell can resolve it; let the run say
  const r = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null', '_', tool], { cwd: root });
  return r.status === 0 ? null : tool;
}

module.exports = { shellQuote, fillReviewCmd, toolExists };
