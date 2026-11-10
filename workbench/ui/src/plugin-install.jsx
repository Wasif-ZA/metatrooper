import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Code } from '@astryxdesign/core/Code';
import { Dialog } from '@astryxdesign/core/Dialog';
import { Heading } from '@astryxdesign/core/Heading';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';

// Preview first, then install exactly what the preview showed (same hash, same permissions).
export function PluginInstall({ onClose }) {
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [pre, setPre] = useState(null);
  const check = async () => {
    if (!source.trim() || busy) return;
    setBusy(true);
    const r = await rpc('plugin.preview', { source: source.trim() });
    setBusy(false);
    setPre(r.result || null);
  };
  const install = async () => {
    if (!pre || !pre.valid || busy) return;
    setBusy(true);
    const r = await rpc('plugin.install', { source: source.trim(), approved_permissions: pre.screen.permissions.map((p) => p.permission), manifest_hash: pre.manifest_hash });
    setBusy(false);
    if (!r.result) return;
    const missing = r.result.missing_secrets || [];
    toast(missing.length ? `Installed ${r.result.plugin_id}. It still needs ${missing.join(', ')}. In a terminal: troop plugin secret ${r.result.plugin_id} <NAME>` : `Installed ${r.result.plugin_id}`);
    onClose(true);
  };
  const s = pre && pre.valid ? pre.screen : null;
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(false); }} width={560} purpose="form" aria-label="Add add-on">
      <Layout
        content={(
          <LayoutContent>
            <Heading level={2}>Add add-on</Heading>
            <TextInput label="Plugin folder or git URL" placeholder="C:/plugins/my-plugin" value={source} onChange={(v) => { setSource(v); setPre(null); }} onEnter={check} hasAutoFocus isDisabled={busy} />
            {busy ? <Text as="p" color="secondary">Working. A git URL is cloned first, which can take a minute.</Text> : null}
            {pre && !pre.valid ? <div className="ou-tags">{pre.errors.map((e) => <span key={e} className="ou-tag">{e}</span>)}</div> : null}
            {s ? (
              <>
                <Text as="p"><b>{s.plugin.name || s.plugin.id}</b> v{s.plugin.version}. {s.plugin.description || 'No description.'}</Text>
                <Text as="p" color="secondary">It will be allowed to:</Text>
                <div className="ou-tags">
                  {s.permissions.length ? s.permissions.map((p) => <span key={p.permission} className="ou-tag">{p.new ? 'New: ' : ''}{p.text}</span>) : <span className="ou-tag ou-tag-quiet">No permissions</span>}
                </div>
                {[...s.engines, ...s.mcp_servers].length ? <Text as="p" color="secondary">It runs: {[...s.engines, ...s.mcp_servers].map((x) => <Code key={x.id}>{x.command}</Code>)}</Text> : null}
                {s.warnings.map((w) => <Text key={w} as="p" color="secondary">{w}</Text>)}
              </>
            ) : null}
          </LayoutContent>
        )}
        footer={(
          <LayoutFooter>
            <span className="ou-actions">
              <Button variant="ghost" label="Cancel" onClick={() => onClose(false)} />
              {s ? <Button variant="primary" label="Install" isDisabled={busy} onClick={install} /> : <Button label="Check" isDisabled={busy || !source.trim()} onClick={check} />}
            </span>
          </LayoutFooter>
        )}
      />
    </Dialog>
  );
}
