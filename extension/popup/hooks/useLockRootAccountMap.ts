import { useEffect, useMemo, useState } from 'react';
import type { Account } from '../../shared/types';
import { buildLockRootToAccountMap } from '../../shared/account-lock-roots';

export function useLockRootAccountMap(accounts: Account[] | undefined): Map<string, Account> {
  const [map, setMap] = useState<Map<string, Account>>(() => new Map());

  const accountsKey = useMemo(
    () => (accounts ?? []).map(a => a.address).join('\0'),
    [accounts]
  );

  useEffect(() => {
    let cancelled = false;
    const list = accounts ?? [];
    if (list.length === 0) {
      setMap(new Map());
      return;
    }
    void (async () => {
      try {
        const m = await buildLockRootToAccountMap(list);
        if (!cancelled) setMap(m);
      } catch {
        if (!cancelled) setMap(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountsKey, accounts]);

  return map;
}
