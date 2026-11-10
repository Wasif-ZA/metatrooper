export function AgentHead({ x, className, children, ...rest }) {
  const word = STATE_WORDS[x.state] || x.state;
  return (
    <div className={className ? `ou-ah ${className}` : 'ou-ah'} data-state={x.state} {...rest}>
      <span className="ou-ah-tile" data-mono={String(x.engine_id || '').slice(0, 2).toUpperCase()}><i className="ou-ah-pip" /></span>
      <span className="ou-ah-name">{taskOf(x)}</span>
      <span className="ou-ah-proj">{x.engine_id}</span>
      <span className="ou-ah-state">{x.state_at ? `${word} · ${ago(x.state_at)}` : word}</span>
      <span className="ou-ah-acts">{children}</span>
    </div>
  );
}
