/* Pretty-printing and syntax highlighting for HTML, XML, JavaScript and CSS responses.
 * Dependency-free. Highlighters return HTML strings with escaped content.
 * Browser: window.CodeFormatters. Node: module.exports. */
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;

  // ---------- language detection ----------

  function detectLanguage(mime, url, text) {
    const m = String(mime || '').toLowerCase().split(';')[0].trim();
    let path = '';
    try { path = new URL(url).pathname.toLowerCase(); } catch (e) { path = String(url || '').toLowerCase(); }
    if (/json/.test(m)) return 'json';
    if (/svg/.test(m) || /\.svg$/.test(path)) return 'xml';
    if (/html/.test(m)) return 'html';
    if (/xml/.test(m)) return 'xml';
    if (/javascript|ecmascript|jscript/.test(m) || /\.[mc]?js$/.test(path)) return 'js';
    if (/css/.test(m) || /\.css$/.test(path)) return 'css';
    const head = String(text || '').slice(0, 300).trimStart();
    if (/^<!doctype html|^<html[\s>]/i.test(head)) return 'html';
    if (/^<\?xml/.test(head)) return 'xml';
    return 'text';
  }

  // A file whose lines are already short is left as written; minified files get reformatted.
  function looksMinified(text) {
    const lines = text.split('\n');
    const longest = lines.reduce((a, l) => Math.max(a, l.length), 0);
    return longest > 300 || (lines.length < 3 && text.length > 200);
  }

  // ---------- JavaScript ----------

  const JS_KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends finally for ' +
    'function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set').split(' '));
  const JS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
  // Keywords after which a "/" starts a regex rather than a division.
  const REGEX_AFTER_KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
  const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
    '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];

  function tokenizeJs(src) {
    const toks = [];
    let i = 0;
    let nl = false;
    const n = src.length;
    const prevSig = () => toks[toks.length - 1];
    const regexAllowed = () => {
      const p = prevSig();
      if (!p) return true;
      if (p.type === 'num' || p.type === 'str' || p.type === 'tpl' || p.type === 'regex') return false;
      if (p.type === 'ident') return JS_KEYWORDS.has(p.value) ? REGEX_AFTER_KW.has(p.value) : false;
      return !(p.value === ')' || p.value === ']' || p.value === '}');
    };
    const push = (type, value) => { toks.push({ type, value, nl }); nl = false; };

    while (i < n) {
      const c = src[i];
      if (c === '\n') { nl = true; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { i++; continue; }
      if (c === '/' && src[i + 1] === '/') {
        let j = src.indexOf('\n', i);
        if (j < 0) j = n;
        push('comment', src.slice(i, j)); i = j; continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        let j = src.indexOf('*/', i + 2);
        j = j < 0 ? n : j + 2;
        push('comment', src.slice(i, j)); i = j; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        j = Math.min(n, j + 1);
        push('str', src.slice(i, j)); i = j; continue;
      }
      if (c === '`') {
        // Template literal, including nested ${ ... } expressions.
        let j = i + 1;
        let depth = 0;
        while (j < n) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (depth === 0 && d === '`') { j++; break; }
          if (d === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
          if (depth > 0 && d === '{') depth++;
          else if (depth > 0 && d === '}') depth--;
          j++;
        }
        push('tpl', src.slice(i, j)); i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^(?:0[xXoObB][0-9a-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/.exec(src.slice(i, i + 64));
        const v = m ? m[0] : c;
        push('num', v); i += v.length; continue;
      }
      if (/[A-Za-z_$\u0080-￿]/.test(c) || c === '#') {
        let j = i + 1;
        while (j < n && /[\w$\u0080-￿]/.test(src[j])) j++;
        push('ident', src.slice(i, j)); i = j; continue;
      }
      if (c === '/' && regexAllowed()) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== '\n') {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) break;
          j++;
        }
        if (src[j] === '/') {
          j++;
          while (j < n && /[a-z]/i.test(src[j])) j++;
          push('regex', src.slice(i, j)); i = j; continue;
        }
      }
      const p = PUNCT.find((op) => src.startsWith(op, i));
      const v = p || c;
      push('punct', v); i += v.length;
    }
    return toks;
  }

  const BINARY_OPS = new Set(['=', '==', '===', '!=', '!==', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', '**', '&&', '||', '??',
    '&', '|', '^', '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=', '>>>=', '&&=', '||=', '??=', '=>', '?', ':']);
  const SPACE_AFTER_KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
    'void', 'throw', 'case', 'else', 'do', 'try', 'finally', 'var', 'let', 'const', 'function', 'class', 'extends', 'export', 'import',
    'from', 'yield', 'await', 'async', 'static']);

  // Deeper nesting (often unclosed tags) is not indented further, so output size stays proportional to input.
  const MAX_DEPTH = 40;

  // Output buffer for the formatters. Appends to an array and only ever inspects its tail, so formatting stays
  // linear in the input size (scanning the whole output string on every token made large bundles take minutes).
  function makeOut(indentUnit) {
    const parts = [];
    const o = {
      level: 0,
      lineStart: true,
      raw(s) { if (s) parts.push(s); },
      write(s) {
        if (o.lineStart) { if (o.level > 0) parts.push(indentUnit.repeat(Math.min(MAX_DEPTH, o.level))); o.lineStart = false; }
        if (s) parts.push(s);
      },
      trimSpaces() {
        while (parts.length) {
          const i = parts.length - 1;
          const t = parts[i].replace(/[ \t]+$/, '');
          if (t === parts[i]) return;
          if (t) { parts[i] = t; return; }
          parts.pop();
        }
      },
      last() { const p = parts[parts.length - 1]; return p ? p[p.length - 1] : ''; },
      newline() { o.trimSpaces(); parts.push('\n'); o.lineStart = true; },
      currentLine() {
        let line = '';
        for (let i = parts.length - 1; i >= 0 && line.length < 4000; i--) {
          const j = parts[i].lastIndexOf('\n');
          if (j >= 0) return parts[i].slice(j + 1) + line;
          line = parts[i] + line;
        }
        return line;
      },
      toString() { return parts.join(''); },
    };
    return o;
  }

  function formatJs(src, indentUnit = '  ') {
    if (!looksMinified(src)) return src;
    const toks = tokenizeJs(src);
    const o = makeOut(indentUnit);
    const stack = []; // open brackets: '{' '(' '['
    const newline = () => o.newline();
    const write = (s) => o.write(s);
    const space = () => { if (!o.lineStart) { const c = o.last(); if (c && c !== ' ' && c !== '\n') o.raw(' '); } };
    const inParens = () => stack[stack.length - 1] === '(';
    const isValue = (t) => t && (t.type === 'ident' || t.type === 'num' || t.type === 'str' || t.type === 'tpl' || t.type === 'regex' ||
      t.value === ')' || t.value === ']' || t.value === '}');
    // Ternary "?" increments, ":" decrements; lets us tell a ternary ":" from an object-literal ":".
    const ternary = [];

    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      const prev = toks[k - 1];
      const next = toks[k + 1];
      if (t.nl && k > 0 && !o.lineStart && !inParens() && stack[stack.length - 1] !== '[') newline();

      if (t.type === 'comment') {
        if (!o.lineStart) space();
        write(t.value);
        if (t.value.startsWith('//') || t.nl || (next && next.nl)) newline();
        continue;
      }
      if (t.type !== 'punct') {
        if (prev && (prev.type !== 'punct' || prev.value === ')' && t.type === 'ident') && !o.lineStart) space();
        write(t.value);
        if (t.type === 'ident' && SPACE_AFTER_KW.has(t.value) && next && next.type === 'punct' && (next.value === '(' || next.value === '{')) o.raw(' ');
        continue;
      }
      const v = t.value;
      switch (v) {
        case '{': {
          if (prev && (prev.value === ')' || prev.type === 'ident' || prev.value === '=>')) space();
          write('{');
          stack.push('{');
          ternary.push(0);
          if (next && next.value === '}') break;
          o.level++;
          newline();
          break;
        }
        case '}': {
          const empty = prev && prev.value === '{';
          stack.pop();
          ternary.pop();
          if (!empty) { o.level--; if (!o.lineStart) newline(); }
          write('}');
          if (!next) break;
          if (next.value === ')' || next.value === ']' || next.value === ',' || next.value === ';' || next.value === '.' ||
              next.value === '?.' || next.value === '(' || next.value === '`' || next.type === 'tpl') break;
          if (next.type === 'ident' && /^(else|catch|finally|while)$/.test(next.value)) { o.raw(' '); break; }
          if (inParens() || stack[stack.length - 1] === '[') break;
          newline();
          break;
        }
        case '(': case '[':
          if (prev && prev.type === 'ident' && SPACE_AFTER_KW.has(prev.value) && v === '(') space();
          write(v); stack.push(v); break;
        case ')': case ']':
          stack.pop(); write(v); break;
        case ';':
          write(';');
          if (inParens()) { if (next && next.value !== ')') o.raw(' '); } else if (next && next.value !== '}') newline();
          break;
        case ',':
          write(',');
          if (stack[stack.length - 1] === '{' && !inParens()) newline(); else o.raw(' ');
          break;
        case '.': case '?.':
          write(v); break;
        case '!': case '~': case '...':
          if (prev && isValue(prev) && !o.lineStart) space();
          write(v); break;
        case '++': case '--':
          write(v); break;
        case ':': {
          const top = ternary.length - 1;
          if (top >= 0 && ternary[top] > 0) { ternary[top]--; space(); write(':'); o.raw(' '); } else { write(':'); o.raw(' '); }
          break;
        }
        case '?':
          if (ternary.length) ternary[ternary.length - 1]++; else ternary.push(1);
          space(); write('?'); o.raw(' ');
          break;
        default:
          if ((v === '+' || v === '-') && !isValue(prev)) { if (prev && !o.lineStart && !(o.last() === '(' || o.last() === '[')) space(); write(v); break; }
          if (BINARY_OPS.has(v)) { space(); write(v); o.raw(' '); break; }
          write(v);
      }
    }
    return o.toString().replace(/[ \t]+$/gm, '').trimEnd() + '\n';
  }

  function highlightJs(src) {
    const toks = tokenizeJs(src);
    let html = '';
    let pos = 0;
    // Re-walk the source so whitespace and line breaks are kept exactly.
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      const at = src.indexOf(t.value, pos);
      if (at < 0) break;
      html += esc(src.slice(pos, at));
      const prev = toks[k - 1];
      const next = toks[k + 1];
      let cls = null;
      if (t.type === 'comment') cls = 'tk-comment';
      else if (t.type === 'str' || t.type === 'tpl') cls = 'tk-str';
      else if (t.type === 'regex') cls = 'tk-var';
      else if (t.type === 'num') cls = 'tk-num';
      else if (t.type === 'ident') {
        if (prev && (prev.value === '.' || prev.value === '?.')) cls = next && next.value === '(' ? 'tk-attr' : null;
        else if (JS_LITERALS.has(t.value)) cls = 'tk-null';
        else if (JS_KEYWORDS.has(t.value)) cls = 'tk-kw';
        else if (next && next.value === '(') cls = 'tk-attr';
        else if (/^[A-Z]/.test(t.value)) cls = 'tk-type';
        else if (next && next.value === ':' && prev && (prev.value === '{' || prev.value === ',')) cls = 'tk-key';
      }
      html += cls ? span(cls, t.value) : esc(t.value);
      pos = at + t.value.length;
    }
    return html + esc(src.slice(pos));
  }

  // ---------- CSS ----------

  function tokenizeCss(src) {
    const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|([{};,()])|(\s+)|([^{};,()"'\s/]+|\/)/g;
    const toks = [];
    let m;
    while ((m = re.exec(src))) {
      if (m[1]) toks.push({ type: 'comment', value: m[1] });
      else if (m[2]) toks.push({ type: 'str', value: m[2] });
      else if (m[3]) toks.push({ type: 'punct', value: m[3] });
      else if (m[4]) toks.push({ type: 'ws', value: m[4] });
      else toks.push({ type: 'word', value: m[5] });
    }
    return toks;
  }

  function formatCss(src, indentUnit = '  ') {
    if (!looksMinified(src)) return src;
    const toks = tokenizeCss(src);
    const o = makeOut(indentUnit);
    let parens = 0;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'ws') { if (!o.lineStart && o.last() !== ' ') o.raw(' '); continue; }
      if (t.type === 'comment') { o.write(t.value); o.newline(); continue; }
      if (t.type === 'punct' && parens === 0) {
        if (t.value === '{') { o.trimSpaces(); o.write(' {'); o.level++; o.newline(); continue; }
        if (t.value === '}') {
          o.level = Math.max(0, o.level - 1);
          if (!o.lineStart) { o.trimSpaces(); if (o.last() !== ';') o.raw(';'); o.newline(); }
          o.write('}'); o.newline();
          if (o.level === 0) o.raw('\n');
          continue;
        }
        if (t.value === ';') { o.trimSpaces(); o.write(';'); o.newline(); continue; }
        if (t.value === ',') {
          o.trimSpaces(); o.write(',');
          // Selector lists break after each comma; commas inside a declaration value stay inline.
          if (o.level === 0 || !o.currentLine().includes(':')) o.newline(); else o.raw(' ');
          continue;
        }
      }
      if (t.value === '(') parens++;
      if (t.value === ')') parens = Math.max(0, parens - 1);
      // "color:red" → "color: red" for declarations.
      if (t.type === 'word' && o.level > 0 && parens === 0 && /^[-\w]+:[^:]/.test(t.value) && !/^\w+:\/\//.test(t.value)) {
        o.write(t.value.replace(/^([-\w]+):/, '$1: '));
        continue;
      }
      o.write(t.value);
    }
    return o.toString().replace(/\s*!important/g, ' !important').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').trim() + '\n';
  }

  function highlightCss(src) {
    let html = '';
    let depth = 0;
    let inValue = false;
    let parens = 0;
    // Selector context: outside braces, or inside an at-rule block that contains rules.
    const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|([{};:()])|(\s+)|([^{};:()"'\s/]+|\/)/g;
    const blockHasRules = []; // per depth: true when the block is an at-rule wrapper (e.g. @media)
    let lastAt = false;
    let m;
    while ((m = re.exec(src))) {
      const [tok, comment, str, punct, ws, word] = m;
      if (comment) { html += span('tk-comment', comment); continue; }
      if (str) { html += span('tk-str', str); continue; }
      if (ws) { html += esc(ws); continue; }
      if (punct) {
        if (punct === '{') { depth++; blockHasRules[depth] = lastAt; lastAt = false; inValue = false; }
        else if (punct === '}') { depth = Math.max(0, depth - 1); inValue = false; }
        else if (punct === ';') { inValue = false; lastAt = false; }
        else if (punct === '(') parens++;
        else if (punct === ')') parens = Math.max(0, parens - 1);
        else if (punct === ':' && depth > 0 && !blockHasRules[depth] && parens === 0) inValue = true;
        html += esc(punct);
        continue;
      }
      const selectorCtx = depth === 0 || blockHasRules[depth];
      let cls;
      if (word.startsWith('@')) { cls = 'tk-kw'; lastAt = true; }
      else if (selectorCtx) cls = lastAt ? null : 'tk-type';
      else if (!inValue) cls = 'tk-attr';
      else if (/^#[0-9a-f]{3,8}$/i.test(word) || /^-?[\d.]+[a-z%]*$/i.test(word)) cls = 'tk-num';
      else if (word === '!important') cls = 'tk-kw';
      else cls = 'tk-str';
      if (selectorCtx && !lastAt && /^[\w-]+:/.test(word) === false && parens > 0) cls = null;
      html += cls ? span(cls, word) : esc(word);
    }
    return html;
  }

  // ---------- HTML / XML ----------

  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr', 'keygen', 'command']);
  const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'pre', 'xmp', 'plaintext']);

  // Splits markup into tags, comments, doctype/PI, CDATA and text; raw-text element bodies stay whole.
  function tokenizeMarkup(src, { html = true } = {}) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      if (src[i] === '<') {
        if (src.startsWith('<!--', i)) {
          let j = src.indexOf('-->', i + 4); j = j < 0 ? n : j + 3;
          toks.push({ type: 'comment', value: src.slice(i, j) }); i = j; continue;
        }
        if (src.startsWith('<![CDATA[', i)) {
          let j = src.indexOf(']]>', i); j = j < 0 ? n : j + 3;
          toks.push({ type: 'cdata', value: src.slice(i, j) }); i = j; continue;
        }
        if (src[i + 1] === '!' || src[i + 1] === '?') {
          let j = src.indexOf('>', i); j = j < 0 ? n : j + 1;
          toks.push({ type: 'decl', value: src.slice(i, j) }); i = j; continue;
        }
        const m = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(src.slice(i, i + 200));
        if (m) {
          // Find the closing ">" while skipping quoted attribute values.
          let j = i + m[0].length;
          let q = null;
          while (j < n) {
            const c = src[j];
            if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
            j++;
          }
          j = Math.min(n, j + 1);
          const raw = src.slice(i, j);
          const name = html ? m[2].toLowerCase() : m[2];
          const closing = !!m[1];
          const selfClosing = /\/>$/.test(raw) || (html && VOID.has(name));
          toks.push({ type: closing ? 'close' : 'open', name, value: raw, selfClosing });
          i = j;
          if (!closing && !selfClosing && html && RAW_TEXT.has(name)) {
            const endRe = new RegExp(`</${name}\\s*>`, 'i');
            const rest = src.slice(i);
            const em = endRe.exec(rest);
            const end = em ? i + em.index : n;
            if (end > i) toks.push({ type: 'raw', name, value: src.slice(i, end) });
            i = end;
          }
          continue;
        }
      }
      let j = src.indexOf('<', i + 1);
      if (j < 0) j = n;
      toks.push({ type: 'text', value: src.slice(i, j) });
      i = j;
    }
    return toks;
  }

  function indentBlock(text, prefix) {
    return text.split('\n').map((l) => (l.trim() ? prefix + l : '')).join('\n');
  }

  function dedent(text) {
    const lines = text.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
    const min = lines.filter((l) => l.trim()).reduce((a, l) => Math.min(a, l.match(/^[ \t]*/)[0].length), Infinity);
    return lines.map((l) => l.slice(Number.isFinite(min) ? min : 0)).join('\n');
  }

  function formatMarkup(src, { html = true, indentUnit = '  ' } = {}) {
    const toks = tokenizeMarkup(src, { html });
    const lines = [];
    let level = 0;
    const pad = () => indentUnit.repeat(Math.min(MAX_DEPTH, Math.max(0, level)));
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'text') {
        const s = t.value.replace(/\s+/g, ' ').trim();
        if (s) lines.push(pad() + s);
        continue;
      }
      if (t.type === 'open' && !t.selfClosing && !(html && (t.name === 'pre' || t.name === 'textarea'))) {
        // Short elements whose content is only text and inline tags stay on one line.
        let depth = 0;
        let len = 0;
        let end = -1;
        for (let j = k; j < toks.length && len <= 100; j++) {
          const u = toks[j];
          if (u.type === 'raw' || u.type === 'comment' || u.type === 'cdata' || u.type === 'decl' || (u.type === 'text' && u.value.trim().includes('\n'))) break;
          len += u.type === 'text' ? u.value.replace(/\s+/g, ' ').length : u.value.length;
          if (u.type === 'open' && !u.selfClosing) depth++;
          else if (u.type === 'close') { depth--; if (depth === 0) { end = j; break; } }
        }
        if (end > k + 1 && len <= 100) {
          const inner = toks.slice(k, end + 1).map((u) => (u.type === 'text' ? u.value.replace(/\s+/g, ' ') : u.value)).join('');
          lines.push(pad() + inner.replace(/^(<[^>]*>)\s+/, '$1').replace(/\s+(<\/[^>]*>)$/, '$1'));
          k = end;
          continue;
        }
      }
      if (t.type === 'open' && !t.selfClosing) {
        // <tag>short text</tag> stays on one line.
        const a = toks[k + 1];
        const b = toks[k + 2];
        // <pre> and <textarea> content is whitespace-sensitive: keep it verbatim.
        if ((t.name === 'pre' || t.name === 'textarea') && html) {
          const body = a && a.type === 'raw' ? a.value : '';
          const close = toks[k + (body ? 2 : 1)];
          const end = close && close.type === 'close' && close.name === t.name ? close.value : '';
          lines.push(pad() + t.value + body + end);
          k += (body ? 1 : 0) + (end ? 1 : 0);
          continue;
        }
        if (a && b && (a.type === 'text' || a.type === 'raw') && b.type === 'close' && b.name === t.name &&
            !a.value.includes('\n') && a.value.trim().length <= 120) {
          lines.push(pad() + t.value + a.value.trim() + b.value); k += 2; continue;
        }
        if (a && a.type === 'close' && a.name === t.name) { lines.push(pad() + t.value + a.value); k += 1; continue; }
        lines.push(pad() + t.value);
        level++;
        continue;
      }
      if (t.type === 'close') { level--; lines.push(pad() + t.value); continue; }
      if (t.type === 'raw') {
        let body = t.value;
        if (t.name === 'pre' || t.name === 'textarea') { lines.push(body); continue; }
        const typeAttr = (toks[k - 1] && /type\s*=\s*["']?([^"'\s>]+)/i.exec(toks[k - 1].value) || [])[1] || '';
        // Inline JavaScript is kept as written, like JS responses; JSON data blocks and styles are formatted.
        if (t.name === 'script' && /json/i.test(typeAttr)) { try { body = JSON.stringify(JSON.parse(body), null, 2); } catch (e) { /* keep */ } }
        else if (t.name === 'style') body = formatCss(body);
        const d = dedent(body);
        if (d.trim()) lines.push(indentBlock(d, pad()));
        continue;
      }
      // comments, doctype, CDATA, void/self-closing tags
      lines.push(pad() + t.value.trim());
    }
    return lines.join('\n') + '\n';
  }

  function highlightTag(raw) {
    const m = /^(<\/?)([^\s/>]+)([\s\S]*?)(\/?>)?$/.exec(raw);
    if (!m) return esc(raw);
    const [, open, name, attrs, close] = m;
    let html = span('tk-kw', open + name);
    const re = /([^\s=/>"']+)(\s*=\s*)?("[^"]*"?|'[^']*'?|[^\s>"']+)?|(\s+|[\s\S])/g;
    let a;
    while ((a = re.exec(attrs))) {
      const [, attr, eq, val, other] = a;
      if (other !== undefined) { html += esc(other); continue; }
      html += span('tk-attr', attr);
      if (eq) html += esc(eq);
      if (val) html += span('tk-str', val);
    }
    return html + (close ? span('tk-kw', close) : '');
  }

  function highlightMarkup(src, { html = true } = {}) {
    const toks = tokenizeMarkup(src, { html });
    let out = '';
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'comment') out += span('tk-comment', t.value);
      else if (t.type === 'decl' || t.type === 'cdata') out += span('tk-dir', t.value);
      else if (t.type === 'open' || t.type === 'close') out += highlightTag(t.value);
      else if (t.type === 'raw') {
        const typeAttr = (toks[k - 1] && /type\s*=\s*["']?([^"'\s>]+)/i.exec(toks[k - 1].value) || [])[1] || '';
        if (t.name === 'script' && (!typeAttr || /javascript|module|ecmascript/i.test(typeAttr))) out += highlightJs(t.value);
        else if (t.name === 'style') out += highlightCss(t.value);
        else out += esc(t.value);
      } else out += esc(t.value);
    }
    return out;
  }

  // ---------- public API ----------

  function format(lang, text) {
    switch (lang) {
      case 'json': try { return JSON.stringify(JSON.parse(text), null, 2); } catch (e) { return text; }
      case 'js': return formatJs(text);
      case 'css': return formatCss(text);
      case 'html': return formatMarkup(text, { html: true });
      case 'xml': return formatMarkup(text, { html: false });
      default: return text;
    }
  }

  function highlight(lang, text) {
    switch (lang) {
      case 'js': return highlightJs(text);
      case 'css': return highlightCss(text);
      case 'html': return highlightMarkup(text, { html: true });
      case 'xml': return highlightMarkup(text, { html: false });
      default: return esc(text);
    }
  }

  const LABELS = { json: 'JSON', js: 'JavaScript', css: 'CSS', html: 'HTML', xml: 'XML', text: 'Text' };

  const api = {
    detectLanguage, looksMinified, format, highlight, LABELS,
    formatJs, formatCss, formatMarkup, highlightJs, highlightCss, highlightMarkup, tokenizeJs, tokenizeMarkup,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CodeFormatters = api;
})(typeof window !== 'undefined' ? window : globalThis);
