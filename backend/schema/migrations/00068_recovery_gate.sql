-- 恢复状态不属于业务备份；同库全部角色共享恢复门禁。
CREATE TABLE recovery_gate (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 status text NOT NULL CHECK (status IN ('blocked','verified')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO recovery_gate(singleton,status) VALUES(true,'verified');

-- 每条业务物理连接各自持共享锁；任一断线不会使仍活动的连接脱离恢复互斥。
CREATE FUNCTION acquire_serving_gate() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT pg_try_advisory_lock_shared(716829432::bigint) THEN
  RAISE EXCEPTION 'database_recovery_blocked';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM recovery_gate WHERE singleton AND status='verified') THEN
  PERFORM pg_advisory_unlock_shared(716829432::bigint);
  RAISE EXCEPTION 'database_recovery_blocked';
 END IF;
END;
$$;
