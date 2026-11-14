import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml, html, SafeHtml } from './html.js';

describe('escapeHtml', () => {
  it('escapes all five special characters', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes ampersands first, without double-escaping', () => {
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });

  it('leaves safe text alone', () => {
    assert.equal(escapeHtml('Hello, world 123'), 'Hello, world 123');
  });
});

describe('html template tag', () => {
  it('escapes interpolated strings', () => {
    assert.equal(html`<p>${'<b>'}</p>`.value, '<p>&lt;b&gt;</p>');
  });

  it('escapes values inside attributes', () => {
    assert.equal(html`<a title="${'" onclick="x'}"></a>`.value, '<a title="&quot; onclick=&quot;x"></a>');
  });

  it('does not re-escape nested html fragments', () => {
    const inner = html`<b>${'x & y'}</b>`;
    assert.equal(html`<p>${inner}</p>`.value, '<p><b>x &amp; y</b></p>');
  });

  it('joins arrays, escaping plain items and keeping fragments', () => {
    const items = ['<a>', html`<i>ok</i>`, 'b'];
    assert.equal(html`${items}`.value, '&lt;a&gt;<i>ok</i>b');
  });

  it('renders nothing for null, undefined, and false', () => {
    assert.equal(html`[${null}][${undefined}][${false}]`.value, '[][][]');
  });

  it('renders zero and other falsy-but-meaningful values', () => {
    assert.equal(html`${0}|${''}|${true}`.value, '0||true');
  });

  it('stringifies numbers', () => {
    assert.equal(html`${42}`.value, '42');
  });

  it('flattens nested arrays', () => {
    assert.equal(html`${[['a', 'b'], ['c']]}`.value, 'abc');
  });

  it('returns a SafeHtml whose toString is its value', () => {
    const result = html`<p>hi</p>`;
    assert.ok(result instanceof SafeHtml);
    assert.equal(String(result), '<p>hi</p>');
  });

  it('does not trust a look-alike object', () => {
    const fake = {
      value: '<script>',
    };
    assert.equal(html`${fake}`.value, '[object Object]');
  });
});
