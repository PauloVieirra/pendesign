-- ============================================================================
-- Phase 4 — Notifications + proposal comments.
--
-- notifications: per-user event feed (invitations, proposal events, comments).
-- proposal_comments: linear thread per proposal.
--
-- Triggers fan out notifications on INSERT into project_invitations,
-- change_proposals, change_proposals updates (review), and proposal_comments.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'invitation',
                'proposal_submitted',
                'proposal_reviewed',
                'proposal_commented'
              )),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users only see their own notifications.
DROP POLICY IF EXISTS "notifications_select_self" ON public.notifications;
CREATE POLICY "notifications_select_self" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Mark-as-read only on own rows.
DROP POLICY IF EXISTS "notifications_update_self" ON public.notifications;
CREATE POLICY "notifications_update_self" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Notifications are inserted exclusively by triggers (SECURITY DEFINER).
-- No INSERT policy => app code can't write directly.

-- ============================================================================
-- proposal_comments: linear thread per proposal.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.proposal_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.change_proposals(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES public.profiles(id),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS proposal_comments_proposal_idx
  ON public.proposal_comments (proposal_id, created_at);

ALTER TABLE public.proposal_comments ENABLE ROW LEVEL SECURITY;

-- Members of the project read comments. (Joins through change_proposals.)
DROP POLICY IF EXISTS "comments_select_member" ON public.proposal_comments;
CREATE POLICY "comments_select_member" ON public.proposal_comments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM public.change_proposals cp
      JOIN public.project_members m ON m.project_id = cp.project_id
      WHERE cp.id = proposal_comments.proposal_id AND m.user_id = auth.uid()
    )
  );

-- Members write comments.
DROP POLICY IF EXISTS "comments_insert_member" ON public.proposal_comments;
CREATE POLICY "comments_insert_member" ON public.proposal_comments
  FOR INSERT TO authenticated WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.change_proposals cp
      JOIN public.project_members m ON m.project_id = cp.project_id
      WHERE cp.id = proposal_comments.proposal_id AND m.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Notification fan-out triggers.
-- ============================================================================

-- 1) On project_invitations INSERT → notify the invited user IF they already
--    have an account. (If not, the email is the only channel — handled by
--    the send-invitation-email Edge Function separately.)
CREATE OR REPLACE FUNCTION public.notify_on_invitation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  invitee_user_id UUID;
  project_name    TEXT;
  inviter_name    TEXT;
BEGIN
  SELECT id INTO invitee_user_id FROM auth.users WHERE email = NEW.email;
  IF invitee_user_id IS NULL THEN
    RETURN NEW;  -- no in-app notification possible; email path will reach them
  END IF;
  SELECT name INTO project_name FROM public.projects WHERE id = NEW.project_id;
  SELECT name INTO inviter_name FROM public.profiles WHERE id = NEW.created_by;
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (
    invitee_user_id,
    'invitation',
    jsonb_build_object(
      'invitation_id', NEW.id,
      'project_id',    NEW.project_id,
      'project_name',  project_name,
      'inviter_id',    NEW.created_by,
      'inviter_name',  inviter_name,
      'role',          NEW.role,
      'expires_at',    NEW.expires_at
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invitations_notify ON public.project_invitations;
CREATE TRIGGER invitations_notify
  AFTER INSERT ON public.project_invitations
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_invitation();

-- 2) On change_proposals INSERT → notify the project owner.
CREATE OR REPLACE FUNCTION public.notify_on_proposal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_uid       UUID;
  project_name    TEXT;
  submitter_name  TEXT;
BEGIN
  SELECT owner_id, name INTO owner_uid, project_name
    FROM public.projects WHERE id = NEW.project_id;
  IF owner_uid IS NULL OR owner_uid = NEW.submitter_id THEN
    RETURN NEW;  -- skip self-notify if owner submitted
  END IF;
  SELECT name INTO submitter_name FROM public.profiles WHERE id = NEW.submitter_id;
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (
    owner_uid,
    'proposal_submitted',
    jsonb_build_object(
      'proposal_id',     NEW.id,
      'project_id',      NEW.project_id,
      'project_name',    project_name,
      'submitter_id',    NEW.submitter_id,
      'submitter_name',  submitter_name,
      'base_version',    NEW.base_version,
      'message',         NEW.message
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_notify ON public.change_proposals;
CREATE TRIGGER proposals_notify
  AFTER INSERT ON public.change_proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_proposal();

-- 3) On change_proposals UPDATE (status → approved|rejected) → notify submitter.
CREATE OR REPLACE FUNCTION public.notify_on_proposal_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_name  TEXT;
  reviewer_name TEXT;
BEGIN
  IF NEW.status NOT IN ('approved', 'rejected') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NEW.submitter_id = NEW.reviewed_by THEN RETURN NEW; END IF;
  SELECT name INTO project_name FROM public.projects WHERE id = NEW.project_id;
  SELECT name INTO reviewer_name FROM public.profiles WHERE id = NEW.reviewed_by;
  INSERT INTO public.notifications (user_id, type, payload)
  VALUES (
    NEW.submitter_id,
    'proposal_reviewed',
    jsonb_build_object(
      'proposal_id',      NEW.id,
      'project_id',       NEW.project_id,
      'project_name',     project_name,
      'reviewer_id',      NEW.reviewed_by,
      'reviewer_name',    reviewer_name,
      'status',           NEW.status,
      'reviewer_message', NEW.reviewer_message
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proposals_review_notify ON public.change_proposals;
CREATE TRIGGER proposals_review_notify
  AFTER UPDATE ON public.change_proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_proposal_review();

-- 4) On proposal_comments INSERT → notify other participants (submitter + last
--    reviewer if differ from author).
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  proposal_row     public.change_proposals%ROWTYPE;
  project_name     TEXT;
  author_name      TEXT;
  recipient_uid    UUID;
  recipients       UUID[];
BEGIN
  SELECT * INTO proposal_row FROM public.change_proposals WHERE id = NEW.proposal_id;
  IF proposal_row.id IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO project_name FROM public.projects WHERE id = proposal_row.project_id;
  SELECT name INTO author_name FROM public.profiles WHERE id = NEW.author_id;

  recipients := ARRAY[]::UUID[];
  IF proposal_row.submitter_id <> NEW.author_id THEN
    recipients := array_append(recipients, proposal_row.submitter_id);
  END IF;
  IF proposal_row.reviewed_by IS NOT NULL AND proposal_row.reviewed_by <> NEW.author_id THEN
    recipients := array_append(recipients, proposal_row.reviewed_by);
  END IF;
  -- Also notify the project owner if not already covered (so they see comments
  -- on proposals they have not reviewed yet).
  PERFORM 1 FROM public.projects WHERE id = proposal_row.project_id AND owner_id <> NEW.author_id;
  IF FOUND THEN
    SELECT owner_id INTO recipient_uid FROM public.projects WHERE id = proposal_row.project_id;
    IF NOT (recipient_uid = ANY(recipients)) THEN
      recipients := array_append(recipients, recipient_uid);
    END IF;
  END IF;

  FOREACH recipient_uid IN ARRAY recipients LOOP
    INSERT INTO public.notifications (user_id, type, payload)
    VALUES (
      recipient_uid,
      'proposal_commented',
      jsonb_build_object(
        'proposal_id',   NEW.proposal_id,
        'project_id',    proposal_row.project_id,
        'project_name',  project_name,
        'comment_id',    NEW.id,
        'author_id',     NEW.author_id,
        'author_name',   author_name,
        'body_preview',  left(NEW.body, 140)
      )
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_notify ON public.proposal_comments;
CREATE TRIGGER comments_notify
  AFTER INSERT ON public.proposal_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();
