// Small greeting banner shown at the top of the home screen.
//
// Pulls the current user from the daemon's /api/cloud/auth/me. Falls back to
// a generic greeting when the user isn't signed in (e.g. cloud not configured
// → app is in local-only mode). Reuses the avatar field from the profile
// table, which is empty for now but future-proofed for Google OAuth / manual
// upload via Phase 5+.

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
    <div className="welcome-banner" data-testid="welcome-banner">
      <div className="welcome-banner__avatar" aria-hidden>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" />
        ) : (
          <span className="welcome-banner__avatar-placeholder">{initial}</span>
        )}
      </div>
      <div className="welcome-banner__text">
        <span className="welcome-banner__hello">Olá,</span>
        <span className="welcome-banner__name">{greeting}</span>
      </div>
    </div>
  );
}
