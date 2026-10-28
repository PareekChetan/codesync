import { useEffect, useState } from 'react';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { wsBaseUrl, type User } from './api';
import { colorFor } from './colors';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface Peer {
  clientId: number;
  name: string;
  color: string;
  isMe: boolean;
}

export interface CollabRoom {
  doc: Y.Doc;
  provider: WebsocketProvider;
}

/**
 * Connects to a room over WebSockets and keeps a local Yjs document in sync.
 * Edits apply locally first (instant typing), then sync in the background.
 * If the connection drops, edits queue up and merge automatically on reconnect.
 */
export function useCollabRoom(roomId: string, token: string | null, user: User | null) {
  const [room, setRoom] = useState<CollabRoom | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!token || !user) return;
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(wsBaseUrl(), roomId, doc, {
      params: { token },
      maxBackoffTime: 5000,
    });

    provider.awareness.setLocalStateField('user', {
      name: user.name,
      color: colorFor(user.id),
      colorLight: colorFor(user.id) + '33',
    });

    const onStatus = ({ status }: { status: ConnectionStatus }) => setStatus(status);
    const onSync = (isSynced: boolean) => setSynced(isSynced);
    const onAwareness = () => {
      const list: Peer[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (!state.user) return;
        list.push({ clientId, name: state.user.name, color: state.user.color, isMe: clientId === doc.clientID });
      });
      list.sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
      setPeers(list);
    };

    provider.on('status', onStatus);
    provider.on('sync', onSync);
    provider.awareness.on('change', onAwareness);
    onAwareness();
    setRoom({ doc, provider });

    return () => {
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.awareness.off('change', onAwareness);
      provider.destroy();
      doc.destroy();
      setRoom(null);
      setSynced(false);
    };
  }, [roomId, token, user]);

  return { room, status, synced, peers };
}
