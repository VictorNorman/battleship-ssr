// A tiny HTML templating helper. Every interpolated value is escaped unless it
// is already SafeHtml (i.e. it came out of another `html` template), so output
// is safe by default.

export class SafeHtml {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (text: string): string => {
  return text.replace(/[&<>"']/g, (char) => {
    return ESCAPES[char];
  });
};

const render = (value: unknown): string => {
  if (value instanceof SafeHtml) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(render).join('');
  }
  if (value === null || value === undefined || value === false) {
    return '';
  }
  return escapeHtml(String(value));
};

export const html = (
  strings: TemplateStringsArray,
  ...values: unknown[]
): SafeHtml => {
  let result = '';
  strings.forEach((chunk, index) => {
    result += chunk;
    if (index < values.length) {
      result += render(values[index]);
    }
  });
  return new SafeHtml(result);
};
