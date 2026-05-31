// Compact greeting chip rendered in the entry topbar, aligned with the
// "Local CLI" pill on the right. Pulls the current user from the daemon's
// /api/cloud/auth/me; renders nothing when the user isn't signed in.

import { useEffect, useState } from 'react';
import { fetchCloudMe, type CloudUser } from '../providers/cloud';
import { CLOUD_AUTH_CHANGED_EVENT } from './CloudLoginGate';

interface WelcomeBannerProps {
  /** Optional override — useful for tests or storybook. */
  user?: CloudUser | null;
}

export function WelcomeBanner({ user: userOverride }: WelcomeBannerProps = {}) {
  const [user, setUser] = useState<CloudUser | null>(userOverride ?? null);
  const [loading, setLoading] = useState(userOverride === undefined);

  useEffect(() => {
    if (userOverride !== undefined) {
      setUser(userOverride);
      setLoading(false);
      return;
    }
    let canceled = false;
    async function load() {
      try {
        const result = await fetchCloudMe();
        if (canceled) return;
        if ('user' in result) {
          setUser(result.user);
        } else {
          setUser(null);
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    const handler = () => { void load(); };
    if (typeof window !== 'undefined') {
      window.addEventListener(CLOUD_AUTH_CHANGED_EVENT, handler);
    }
    return () => {
      canceled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener(CLOUD_AUTH_CHANGED_EVENT, handler);
      }
    };
  }, [userOverride]);

  if (loading) return null;

  // Not signed in → no banner. (Login gate already handles the sign-in flow.)
  if (!user) return null;

  const greeting = user.name?.trim() ? user.name : user.email;
  const initial = (greeting || '?').slice(0, 1).toUpperCase();
  const avatarUrl = (user as CloudUser & { avatar_url?: string | null }).avatar_url ?? null;

  return (
    <div className="welcome-chip" data-testid="welcome-banner">
      <span className="welcome-chip__avatar" aria-hidden>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" />
        ) : (
          <span className="welcome-chip__avatar-placeholder">{initial}</span>
        )}
      </span>
      <span className="welcome-chip__text">
        <span className="welcome-chip__hello">Olá,</span>
        <span className="welcome-chip__name">{greeting}</span>
      </span>
    </div>
  );
}
