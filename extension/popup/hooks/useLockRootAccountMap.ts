import { useEffect, useMemo, useState } from 'react';
import type { SubAccount } from '../../shared/types';
import { buildLockRootToAccountMap } from '../../shared/account-lock-roots';

export function useLockRootAccountMap(accounts: SubAccount[] | undefined): Map<string, SubAccount> {
  const [map, setMap] = useState<Map<string, SubAccount>>(() => new Map());

  const accountsKey = useMemo(
    () => (accounts ?? []).map(account => account.address).join('\0'),
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
        const nextMap = await buildLockRootToAccountMap(list);
        if (!cancelled) setMap(nextMap);
      } catch {
        if (!cancelled) setMap(new Map());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountsKey]);

  return map;
}
