import { TextField } from '../TextField';

type Props = { label: string; value: string; onChange: (html: string) => void; error?: string };

/** Native: a plain multiline box (descriptions are formatted on the web). */
export function RichTextEditor({ label, value, onChange, error }: Props) {
  return <TextField label={label} value={value} onChangeText={onChange} error={error} multiline numberOfLines={8} />;
}
