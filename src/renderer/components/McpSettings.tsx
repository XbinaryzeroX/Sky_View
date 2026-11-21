// Settings section for the local AI agent bridge (MCP). Off by default; turning it on opens a named pipe on this
// computer only and shows the configuration an MCP client (Claude Desktop, Claude Code, …) needs.
import { useEffect, useState } from 'react';
import { api, errorText, type McpStatusInfo } from '../lib/api';

export function mcpClientConfig(s: McpStatusInfo): string | null {
  if (!s.serverPath || !s.runtime) return null;
  return JSON.stringify({ mcpServers: { 'sky-view': { command: s.runtime, args: [s.serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2);
}

export function McpSettings({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<McpStatusInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void api.mcpStatus().then(setStatus).catch((e) => setError(errorText(e)));
  useEffect(refresh, [enabled]);

  async function toggle(on: boolean) {
    setBusy(true); setError(null);
    try { await api.updateSettings({ mcpEnabled: on }); } catch (e) { setError(errorText(e)); }
    setBusy(false);
    refresh();
  }

  const config = status ? mcpClientConfig(status) : null;
  return (
    <section className="span-2">
      <h3 className="sub">AI agents (MCP)</h3>
      <p className="muted small">
        Lets AI agents on this computer read what the globe shows (view, layers, records, drawings) and add findings to the shared canvas, where they are labelled with the agent’s name.
        Agents cannot change settings, keys, saved places or your own drawings. The bridge is a Windows named pipe protected by a random token: nothing listens on the network and no firewall rule is added.
      </p>
      <label className="check">
        <input type="checkbox" checked={status?.enabled ?? enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} /> Allow AI agents to connect
      </label>
      {status?.enabled && (
        <div className={status.listening ? 'note ok' : 'note'} role="status">
          {status.listening ? `Ready. ${status.connections} agent connection(s)${status.lastCallAt ? `; last request ${new Date(status.lastCallAt).toLocaleTimeString()}` : ''}.` : `Not listening: ${status.error ?? 'starting…'}`}
        </div>
      )}
      {error && <div className="note" role="alert">{error}</div>}
      {config && (
        <label className="field">
          <span>Add this to your MCP client’s configuration (for Claude Desktop: claude_desktop_config.json). Sky_View must be open for agents to connect.</span>
          <textarea className="mono" readOnly rows={9} value={config} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
    </section>
  );
}
