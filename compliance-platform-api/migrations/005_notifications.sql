-- 005_notifications.sql
CREATE TYPE notification_recipient AS ENUM ('visa', 'mastercard', 'acquiring_bank', 'custom');
CREATE TYPE notification_status   AS ENUM ('pending', 'sent', 'overdue');

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id      UUID NOT NULL REFERENCES cases(id),
  recipient    notification_recipient NOT NULL,
  custom_name  TEXT,                            -- populated when recipient = 'custom'
  required_by  TIMESTAMPTZ NOT NULL,            -- copied from case.notification_deadline
  sent_at      TIMESTAMPTZ,
  sent_by      UUID REFERENCES users(id),
  status       notification_status NOT NULL DEFAULT 'pending',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_case_id ON notifications(case_id);
CREATE INDEX idx_notifications_status  ON notifications(status);

CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Notification alert log (every escalation email/in-app alert sent)
CREATE TABLE notification_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id UUID NOT NULL REFERENCES notifications(id),
  alert_type      TEXT NOT NULL,               -- '48hr', '60hr', '68hr', '72hr', 'overdue'
  channel         TEXT NOT NULL,               -- 'email' | 'in_app'
  sent_to         TEXT NOT NULL,               -- email address or user_id
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_alerts_notif ON notification_alerts(notification_id);
