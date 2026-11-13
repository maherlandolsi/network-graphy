const test = require('node:test');
const assert = require('node:assert');
const F = require('../lib/formatters.js');

test('detectLanguage uses mime type, extension and content', () => {
  assert.strictEqual(F.detectLanguage('text/html; charset=utf-8', 'https://a.test/'), 'html');
  assert.strictEqual(F.detectLanguage('application/javascript', 'https://a.test/x'), 'js');
  assert.strictEqual(F.detectLanguage('', 'https://a.test/app.mjs'), 'js');
  assert.strictEqual(F.detectLanguage('text/css', ''), 'css');
  assert.strictEqual(F.detectLanguage('image/svg+xml', ''), 'xml');
  assert.strictEqual(F.detectLanguage('application/xml', ''), 'xml');
  assert.strictEqual(F.detectLanguage('text/plain', '', '<!DOCTYPE html><html>'), 'html');
  assert.strictEqual(F.detectLanguage('text/plain', '', 'hello'), 'text');
});

test('formatJs pretty-prints minified code', () => {
  const src = 'function a(b,c){if(b>c){return b-c}else{const x={k:1,z:"s"};for(let i=0;i<3;i++){f(`t${i}`)}return x.k?/ab+c/g.test("abbc"):-1}}'.repeat(4);
  const out = F.formatJs(src);
  assert.match(out, /^function a\(b, c\) \{\n  if \(b > c\) \{\n    return b - c\n  \} else \{/);
  assert.match(out, /for \(let i = 0; i < 3; i\+\+\) \{/);
  assert.match(out, /const x = \{\n      k: 1,\n      z: "s"\n    \};/);
  assert.match(out, /return x\.k \? \/ab\+c\/g\.test\("abbc"\) : -1/);
  assert.match(out, /`t\$\{i\}`/);
});

test('formatJs leaves readable code unchanged', () => {
  const src = 'const a = 1;\nfunction b() {\n  return a;\n}\n';
  assert.strictEqual(F.formatJs(src), src);
});

test('tokenizeJs tells regexes from divisions', () => {
  const types = (s) => F.tokenizeJs(s).map((t) => t.type);
  assert.ok(types('x = a / b / c').every((t) => t !== 'regex'));
  assert.ok(types('return /a\\/b[/]/g.test(s)').includes('regex'));
});

test('formatCss puts one declaration per line', () => {
  const src = 'body{margin:0;color:#333}a:hover,.btn>span{color:red!important;background:url(data:x;y)}@media (max-width:600px){.x{display:none}}'.repeat(2);
  const out = F.formatCss(src);
  assert.match(out, /^body \{\n  margin: 0;\n  color: #333;\n\}/);
  assert.match(out, /a:hover,\n\.btn>span \{/);
  assert.match(out, /color: red !important;/);
  assert.match(out, /url\(data:x;y\)/);
  assert.match(out, /@media \(max-width:600px\) \{\n  \.x \{\n    display: none;\n  \}\n\}/);
});

test('formatMarkup indents HTML, keeps void elements and short text inline', () => {
  const out = F.formatMarkup('<!DOCTYPE html><html><head><title>Hi</title><meta charset="utf-8"></head><body><div class="a"><br><img src="x.png"></div><pre>  keep\n  me</pre></body></html>');
  assert.strictEqual(out.split('\n').slice(0, 8).join('\n'), [
    '<!DOCTYPE html>', '<html>', '  <head>', '    <title>Hi</title>', '    <meta charset="utf-8">', '  </head>', '  <body>', '    <div class="a"><br><img src="x.png"></div>',
  ].join('\n'));
  const long = F.formatMarkup(`<ul><li>${'a'.repeat(80)}</li><li>${'b'.repeat(80)}</li></ul>`);
  assert.match(long, /^<ul>\n {2}<li>a+<\/li>\n {2}<li>b+<\/li>\n<\/ul>/);
  assert.match(F.formatMarkup('<p>Hello <b>world</b>.</p>'), /^<p>Hello <b>world<\/b>\.<\/p>/);
  assert.match(out, /<pre> {2}keep\n {2}me<\/pre>/);
});

test('formatMarkup formats XML with self-closing tags and CDATA', () => {
  const out = F.formatMarkup('<?xml version="1.0"?><root><item id="1">A</item><item/><x><![CDATA[a<b]]></x></root>', { html: false });
  assert.strictEqual(out, '<?xml version="1.0"?>\n<root>\n  <item id="1">A</item>\n  <item/>\n  <x>\n    <![CDATA[a<b]]>\n  </x>\n</root>\n');
});

test('highlighters escape content and mark tokens', () => {
  const html = F.highlight('html', '<a href="x">1 < 2</a><script>if(a<b)alert("<x>")</script>');
  assert.match(html, /<span class="tk-attr">href<\/span>=<span class="tk-str">&quot;x&quot;<\/span>/);
  assert.match(html, /1 &lt; 2/);
  assert.match(html, /<span class="tk-kw">if<\/span>/);
  assert.ok(!/<x>/.test(html));
  const css = F.highlight('css', 'a{color:#fff}');
  assert.match(css, /<span class="tk-type">a<\/span>\{<span class="tk-attr">color<\/span>:<span class="tk-num">#fff<\/span>\}/);
  const js = F.highlight('js', 'const s = "<b>"; // c\nfoo(1)');
  assert.strictEqual(js, '<span class="tk-kw">const</span> s = <span class="tk-str">&quot;&lt;b&gt;&quot;</span>; <span class="tk-comment">// c</span>\n<span class="tk-attr">foo</span>(<span class="tk-num">1</span>)');
});

test('formatting stays fast on large inputs (no quadratic slowdown)', () => {
  const big = (unit, n) => unit.repeat(Math.ceil(n / unit.length));
  const cases = [
    ['js', big('function a(b,c){if(b>c){return b-c}else{const x={k:1};return x.k?1:-1}}var q=a(1,2);', 1e6)],
    ['css', big('body{margin:0;color:#333}a:hover,.btn>span{color:red}', 1e6)],
    ['html', big('<div class="a"><p>Hi <b>x</b></p><ul><li>1</li></ul></div>', 1e6)],
    ['html', big('<div><span>unclosed', 3e5)],
  ];
  for (const [lang, src] of cases) {
    const start = Date.now();
    F.format(lang, src);
    F.highlight(lang, src.slice(0, 5e5));
    assert.ok(Date.now() - start < 2000, `${lang} took ${Date.now() - start} ms`);
  }
});
