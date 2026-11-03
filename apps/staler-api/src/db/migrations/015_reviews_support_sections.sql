-- 015: the original of a profile photo (so it can be re-cropped/turned later);
-- support tickets routed by topic and claimed by one admin, rated by the customer;
-- store reviews (one per person, edits kept) and reports between anyone;
-- a store's own product sections, wholesale buyers and prices; cash agents' extra places.

ALTER TABLE __SCHEMA__.users ADD COLUMN IF NOT EXISTS profile_image_original TEXT;

-- ------------------------------------------------------------------ support
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS topic TEXT;
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL;
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS first_reply_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE __SCHEMA__.conversations ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_support_queue_idx ON __SCHEMA__.conversations (type, assigned_to, status);

CREATE TABLE IF NOT EXISTS __SCHEMA__.support_ratings (
  conversation_id UUID PRIMARY KEY REFERENCES __SCHEMA__.conversations(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  user_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  stars INT CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  declined BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_ratings_admin_idx ON __SCHEMA__.support_ratings (admin_id);

-- Existing support chats: the first admin who answered owns it; the others leave it.
UPDATE __SCHEMA__.conversations c SET assigned_to = x.sender_id, claimed_at = x.at, first_reply_at = x.at
  FROM (SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.sender_id, m.created_at AS at
          FROM __SCHEMA__.messages m JOIN __SCHEMA__.users u ON u.id = m.sender_id AND u.role = 'admin'
         ORDER BY m.conversation_id, m.created_at) x
 WHERE c.id = x.conversation_id AND c.type = 'support' AND c.assigned_to IS NULL;
DELETE FROM __SCHEMA__.conversation_participants p
 USING __SCHEMA__.conversations c, __SCHEMA__.users u
 WHERE p.conversation_id = c.id AND c.type = 'support' AND u.id = p.user_id AND u.role = 'admin'
   AND u.id IS DISTINCT FROM c.assigned_to AND u.id IS DISTINCT FROM c.created_by;

-- ------------------------------------------------------------------ reviews
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  stars INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  body TEXT,
  anonymous BOOLEAN NOT NULL DEFAULT false,
  hidden BOOLEAN NOT NULL DEFAULT false,
  edits INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, user_id)
);
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_review_versions (
  id BIGSERIAL PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES __SCHEMA__.store_reviews(id) ON DELETE CASCADE,
  stars INT NOT NULL,
  body TEXT,
  anonymous BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
-- What the public may see (decided by the admins), what the owner may see, and whether the owner shows them.
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS review_public TEXT NOT NULL DEFAULT 'off';
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS review_owner TEXT NOT NULL DEFAULT 'none';
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS review_show BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------------ reports
CREATE TABLE IF NOT EXISTS __SCHEMA__.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  target_user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  target_merchant_id UUID REFERENCES __SCHEMA__.merchants(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'handling', 'resolved', 'dismissed')),
  assigned_to UUID REFERENCES __SCHEMA__.users(id) ON DELETE SET NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS reports_status_idx ON __SCHEMA__.reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_target_idx ON __SCHEMA__.reports (target_user_id);

-- ------------------------------------------------------- sections & wholesale
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT,
  image_url TEXT,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_sections_merchant_idx ON __SCHEMA__.store_sections (merchant_id, sort);
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS section_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(20,2);
ALTER TABLE __SCHEMA__.products ADD COLUMN IF NOT EXISTS wholesale_min_qty INT NOT NULL DEFAULT 1;

ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS wholesale_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE __SCHEMA__.merchants ADD COLUMN IF NOT EXISTS wholesale_terms TEXT;
CREATE TABLE IF NOT EXISTS __SCHEMA__.store_wholesale_buyers (
  merchant_id UUID NOT NULL REFERENCES __SCHEMA__.merchants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  business_name TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (merchant_id, user_id)
);
ALTER TABLE __SCHEMA__.orders ADD COLUMN IF NOT EXISTS is_wholesale BOOLEAN NOT NULL DEFAULT false;

-- --------------------------------------------------------------- agent places
CREATE TABLE IF NOT EXISTS __SCHEMA__.agent_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES __SCHEMA__.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  -- 0 = Sunday … 6 = Saturday; empty = every day.
  days INT[] NOT NULL DEFAULT '{}',
  hours TEXT,
  directions TEXT,
  sort INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_places_agent_idx ON __SCHEMA__.agent_places (agent_id, sort);

ALTER TABLE __SCHEMA__.support_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.store_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.store_review_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.store_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.store_wholesale_buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE __SCHEMA__.agent_places ENABLE ROW LEVEL SECURITY;

-- Admins who handle disputes also handle reports.
UPDATE __SCHEMA__.users SET admin_permissions = array_append(admin_permissions, 'reports.manage')
 WHERE role = 'admin' AND 'orders.disputes' = ANY(admin_permissions) AND NOT ('reports.manage' = ANY(admin_permissions));
