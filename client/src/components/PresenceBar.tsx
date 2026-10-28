import { initials } from '../lib/colors';
import type { ConnectionStatus, Peer } from '../lib/useCollabRoom';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  disconnected: 'Offline: edits will sync on reconnect',
};

export function PresenceBar({ peers, status }: { peers: Peer[]; status: ConnectionStatus }) {
  const shown = peers.slice(0, 6);
  const extra = peers.length - shown.length;
  return (
    <div className="presence">
      <span className={`status status-${status}`} title={STATUS_LABEL[status]}>
        <span className="status-dot" />
        {STATUS_LABEL[status]}
      </span>
      <div className="avatars" aria-label={`${peers.length} people in this room`}>
        {shown.map((p) => (
          <span
            key={p.clientId}
            className="avatar"
            style={{ background: p.color }}
            title={p.isMe ? `${p.name} (you)` : p.name}
          >
            {initials(p.name)}
          </span>
        ))}
        {extra > 0 && <span className="avatar avatar-more">+{extra}</span>}
      </div>
    </div>
  );
}
