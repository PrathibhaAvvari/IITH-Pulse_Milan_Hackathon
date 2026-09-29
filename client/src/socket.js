import { io } from 'socket.io-client';
import { useEffect, useRef } from 'react';

export const socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });

/** Subscribe to a server event for the lifetime of a component. */
export function useSocket(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (...args) => ref.current(...args);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [event]);
}
