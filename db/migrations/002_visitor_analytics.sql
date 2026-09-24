-- Anonymous UV and active-user tracking.
-- One row per visitor per five-minute activity bucket keeps the table compact
-- while supporting distinct visitor counts over arbitrary time ranges.

USE `thumb_guessr`;

CREATE TABLE IF NOT EXISTS `visitor_activity_5m` (
  `visitor_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `bucket_start` DATETIME NOT NULL,
  `first_seen_at` DATETIME(3) NOT NULL,
  `last_seen_at` DATETIME(3) NOT NULL,
  `activity_count` INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`visitor_id`, `bucket_start`),
  KEY `idx_visitor_activity_bucket` (`bucket_start`),
  KEY `idx_visitor_activity_last_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
