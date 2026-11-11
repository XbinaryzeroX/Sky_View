import { useEffect, useState } from 'react';
import { CAMERA_KEY_PROVIDER_IDS, PROVIDERS, type ProviderId, type ProviderState, type ProviderStatus } from '../../shared/providers';
import { api, errorText } from '../lib/api';
import { relativeTime } from '../lib/format';
import { ExternalLink, Modal } from './common';

const STATUS_LABEL: Record<ProviderStatus, { label: string; cls: string }> = {
  free: { label: 'Free · no key', cls: 'ok-badge' },
  'free-key': { label: 'Free · key required', cls: 'sev-minor' },
  restricted: { label: 'Restricted / unclear terms', cls: 'sev-moderate' },
  metered: { label: 'Metered · your billing', cls: 'sev-extreme' },
};

export function ProvidersDialog({ onClose }: { onClose(): void }) {
  const [states, setStates] = useState<ProviderState[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [msg, setMsg] = useState<Partial<Record<ProviderId, { ok: boolean; message: string }>>>({});
  const [filter, setFilter] = useState<'all' | 'credentials' | 'cameras'>('all');

  useEffect(() => {
    void api.listProviders().then(setStates);
  }, []);

  const stateOf = (id: ProviderId) => states.find((s) => s.id === id);

  async function save(id: ProviderId, value: string | null) {
    setBusy(id);
    try {
      setStates(await api.setProviderCredential(id, value));
      window.dispatchEvent(new CustomEvent('atlas-providers-changed', { detail: id }));
      setDrafts((d) => ({ ...d, [id]: '' }));
      setMsg((m) => ({ ...m, [id]: { ok: true, message: value ? 'Saved (encrypted with the Windows credential store).' : 'Removed.' } }));
    } catch (e) {
      setMsg((m) => ({ ...m, [id]: { ok: false, message: errorText(e) } }));
    } finally {
      setBusy(null);
    }
  }

  async function test(id: ProviderId) {
    setBusy(id);
    try {
      const r = await api.testProvider(id);
      setMsg((m) => ({ ...m, [id]: r }));
      setStates(await api.listProviders());
    } catch (e) {
      setMsg((m) => ({ ...m, [id]: { ok: false, message: errorText(e) } }));
    } finally {
      setBusy(null);
    }
  }

  // The many camera systems that take a free key have their own tab, so they don't crowd the main list.
  const list = PROVIDERS.filter((p) => (filter === 'cameras' ? CAMERA_KEY_PROVIDER_IDS.has(p.id) : !CAMERA_KEY_PROVIDER_IDS.has(p.id) && (filter === 'all' || p.credential)));
  const cameraKeysSaved = states.filter((s) => CAMERA_KEY_PROVIDER_IDS.has(s.id) && s.userConfigured).length;
  return (
    <Modal title="Provider settings" onClose={onClose} wide>
      <p className="muted small">
        Atlas Watch needs no paid credentials. Some releases include limited provider keys. Your saved key takes precedence; removing it restores the included key. Secret keys are encrypted with
        the Windows credential store and never shown again, exported, or logged. Google’s 3D Tiles key is a browser key by design: restrict it to the Map Tiles API in Google Cloud.
      </p>
      <div className="btn-row">
        <button className={`btn small-btn ${filter === 'all' ? 'primary' : ''}`} onClick={() => setFilter('all')}>
          All providers
        </button>
        <button className={`btn small-btn ${filter === 'credentials' ? 'primary' : ''}`} onClick={() => setFilter('credentials')}>
          Needs configuration
        </button>
        <button className={`btn small-btn ${filter === 'cameras' ? 'primary' : ''}`} onClick={() => setFilter('cameras')}>
          Camera keys{cameraKeysSaved ? ` (${cameraKeysSaved} saved)` : ''}
        </button>
      </div>
      {filter === 'cameras' && (
        <p className="muted small">
          These camera systems each need their own free developer key: register on the publisher’s developer page (you accept its terms there), then paste the key here. Its cameras load as soon as the key is saved, while the cameras layer is on. Keys are encrypted with the Windows credential store and sent only to that publisher.
        </p>
      )}
      <div className="provider-list">
        {list.map((p) => {
          const st = stateOf(p.id);
          const sl = STATUS_LABEL[p.status];
          const m = msg[p.id] ?? (st?.lastTest ? { ok: st.lastTest.ok, message: `${st.lastTest.message} (${relativeTime(st.lastTest.at)})` } : null);
          return (
            <section key={p.id} className="provider">
              <div className="provider-head">
                <strong>{p.name}</strong>
                <span className={`tag ${sl.cls}`}>{sl.label}</span>
                {p.credential && <span className={`tag ${st?.configured ? 'ok-badge' : 'muted-badge'}`}>{st?.configured ? (p.credential.kind === 'ack' ? 'License confirmed' : 'Configured') : 'Not configured'}</span>}
              </div>
              {st?.credentialError && (
                <p className="error small" role="alert">
                  {st.credentialError}
                </p>
              )}
              {st?.credentialSource && (
                <p className="small">
                  {st.credentialSource === 'builtin'
                    ? (p.id === 'google3d' ? 'Using the key included with Atlas Watch for Photoreal 3D · ' : 'Using the key included with Atlas Watch · ') +
                      st.builtinRemaining +
                      ' remaining today' +
                      (p.id === 'google3d' ? '. Satellite imagery and Google place search need your own key.' : '')
                    : 'Using your key'}
                </p>
              )}
              <div className="small">{p.purpose}</div>
              <div className="muted small">
                {p.statusNote} · Limits: {p.limits}
              </div>
              <div className="muted small">Capabilities: {p.capabilities.join(', ')}</div>
              <div className="small">
                <ExternalLink url={p.docsUrl}>Documentation</ExternalLink>
                {p.signupUrl && (
                  <>
                    {' · '}
                    <ExternalLink url={p.signupUrl}>Sign up / get key</ExternalLink>
                  </>
                )}
              </div>
              {p.credential?.kind === 'ack' && (
                <label className="check small">
                  <input type="checkbox" checked={!!st?.configured} disabled={busy === p.id} onChange={(e) => void save(p.id, e.target.checked ? 'yes' : null)} /> {p.credential.label}
                </label>
              )}
              {p.credential && p.credential.kind !== 'ack' && (
                <div className="btn-row">
                  <input
                    className="cred-input"
                    type={p.credential.kind === 'url' ? 'url' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={st?.userConfigured && p.credential.kind !== 'url' ? '•••••••• (saved; enter a new value to replace)' : (st?.configValue ?? p.credential.placeholder)}
                    aria-label={p.credential.label}
                    value={drafts[p.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  />
                  <button className="btn small-btn primary" disabled={busy === p.id || !(drafts[p.id] ?? '').trim()} onClick={() => void save(p.id, drafts[p.id] ?? '')}>
                    Save
                  </button>
                  {(st?.userConfigured || (p.credential.kind === 'url' && st?.configured)) && (
                    <button className="btn small-btn danger" disabled={busy === p.id} onClick={() => void save(p.id, null)}>
                      Remove
                    </button>
                  )}
                </div>
              )}
              {p.testable && (
                <button className="btn small-btn" disabled={busy === p.id} onClick={() => void test(p.id)}>
                  {busy === p.id ? 'Testing…' : 'Test connection'}
                </button>
              )}
              {m && <div className={`small ${m.ok ? 'ok-text' : 'err-text'}`}>{m.message}</div>}
              {p.id === 'google3d' && st?.configured && <div className="muted small">Use the “Satellite” and “Photoreal 3D” buttons in the top bar. Saving a key reloads the window so the map can reach Google. Included keys have a daily allowance; your own key is billed to your Google account.</div>}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
