import { useState } from 'react';
import { api } from '../api.js';

/** "Ask Pulse": natural-language questions answered from the timetable, crowd and mess models. */
export default function Ask() {
  const [q, setQ] = useState('');
  const [a, setA] = useState(null);
  const [busy, setBusy] = useState(false);

  async function ask(text) {
    if (!text.trim()) return;
    setQ(text);
    setBusy(true);
    try {
      setA(await api.post('/ask', { q: text }));
    } catch (e) {
      setA({ text: e.message, items: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ask">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Pulse: “Quiet room with free seats near LHC after 4?”" maxLength={200} aria-label="Ask Pulse" />
        <button className="btn primary" disabled={busy}>{busy ? '…' : 'Ask'}</button>
      </form>
      {a && (
        <div className="ask-answer">
          <button className="link small ask-close" onClick={() => setA(null)} aria-label="Close answer">✕</button>
          <p>{a.text}</p>
          {a.items.length > 0 && (
            <ul>
              {a.items.map((it) => (
                <li key={it.title}>
                  {it.detail ? (
                    <>
                      <strong>{it.title}</strong> <span className="muted small">· {it.detail}</span>
                    </>
                  ) : (
                    <button className="link" onClick={() => ask(it.title)}>{it.title}</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
