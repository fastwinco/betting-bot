-- =============================================
-- BETTING BOT DATABASE
-- =============================================

CREATE DATABASE IF NOT EXISTS betting_bot;
USE betting_bot;

-- ── USERS ─────────────────────────────────────────────────
CREATE TABLE users (
  id               INT PRIMARY KEY AUTO_INCREMENT,
  whatsapp_number  VARCHAR(20) UNIQUE NOT NULL,
  name             VARCHAR(100),
  upi_id           VARCHAR(100),
  wallet_balance   DECIMAL(10,2) DEFAULT 0.00,
  total_bet        DECIMAL(10,2) DEFAULT 0.00,
  total_won        DECIMAL(10,2) DEFAULT 0.00,
  status           ENUM('active','blocked') DEFAULT 'active',
  registered_at    DATETIME DEFAULT NOW()
);

-- ── MARKETS ───────────────────────────────────────────────
CREATE TABLE markets (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  name              VARCHAR(100) NOT NULL,
  open_time         TIME NOT NULL,
  close_time        TIME NOT NULL,
  result_time       TIME NOT NULL,
  status            ENUM(
                      'open',
                      'open_resulted',
                      'closed',
                      'resulted',
                      'cancelled'
                    ) DEFAULT 'open',
  result_single     VARCHAR(1),
  result_jodi       VARCHAR(2),
  result_open_pana  VARCHAR(3),
  result_close_pana VARCHAR(3),
  pdf_generated     TINYINT DEFAULT 0,
  created_at        DATETIME DEFAULT NOW(),
  resulted_at       DATETIME
);

-- ── BETS ──────────────────────────────────────────────────
CREATE TABLE bets (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  user_id      INT NOT NULL,
  market_id    INT NOT NULL,
  bet_type     ENUM(
                 'open_single',
                 'open_pana',
                 'jodi',
                 'close_single',
                 'close_pana'
               ) NOT NULL,
  number       VARCHAR(3) NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  multiplier   INT NOT NULL,
  possible_win DECIMAL(10,2) NOT NULL,
  actual_win   DECIMAL(10,2) DEFAULT 0,
  status       ENUM('pending','won','lost','cancelled') DEFAULT 'pending',
  placed_at    DATETIME DEFAULT NOW(),
  FOREIGN KEY (user_id)   REFERENCES users(id),
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

-- ── DEPOSITS ──────────────────────────────────────────────
CREATE TABLE deposits (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  user_id      INT NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  utr_number   VARCHAR(50),
  status       ENUM('pending','approved','rejected') DEFAULT 'pending',
  source       ENUM('sms','screenshot','manual') DEFAULT 'manual',
  admin_note   TEXT,
  created_at   DATETIME DEFAULT NOW(),
  approved_at  DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ── WITHDRAWALS ───────────────────────────────────────────
CREATE TABLE withdrawals (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  user_id      INT NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  upi_id       VARCHAR(100) NOT NULL,
  utr_number   VARCHAR(50),
  status       ENUM('pending','paid','rejected') DEFAULT 'pending',
  admin_note   TEXT,
  created_at   DATETIME DEFAULT NOW(),
  paid_at      DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ── TRANSACTIONS ──────────────────────────────────────────
CREATE TABLE transactions (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  user_id      INT NOT NULL,
  type         ENUM('deposit','withdrawal','bet','win','refund') NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  utr_number   VARCHAR(50) UNIQUE,
  status       ENUM('pending','approved','rejected') DEFAULT 'approved',
  source       VARCHAR(20),
  note         TEXT,
  created_at   DATETIME DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ── MARKET PDFs ───────────────────────────────────────────
CREATE TABLE market_pdfs (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  market_id    INT NOT NULL,
  bet_type     VARCHAR(50),
  file_path    VARCHAR(255),
  created_at   DATETIME DEFAULT NOW(),
  UNIQUE KEY unique_market_bet (market_id, bet_type),
  FOREIGN KEY (market_id) REFERENCES markets(id)
);

-- ── MANUAL REVIEW ─────────────────────────────────────────
CREATE TABLE manual_review (
  id           INT PRIMARY KEY AUTO_INCREMENT,
  utr_number   VARCHAR(50),
  amount       DECIMAL(10,2),
  source       VARCHAR(20),
  raw_data     TEXT,
  status       ENUM('pending','resolved') DEFAULT 'pending',
  created_at   DATETIME DEFAULT NOW()
);

-- ── ADMINS ────────────────────────────────────────────────
CREATE TABLE admins (
  id            INT PRIMARY KEY AUTO_INCREMENT,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  last_login    DATETIME
);

-- =============================================
-- DEFAULT DATA
-- =============================================

-- Default markets
INSERT INTO markets (name, open_time, close_time, result_time) VALUES
('Morning Market', '09:00:00', '11:00:00', '11:30:00'),
('Evening Market', '17:00:00', '18:30:00', '19:00:00'),
('Night Market',   '20:00:00', '21:30:00', '22:00:00');

-- Default admin
-- Password: admin123 (baad mein zaroor badlein!)
INSERT INTO admins (username, password_hash) VALUES
('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');
