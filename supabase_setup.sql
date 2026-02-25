-- =====================================================
-- 특허법인 테헤란 청구서 시스템 v2 - Supabase 초기화 SQL
-- Supabase SQL Editor에서 순서대로 실행하세요.
-- =====================================================

-- 1. clients 테이블 생성
CREATE TABLE IF NOT EXISTS clients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_code     text UNIQUE,
    name            text NOT NULL,
    client_type     text CHECK (client_type IN ('법인', '개인')),
    contact_name    text,
    phone           text,
    email           text,
    business_no     text,
    assigned_attorney text,
    memo            text,
    is_active       boolean DEFAULT true,
    created_at      timestamptz DEFAULT now()
);

-- 2. client_code 자동채번 함수 (C-0001 형식)
CREATE OR REPLACE FUNCTION generate_client_code()
RETURNS TRIGGER AS $$
DECLARE
    next_num INTEGER;
BEGIN
    IF NEW.client_code IS NULL OR NEW.client_code = '' THEN
        SELECT COALESCE(
            MAX(CAST(SUBSTRING(client_code FROM 3) AS INTEGER)),
            0
        ) + 1
        INTO next_num
        FROM clients
        WHERE client_code ~ '^C-[0-9]+$';

        NEW.client_code := 'C-' || LPAD(next_num::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. client_code 트리거 등록
DROP TRIGGER IF EXISTS set_client_code ON clients;
CREATE TRIGGER set_client_code
    BEFORE INSERT ON clients
    FOR EACH ROW
    EXECUTE FUNCTION generate_client_code();

-- 4. quotes 테이블 생성
CREATE TABLE IF NOT EXISTS quotes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,
    share_token     text UNIQUE,
    doc_type        text CHECK (doc_type IN ('견적서', '청구서')),
    customer_name   text,
    pay_status      text DEFAULT '미납',
    paid_at         timestamptz,
    quote_data      jsonb,
    created_at      timestamptz DEFAULT now()
);

-- 5. 인덱스 (검색 성능)
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_is_active ON clients(is_active);
CREATE INDEX IF NOT EXISTS idx_quotes_client_id ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_share_token ON quotes(share_token);
CREATE INDEX IF NOT EXISTS idx_quotes_created_at ON quotes(created_at DESC);

-- 6. RLS 활성화
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes  ENABLE ROW LEVEL SECURITY;

-- 7. RLS 정책 (anon key 사용 시 전체 허용 — 운영 전 인증 추가 권장)
-- clients
DROP POLICY IF EXISTS "allow_all_clients" ON clients;
CREATE POLICY "allow_all_clients" ON clients
    FOR ALL USING (true) WITH CHECK (true);

-- quotes
DROP POLICY IF EXISTS "allow_all_quotes" ON quotes;
CREATE POLICY "allow_all_quotes" ON quotes
    FOR ALL USING (true) WITH CHECK (true);

-- 8. Storage 버킷 생성 (SQL Editor에서는 직접 생성 불가 — Storage 탭에서 수동으로 생성)
-- 버킷명: quote-assets
-- Public: ON

-- =====================================================
-- 실행 후 확인
-- SELECT * FROM clients LIMIT 5;
-- SELECT * FROM quotes  LIMIT 5;
-- =====================================================
