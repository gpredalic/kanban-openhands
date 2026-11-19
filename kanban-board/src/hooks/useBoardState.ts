/**
 * useBoardState — React hook that bridges the BoardStateStore to React.
 *
 * Creates the store and data controller once, then subscribes to the store
 * via useSyncExternalStore so the component re-renders on every state change.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { BoardStateStore } from "../lib/board-state";
import { createBoardDataController, type BoardDataController } from "../lib/use-board-data";
import type { Host, BoardState } from "../types/task";

export interface BoardApi {
  state: BoardState;
  controller: BoardDataController;
}

export function useBoardState(host: Host): BoardApi {
  const [store] = useState(() => new BoardStateStore());
  const [controller] = useState(() => createBoardDataController(host, store));
  // Pass bound wrappers — passing bare `store.get`/`store.subscribe` would lose
  // the `this` binding when React invokes them, throwing on `this.state`.
  const state = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
    () => store.get(),
  );

  // Release the controller's polling timer when the component unmounts so the
  // event loop can drain (and the extension can be torn down cleanly).
  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  return { state, controller };
}
