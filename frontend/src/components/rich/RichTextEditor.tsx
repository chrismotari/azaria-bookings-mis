import { Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, font, radius, space } from '../../theme';
import { Field } from '../Field';
import { Icon, IconName } from '../Icon';
import { injectCss } from './css';
import { richTextCss, SYSTEM_FONT } from './typography';

type Props = {
  label: string;
  /** HTML; the server keeps only the formatting the toolbar offers. */
  value: string;
  onChange: (html: string) => void;
  error?: string;
};

const EDITOR_CSS = `
${richTextCss('.az-editor .ProseMirror')}
.az-editor .ProseMirror { min-height: 200px; padding: 10px 12px; outline: none; }
.az-editor .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: ${colors.muted}; float: left; height: 0; pointer-events: none; }
`;

/** Web: a rich text editor (TipTap) with a toolbar for the formatting plan descriptions allow. */
export function RichTextEditor({ label, value, onChange, error }: Props) {
  useEffect(() => injectCss('az-editor', EDITOR_CSS), []);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Only what the server keeps (tenants/richtext.py).
        heading: { levels: [3, 4] },
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto'] },
      }),
    ],
    content: value,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' } },
    onUpdate: ({ editor: changed }) => onChange(changed.isEmpty ? '' : changed.getHTML()),
  });

  return (
    <Field label={label} error={error}>
      <View style={[styles.box, error ? styles.boxError : null]}>
        {editor ? <Toolbar editor={editor} /> : null}
        <View style={styles.content}>
          <div className="az-editor">
            <EditorContent editor={editor} />
          </div>
        </View>
      </View>
    </Field>
  );
}

type Tool = {
  label: string;
  /** Shown in the button: a letter (styled by its class) or an icon. */
  text?: string;
  textClass?: string;
  icon?: IconName;
  active?: boolean;
  disabled?: boolean;
  run: () => void;
};

const TOOLBAR_CSS = `
.az-toolbar { display: flex; flex-wrap: wrap; gap: ${space.sm}px; padding: ${space.xs}px; border-bottom: 1px solid ${colors.border}; background: ${colors.background}; border-radius: ${radius.sm}px ${radius.sm}px 0 0; }
.az-toolbar-group { display: flex; gap: 2px; }
.az-tool { min-width: 32px; height: 32px; padding: 0 6px; border: 0; border-radius: ${radius.sm}px; background: transparent; color: ${colors.text}; font-family: ${SYSTEM_FONT}; font-size: ${font.body}px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.az-tool:hover:not(:disabled) { background: ${colors.surface}; }
.az-tool:focus-visible { outline: 2px solid ${colors.primary}; outline-offset: 1px; }
.az-tool[aria-pressed="true"] { background: ${colors.primaryTint}; color: ${colors.primary}; }
.az-tool:disabled { opacity: 0.4; cursor: default; }
.az-tool-bold { font-weight: 700; }
.az-tool-italic { font-style: italic; font-weight: 600; }
.az-tool-underline { text-decoration: underline; font-weight: 600; }
.az-tool-strike { text-decoration: line-through; font-weight: 600; }
.az-tool-small { font-weight: 700; font-size: ${font.small}px; }
`;

/**
 * Plain buttons that never take focus from the text (mousedown is cancelled), so the selection stays where it
 * was and typing carries on after a click, as in any word processor.
 */
function Toolbar({ editor }: { editor: Editor }) {
  useEffect(() => injectCss('az-toolbar', TOOLBAR_CSS), []);
  const chain = () => editor.chain().focus();
  const editLink = () => {
    const current = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link address (leave empty to remove the link)', current ?? 'https://');
    if (href === null) {
      return;
    }
    if (href.trim() === '' || href.trim() === 'https://') {
      chain().extendMarkRange('link').unsetLink().run();
    } else {
      chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
    }
  };
  const groups: Tool[][] = [
    [
      {
        label: 'Bold',
        text: 'B',
        textClass: 'az-tool-bold',
        active: editor.isActive('bold'),
        run: () => chain().toggleBold().run(),
      },
      {
        label: 'Italic',
        text: 'I',
        textClass: 'az-tool-italic',
        active: editor.isActive('italic'),
        run: () => chain().toggleItalic().run(),
      },
      {
        label: 'Underline',
        text: 'U',
        textClass: 'az-tool-underline',
        active: editor.isActive('underline'),
        run: () => chain().toggleUnderline().run(),
      },
      {
        label: 'Strikethrough',
        text: 'S',
        textClass: 'az-tool-strike',
        active: editor.isActive('strike'),
        run: () => chain().toggleStrike().run(),
      },
    ],
    [
      {
        label: 'Heading',
        text: 'H1',
        textClass: 'az-tool-bold',
        active: editor.isActive('heading', { level: 3 }),
        run: () => chain().toggleHeading({ level: 3 }).run(),
      },
      {
        label: 'Subheading',
        text: 'H2',
        textClass: 'az-tool-small',
        active: editor.isActive('heading', { level: 4 }),
        run: () => chain().toggleHeading({ level: 4 }).run(),
      },
    ],
    [
      {
        label: 'Bulleted list',
        icon: 'list-outline',
        active: editor.isActive('bulletList'),
        run: () => chain().toggleBulletList().run(),
      },
      {
        label: 'Numbered list',
        text: '1.',
        textClass: 'az-tool-bold',
        active: editor.isActive('orderedList'),
        run: () => chain().toggleOrderedList().run(),
      },
      { label: 'Link', icon: 'link-outline', active: editor.isActive('link'), run: editLink },
    ],
    [
      { label: 'Undo', icon: 'arrow-undo-outline', disabled: !editor.can().undo(), run: () => chain().undo().run() },
      { label: 'Redo', icon: 'arrow-redo-outline', disabled: !editor.can().redo(), run: () => chain().redo().run() },
    ],
  ];
  return (
    <div className="az-toolbar" role="toolbar" aria-label="Formatting">
      {groups.map((group, index) => (
        <div key={index} className="az-toolbar-group">
          {group.map((tool) => (
            <button
              key={tool.label}
              type="button"
              className={`az-tool ${tool.textClass ?? ''}`}
              aria-label={tool.label}
              title={tool.label}
              aria-pressed={tool.active ? 'true' : 'false'}
              disabled={tool.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={tool.run}
            >
              {tool.icon ? (
                <Icon name={tool.icon} size={18} color={tool.active ? colors.primary : colors.text} />
              ) : (
                tool.text
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  boxError: { borderColor: colors.danger },
  content: { minHeight: 200 },
});
