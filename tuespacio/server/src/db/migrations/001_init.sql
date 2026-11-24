-- Tu Espacio · Migración 001 · Esquema inicial
-- Documentación del esquema y casos límite: docs/BASE_DE_DATOS.md
-- Convenciones: instantes en timestamptz (UTC), horarios locales en la zona del espacio,
-- dinero en pesos colombianos enteros (COP), identificadores de texto generados por la aplicación.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Parámetros que también usan los triggers (el servidor los sincroniza desde la configuración al iniciar).
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('walk_in_horizon_min', '180'), ('overstay_assume_min', '30');

CREATE FUNCTION setting_int(p_key text, p_default int) RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT value::int FROM app_settings WHERE key = p_key), p_default)
$$;

-- ───────────────────────── Identidad ─────────────────────────
CREATE TABLE roles (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  self_signup boolean NOT NULL
);
INSERT INTO roles (code, label, self_signup) VALUES
  ('driver', 'Conductor', true),
  ('owner', 'Dueño de parqueadero', false), -- alta solo por el equipo comercial (scripts/create-owner.js)
  ('host', 'Anfitrión', true);

CREATE TABLE users (
  id                    text PRIMARY KEY,
  role                  text NOT NULL REFERENCES roles (code),
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  email                 text NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  password_hash         text NOT NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password  boolean NOT NULL DEFAULT false,
  identity_status       text CHECK (identity_status IN ('pending', 'in_review', 'verified', 'rejected')),
  identity_requested_at timestamptz,
  plan                  text CHECK (plan IN ('Básico', 'Destacado')),
  preferences           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_identity_only_hosts CHECK ((role = 'host') = (identity_status IS NOT NULL)),
  CONSTRAINT users_plan_only_owners CHECK (role = 'owner' OR plan IS NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Sesiones con tokens OPACOS: solo se guarda el SHA-256 del token. Rotación de refresh con
-- detección de reutilización (prev_refresh_hash).
CREATE TABLE sessions (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_hash        text NOT NULL UNIQUE,
  access_expires_at  timestamptz NOT NULL,
  refresh_hash       text NOT NULL UNIQUE,
  prev_refresh_hash  text,
  refresh_expires_at timestamptz NOT NULL,
  user_agent         text CHECK (char_length(user_agent) <= 200),
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  revoke_reason      text
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_prev_refresh_idx ON sessions (prev_refresh_hash) WHERE prev_refresh_hash IS NOT NULL;
CREATE INDEX sessions_refresh_expiry_idx ON sessions (refresh_expires_at);

CREATE TABLE password_resets (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

-- Bandeja de salida (correo simulado). Un proveedor real de correo consumiría esta tabla.
CREATE TABLE outbox_messages (
  id           bigserial PRIMARY KEY,
  user_id      text REFERENCES users (id) ON DELETE CASCADE,
  channel      text NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  template     text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX outbox_user_idx ON outbox_messages (user_id, created_at DESC);

-- ───────────────────────── Catálogo ─────────────────────────
CREATE TABLE destinations (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  hint     text NOT NULL DEFAULT '',
  city     text NOT NULL,
  lat      double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng      double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  timezone text NOT NULL DEFAULT 'America/Bogota',
  search   text NOT NULL DEFAULT '', -- texto normalizado (sin tildes, minúsculas) para la búsqueda
  active   boolean NOT NULL DEFAULT true
);

CREATE TABLE vehicle_types (
  code  text PRIMARY KEY,
  label text NOT NULL
);
INSERT INTO vehicle_types (code, label) VALUES ('car', 'Carro'), ('moto', 'Moto');

-- Parqueaderos formales y espacios particulares comparten tabla (kind).
CREATE TABLE spaces (
  id             text PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('formal', 'particular')),
  manager_id     text NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  destination_id text NOT NULL REFERENCES destinations (id) ON DELETE RESTRICT,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 80),
  address        text NOT NULL CHECK (char_length(address) BETWEEN 5 AND 120),
  host_type      text CHECK (host_type IN ('Garaje', 'Lote', 'Antejardín')),
  plan           text CHECK (plan IN ('Básico', 'Destacado')),
  lat            double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng            double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  -- Ubicación pública: en espacios particulares se difumina (~150 m) para proteger al anfitrión.
  public_lat     double precision NOT NULL,
  public_lng     double precision NOT NULL,
  timezone       text NOT NULL DEFAULT 'America/Bogota',
  status         text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'paused', 'suspended')),
  covered        boolean NOT NULL DEFAULT false,
  keys_required  boolean NOT NULL DEFAULT false,
  max_height_m   numeric(3, 2) CHECK (max_height_m IS NULL OR max_height_m BETWEEN 1.5 AND 4),
  version        int NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spaces_host_type_particular CHECK ((kind = 'particular') = (host_type IS NOT NULL)),
  CONSTRAINT spaces_plan_formal CHECK (kind = 'formal' OR plan IS NULL)
);
CREATE INDEX spaces_destination_idx ON spaces (destination_id, status);
CREATE INDEX spaces_manager_idx ON spaces (manager_id);

-- Cupos por tipo de vehículo + entradas sin reserva (ocupación actual registrada por el dueño).
CREATE TABLE space_inventory (
  space_id         text NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  vehicle_type     text NOT NULL REFERENCES vehicle_types (code),
  capacity         int NOT NULL CHECK (capacity BETWEEN 0 AND 2000),
  walk_in_occupied int NOT NULL DEFAULT 0 CHECK (walk_in_occupied >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, vehicle_type),
  CONSTRAINT inventory_walk_in_le_capacity CHECK (walk_in_occupied <= capacity)
);

-- Tarifas con historial de vigencia: la vigente tiene effective_to NULL.
CREATE TABLE space_rates (
  id             bigserial PRIMARY KEY,
  space_id       text NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  vehicle_type   text NOT NULL REFERENCES vehicle_types (code),
  unit           text NOT NULL CHECK (unit IN ('minute', 'hour')),
  price_cop      int NOT NULL CHECK (price_cop > 0 AND price_cop <= 100000),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX space_rates_current_key ON space_rates (space_id, vehicle_type) WHERE effective_to IS NULL;

-- Horario por día de la semana (0 = domingo) en hora local del espacio. '24:00' = hasta medianoche.
CREATE TABLE space_schedules (
  space_id   text NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open_time  text NOT NULL CHECK (open_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  close_time text NOT NULL CHECK (close_time ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  PRIMARY KEY (space_id, weekday),
  CONSTRAINT schedule_open_before_close CHECK (open_time < close_time)
);

CREATE TABLE space_metrics_daily (
  space_id text NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  day      date NOT NULL,
  views    int NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (space_id, day)
);

-- ───────────────────────── Conductor ─────────────────────────
CREATE TABLE vehicles (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type        text NOT NULL REFERENCES vehicle_types (code),
  label       text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 40),
  plate       text CHECK (plate ~ '^[A-Z]{3}[0-9]{2}[0-9A-Z]?$'),
  height_m    numeric(3, 2) CHECK (height_m IS NULL OR height_m BETWEEN 1 AND 4),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX vehicles_one_default_key ON vehicles (user_id) WHERE is_default AND archived_at IS NULL;
CREATE INDEX vehicles_user_idx ON vehicles (user_id) WHERE archived_at IS NULL;

-- Solo medios de pago FICTICIOS (provider = 'simulated'). Un proveedor real exige otra migración.
CREATE TABLE payment_methods (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider      text NOT NULL DEFAULT 'simulated' CHECK (provider = 'simulated'),
  brand         text NOT NULL,
  last4         text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  label         text NOT NULL,
  test_behavior text NOT NULL CHECK (test_behavior IN ('approve', 'decline', 'timeout', 'timeout_then_approve')),
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_methods_one_default_key ON payment_methods (user_id) WHERE is_default;
CREATE INDEX payment_methods_user_idx ON payment_methods (user_id);

-- ───────────────────────── Reservas ─────────────────────────
CREATE TABLE reservation_statuses (
  code           text PRIMARY KEY,
  label          text NOT NULL,
  holds_capacity boolean NOT NULL,
  terminal       boolean NOT NULL
);
INSERT INTO reservation_statuses (code, label, holds_capacity, terminal) VALUES
  ('pending_payment', 'Procesando pago', false, false), -- el cupo lo ocupa la retención (holds)
  ('confirmed', 'Confirmada', true, false),
  ('active', 'En curso', true, false),
  ('completed', 'Finalizada', false, true),
  ('cancelled', 'Cancelada', false, true),
  ('expired', 'Vencida (no llegó)', false, true),
  ('failed', 'No completada', false, true);

CREATE TABLE reservations (
  id                text PRIMARY KEY,
  code              text NOT NULL UNIQUE,
  space_id          text NOT NULL REFERENCES spaces (id) ON DELETE RESTRICT,
  driver_id         text NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  vehicle_id        text REFERENCES vehicles (id) ON DELETE SET NULL,
  vehicle_type      text NOT NULL REFERENCES vehicle_types (code),
  period            tstzrange NOT NULL,
  status            text NOT NULL REFERENCES reservation_statuses (code),
  rate_unit         text NOT NULL CHECK (rate_unit IN ('minute', 'hour')),
  rate_price_cop    int NOT NULL CHECK (rate_price_cop > 0),
  amount_cop        int NOT NULL CHECK (amount_cop >= 0),
  commission_rate   numeric(5, 4) CHECK (commission_rate IS NULL OR commission_rate BETWEEN 0 AND 0.5),
  commission_cop    int CHECK (commission_cop IS NULL OR commission_cop BETWEEN 0 AND amount_cop),
  refund_cop        int CHECK (refund_cop IS NULL OR refund_cop BETWEEN 0 AND amount_cop),
  currency          text NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  payment_method_id text REFERENCES payment_methods (id) ON DELETE SET NULL,
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  check_in_at       timestamptz,
  check_out_at      timestamptz,
  cancelled_at      timestamptz,
  cancelled_by      text REFERENCES users (id) ON DELETE SET NULL,
  cancel_reason     text CHECK (char_length(cancel_reason) <= 200),
  expired_at        timestamptz,
  version           int NOT NULL DEFAULT 1,
  CONSTRAINT reservations_period_valid CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period)
                                              AND NOT lower_inf(period) AND NOT upper_inf(period)),
  CONSTRAINT reservations_checkout_after_checkin CHECK (check_out_at IS NULL OR (check_in_at IS NOT NULL AND check_out_at >= check_in_at)),
  CONSTRAINT reservations_driver_idem_key UNIQUE (driver_id, idempotency_key),
  CONSTRAINT reservations_id_space_vehicle_key UNIQUE (id, space_id, vehicle_type),
  -- Un mismo vehículo no puede estar en dos reservas vigentes que se solapen.
  CONSTRAINT reservations_vehicle_no_overlap EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
    WHERE (vehicle_id IS NOT NULL AND status IN ('pending_payment', 'confirmed', 'active'))
);
CREATE INDEX reservations_alloc_idx ON reservations USING gist (space_id, vehicle_type, period) WHERE status IN ('confirmed', 'active');
CREATE INDEX reservations_driver_idx ON reservations (driver_id, created_at DESC);
CREATE INDEX reservations_space_start_idx ON reservations (space_id, lower(period) DESC);
CREATE INDEX reservations_noshow_idx ON reservations (lower(period)) WHERE status = 'confirmed';
CREATE INDEX reservations_code_space_idx ON reservations (space_id, code);

-- Retenciones (T12): apartan el cupo durante el pago y vencen solas (expires_at).
CREATE TABLE holds (
  id             text PRIMARY KEY,
  reservation_id text NOT NULL UNIQUE,
  space_id       text NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
  vehicle_type   text NOT NULL REFERENCES vehicle_types (code),
  period         tstzrange NOT NULL CHECK (NOT isempty(period)),
  expires_at     timestamptz NOT NULL,
  status         text NOT NULL CHECK (status IN ('active', 'converted', 'released', 'expired')),
  renewals       int NOT NULL DEFAULT 0 CHECK (renewals >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz,
  release_reason text,
  FOREIGN KEY (reservation_id, space_id, vehicle_type) REFERENCES reservations (id, space_id, vehicle_type) ON DELETE CASCADE
);
CREATE INDEX holds_alloc_idx ON holds USING gist (space_id, vehicle_type, period) WHERE status = 'active';
CREATE INDEX holds_expiry_idx ON holds (expires_at) WHERE status = 'active';

-- Lo que ocupa cupo: reservas confirmadas/en curso y retenciones vigentes. Un vehículo en curso que
-- excedió su tiempo se supone presente overstay_assume_min minutos más (hasta que registre salida).
CREATE VIEW capacity_allocations AS
  SELECT r.space_id, r.vehicle_type, r.id AS reservation_id, 'reservation'::text AS kind,
         CASE WHEN r.status = 'active' AND upper(r.period) <= now()
              THEN tstzrange(lower(r.period), now() + make_interval(mins => setting_int('overstay_assume_min', 30)))
              ELSE r.period END AS period
    FROM reservations r
   WHERE r.status IN ('confirmed', 'active')
  UNION ALL
  SELECT h.space_id, h.vehicle_type, h.reservation_id, 'hold'::text, h.period
    FROM holds h
   WHERE h.status = 'active' AND h.expires_at > now();

-- Máxima concurrencia de asignaciones dentro de p_period (excluye una reserva y su retención).
-- VOLATILE a propósito: dentro del trigger debe tomar una instantánea nueva DESPUÉS del bloqueo.
CREATE FUNCTION max_concurrent(p_space text, p_vehicle text, p_period tstzrange, p_exclude_reservation text)
RETURNS int LANGUAGE sql VOLATILE AS $$
  WITH allocs AS (
    SELECT a.period FROM capacity_allocations a
     WHERE a.space_id = p_space AND a.vehicle_type = p_vehicle AND a.period && p_period
       AND a.reservation_id IS DISTINCT FROM p_exclude_reservation
  ), pts AS (
    SELECT lower(p_period) AS p
    UNION
    SELECT lower(a.period) FROM allocs a WHERE lower(a.period) > lower(p_period)
  )
  SELECT COALESCE(MAX(c), 0)::int
    FROM (SELECT (SELECT count(*) FROM allocs a WHERE a.period @> pts.p) AS c FROM pts) x
$$;

-- GARANTÍA CONTRA SOBREVENTA. Bloquea la fila de cupos (espacio, vehículo) y verifica que la nueva
-- asignación quepa. Todos los caminos que ocupan cupo pasan por aquí, aunque el código de la app falle.
-- SQLSTATE TE001 = CAPACITY_EXCEEDED (la API lo traduce a 409 SPACE_TAKEN).
CREATE FUNCTION assert_capacity(p_space text, p_vehicle text, p_period tstzrange, p_exclude text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  inv  space_inventory%ROWTYPE;
  used int;
  walk int := 0;
BEGIN
  SELECT * INTO inv FROM space_inventory WHERE space_id = p_space AND vehicle_type = p_vehicle FOR UPDATE;
  IF NOT FOUND OR inv.capacity = 0 THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED' USING ERRCODE = 'TE001', DETAIL = 'vehicle not accepted';
  END IF;
  used := max_concurrent(p_space, p_vehicle, p_period, p_exclude);
  IF lower(p_period) < now() + make_interval(mins => setting_int('walk_in_horizon_min', 180)) THEN
    walk := inv.walk_in_occupied;
  END IF;
  IF used + walk + 1 > inv.capacity THEN
    RAISE EXCEPTION 'CAPACITY_EXCEEDED' USING ERRCODE = 'TE001',
      DETAIL = format('capacity=%s used=%s walk_in=%s', inv.capacity, used, walk);
  END IF;
END $$;

CREATE FUNCTION trg_reservations_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('confirmed', 'active') AND (
       TG_OP = 'INSERT'
       OR OLD.status NOT IN ('confirmed', 'active')
       OR NEW.period IS DISTINCT FROM OLD.period
       OR NEW.space_id IS DISTINCT FROM OLD.space_id
       OR NEW.vehicle_type IS DISTINCT FROM OLD.vehicle_type) THEN
    PERFORM assert_capacity(NEW.space_id, NEW.vehicle_type, NEW.period, NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reservations_capacity BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION trg_reservations_capacity();

CREATE FUNCTION trg_holds_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.expires_at > now() AND (
       TG_OP = 'INSERT'
       OR OLD.status <> 'active'
       OR OLD.expires_at <= now()
       OR NEW.period IS DISTINCT FROM OLD.period) THEN
    PERFORM assert_capacity(NEW.space_id, NEW.vehicle_type, NEW.period, NEW.reservation_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER holds_capacity BEFORE INSERT OR UPDATE ON holds
  FOR EACH ROW EXECUTE FUNCTION trg_holds_capacity();

-- Bajar cupos o registrar una entrada sin reserva no puede dejar compromisos por fuera.
-- SQLSTATE TE002 = INVENTORY_CONFLICT.
CREATE FUNCTION trg_inventory_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  near_used int;
  far_used  int;
BEGIN
  IF NEW.capacity < OLD.capacity OR NEW.walk_in_occupied > OLD.walk_in_occupied THEN
    near_used := max_concurrent(NEW.space_id, NEW.vehicle_type,
                   tstzrange(now(), now() + make_interval(mins => GREATEST(setting_int('walk_in_horizon_min', 180), 1))), NULL);
    far_used := max_concurrent(NEW.space_id, NEW.vehicle_type, tstzrange(now(), now() + interval '400 days'), NULL);
    IF near_used + NEW.walk_in_occupied > NEW.capacity OR far_used > NEW.capacity THEN
      RAISE EXCEPTION 'INVENTORY_CONFLICT' USING ERRCODE = 'TE002',
        DETAIL = format('capacity=%s near=%s far=%s walk_in=%s', NEW.capacity, near_used, far_used, NEW.walk_in_occupied);
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_guard BEFORE UPDATE ON space_inventory
  FOR EACH ROW EXECUTE FUNCTION trg_inventory_guard();

-- ───────────────────────── Pagos y contabilidad ─────────────────────────
CREATE TABLE payments (
  id              text PRIMARY KEY,
  reservation_id  text NOT NULL REFERENCES reservations (id) ON DELETE RESTRICT,
  provider        text NOT NULL,
  provider_ref    text,
  method_id       text REFERENCES payment_methods (id) ON DELETE SET NULL,
  amount_cop      int NOT NULL CHECK (amount_cop >= 0),
  captured_cop    int NOT NULL DEFAULT 0,
  refunded_cop    int NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'COP',
  live            boolean NOT NULL DEFAULT false,
  status          text NOT NULL CHECK (status IN ('pending', 'authorized', 'captured', 'voided', 'refunded',
                                                   'partially_refunded', 'declined', 'failed')),
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amounts_valid CHECK (captured_cop BETWEEN 0 AND amount_cop AND refunded_cop BETWEEN 0 AND captured_cop)
);
CREATE UNIQUE INDEX payments_reservation_key ON payments (reservation_id);
CREATE INDEX payments_status_idx ON payments (status, updated_at);

CREATE TABLE payment_events (
  id              bigserial PRIMARY KEY,
  payment_id      text NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  operation       text NOT NULL CHECK (operation IN ('authorize', 'capture', 'void', 'refund', 'status')),
  outcome         text NOT NULL CHECK (outcome IN ('ok', 'declined', 'timeout', 'error', 'retry')),
  attempt         int NOT NULL DEFAULT 1,
  provider_ref    text,
  error_code      text,
  idempotency_key text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX payment_events_payment_idx ON payment_events (payment_id, id);

-- Estado interno de la pasarela SIMULADA (su propia idempotencia, como haría un proveedor real).
CREATE TABLE sim_gateway_operations (
  idempotency_key text PRIMARY KEY,
  operation       text NOT NULL,
  provider_ref    text NOT NULL,
  status          text NOT NULL,
  amount_cop      int,
  attempts        int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Comisiones. rate NULL = por definir (Fase 0). Formal: 0 (paga mensualidad).
CREATE TABLE commission_rules (
  id             bigserial PRIMARY KEY,
  space_kind     text NOT NULL CHECK (space_kind IN ('formal', 'particular')),
  rate           numeric(5, 4) CHECK (rate IS NULL OR rate BETWEEN 0 AND 0.5),
  effective_from timestamptz NOT NULL DEFAULT now(),
  note           text
);
CREATE INDEX commission_rules_kind_idx ON commission_rules (space_kind, effective_from DESC);
INSERT INTO commission_rules (space_kind, rate, note) VALUES
  ('formal', 0, 'Plan de mensualidad: sin comisión por reserva'),
  ('particular', NULL, 'Por definir en Fase 0 (decisión pendiente)');

-- Libro de transacciones (doble registro simplificado, montos con signo).
CREATE TABLE ledger_entries (
  id             bigserial PRIMARY KEY,
  reservation_id text NOT NULL REFERENCES reservations (id) ON DELETE RESTRICT,
  saga_id        text,
  entry_type     text NOT NULL CHECK (entry_type IN ('fare', 'commission', 'refund', 'commission_refund', 'reversal')),
  account        text NOT NULL CHECK (account IN ('manager', 'platform', 'driver')),
  amount_cop     int NOT NULL,
  reverses_id    bigint REFERENCES ledger_entries (id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_reservation_idx ON ledger_entries (reservation_id);

-- ───────────────────────── Transacción T0 (saga) ─────────────────────────
CREATE TABLE sagas (
  id              text PRIMARY KEY,
  kind            text NOT NULL DEFAULT 'T0' CHECK (kind IN ('T0')),
  user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reservation_id  text REFERENCES reservations (id) ON DELETE SET NULL,
  space_id        text REFERENCES spaces (id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  status          text NOT NULL CHECK (status IN ('running', 'committed', 'aborted', 'compensation_failed')),
  failed_step     text,
  error_code      text,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at     timestamptz
);
CREATE INDEX sagas_running_idx ON sagas (started_at) WHERE status = 'running';
CREATE INDEX sagas_user_key_idx ON sagas (user_id, idempotency_key, started_at DESC);
CREATE INDEX sagas_started_idx ON sagas (started_at DESC);

CREATE TABLE saga_steps (
  id      bigserial PRIMARY KEY,
  saga_id text NOT NULL REFERENCES sagas (id) ON DELETE CASCADE,
  step    text NOT NULL,
  status  text NOT NULL CHECK (status IN ('start', 'ok', 'fail', 'comp', 'retry', 'info')),
  detail  text NOT NULL,
  at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX saga_steps_saga_idx ON saga_steps (saga_id, id);

CREATE TABLE idempotency_keys (
  user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scope           text NOT NULL,
  key             text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 120),
  request_hash    text NOT NULL,
  status          text NOT NULL CHECK (status IN ('processing', 'completed')),
  response_status int,
  response_body   jsonb,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);
CREATE INDEX idempotency_created_idx ON idempotency_keys (created_at);

-- ───────────────────────── Auditoría y sincronización ─────────────────────────
-- Registro de auditoría append-only. Nunca guarda contraseñas, tokens ni códigos.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,
  actor_role  text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  request_id  text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id, at DESC);
CREATE INDEX audit_actor_idx ON audit_log (actor_id, at DESC);

CREATE FUNCTION trg_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es solo de inserción';
END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION trg_audit_append_only();

-- Feed de cambios para invalidar consultas de los clientes (polling barato; ver docs/TIEMPO_REAL.md).
CREATE TABLE change_log (
  seq           bigserial PRIMARY KEY,
  topic         text NOT NULL CHECK (topic IN ('space', 'reservation')),
  entity_id     text NOT NULL,
  scope_user_id text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX change_log_at_idx ON change_log (at);

CREATE TABLE rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        int NOT NULL
);
