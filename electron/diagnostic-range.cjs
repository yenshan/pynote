// AI columns count Unicode code points, with a 1-based inclusive end.
function diagnosticRange(lines, diagnostic) {
  const empty = { startColumn:0,endColumn:0,targetText:'' };
  const line = lines[diagnostic.displayLine-1];
  if (typeof line !== 'string' || !diagnostic.targetText || typeof diagnostic.targetText !== 'string') return empty;
  const text = diagnostic.targetText;
  if (/[\r\n]/.test(text) || Array.from(text).some(char => /^[\uD800-\uDFFF]$/.test(char))) return empty;
  const characters = Array.from(line);
  const { startColumn,endColumn } = diagnostic;
  if (Number.isInteger(startColumn) && Number.isInteger(endColumn) && startColumn >= 1 && endColumn >= startColumn && endColumn <= characters.length && characters.slice(startColumn-1,endColumn).join('') === text) {
    return { startColumn,endColumn,targetText:text };
  }
  // A uniquely quoted source fragment can correct a model's counting mistake.
  const index = line.indexOf(text);
  if (index < 0 || line.indexOf(text,index+1) >= 0) return empty;
  const prefix = line.slice(0,index);
  if (Array.from(prefix).some(char => /^[\uD800-\uDFFF]$/.test(char))) return empty;
  const start = Array.from(prefix).length+1;
  return { startColumn:start,endColumn:start+Array.from(text).length-1,targetText:text };
}

module.exports = { diagnosticRange };
