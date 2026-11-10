import { createElement, useEffect } from 'react';

import { injectCss } from './css';
import { richTextCss } from './typography';

/** Web: a description's sanitized HTML (cleaned by the server), in the app's typography. */
export function RichText({ html }: { html: string }) {
  useEffect(() => injectCss('az-rich-text', richTextCss('.az-rich-text')), []);
  if (!html) {
    return null;
  }
  return createElement('div', { className: 'az-rich-text', dangerouslySetInnerHTML: { __html: html } });
}
