-- 业务连接的恢复门只认这一条函数。锁拿不到，或 recovery_gate 不是 verified，都是 QQG01。
-- 不再借用 RAISE 的默认码 P0001：那个码是所有没写 ERRCODE 的异常共用的，按正文分类会误命中。
-- 可重入：CREATE OR REPLACE。

CREATE OR REPLACE FUNCTION acquire_serving_gate() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT pg_try_advisory_lock_shared(716829432::bigint) THEN
  RAISE EXCEPTION 'database_recovery_blocked' USING ERRCODE='QQG01';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM recovery_gate WHERE singleton AND status='verified') THEN
  PERFORM pg_advisory_unlock_shared(716829432::bigint);
  RAISE EXCEPTION 'database_recovery_blocked' USING ERRCODE='QQG01';
 END IF;
END;
$$;
