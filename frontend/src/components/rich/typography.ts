import { colors, font, WEB_SYSTEM_FONT } from '../../theme';

export const SYSTEM_FONT = WEB_SYSTEM_FONT;

/** The app's typography for rendered rich text (descriptions) and for the editor, scoped to a class. */
export function richTextCss(scope: string) {
  return `
${scope} { color: ${colors.text}; font-family: ${SYSTEM_FONT}; font-size: ${font.body}px; line-height: 1.5; overflow-wrap: anywhere; }
${scope} > :first-child { margin-top: 0; }
${scope} > :last-child { margin-bottom: 0; }
${scope} p { margin: 0 0 8px; }
${scope} h3 { font-size: ${font.heading}px; font-weight: 700; margin: 12px 0 6px; }
${scope} h4 { font-size: ${font.body}px; font-weight: 700; margin: 10px 0 4px; }
${scope} ul, ${scope} ol { margin: 0 0 8px; padding-left: 22px; }
${scope} li { margin: 2px 0; }
${scope} li p { margin: 0; }
${scope} a { color: ${colors.primary}; text-decoration: underline; }
`;
}
