export default function TextWidget({ display }: { display?: Record<string, unknown> }) {
  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>{String(display?.content ?? '')}</div>
  );
}
