'use strict';

const shellQuote = (f) => `'${f.replace(/'/g, "'\\''")}'`;

// Fills {workdir} {task} {out} in a user's review command as whole shell words. A placeholder the
// user already wrapped in matching quotes counts as the bare placeholder: quoted once, not twice.
const fillReviewCmd = (cmd, slots) => cmd.replace(/(["']?)\{(workdir|task|out)\}\1/g, (_, _q, name) => shellQuote(slots[name]));

module.exports = { shellQuote, fillReviewCmd };
